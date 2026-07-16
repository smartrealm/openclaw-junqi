#[cfg(windows)]
use crate::commands::git_runtime::{
    verified_managed_git_artifact, verified_system_git_installer_artifact,
};
#[cfg(windows)]
use crate::commands::node_runtime::node_installer_sources;
use crate::commands::node_runtime::{
    node_archive_sources, node_checksum_sources, node_index_sources, select_preferred_release,
    ManagedNodePlatform, NodeArchiveFormat, NodeDistributionRelease, NodeRequirementSource,
    NodeRuntimeRequirement,
};
use crate::commands::npm_registry;
use crate::commands::process_control::terminate_process_tree;
use crate::commands::setup_progress::{emit, emit_keyed};
use crate::paths;
use crate::platform;
use crate::state::GatewayProcess;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};

static OPENCLAW_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static NODE_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static GIT_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
#[cfg(windows)]
const WINGET_NODE_LTS_PACKAGE: &str = "OpenJS.NodeJS.LTS";
#[cfg(windows)]
const WINGET_NODE_CURRENT_PACKAGE: &str = "OpenJS.NodeJS";
#[cfg(windows)]
const WINGET_GIT_PACKAGE: &str = "Git.Git";
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
const RUNTIME_NETWORK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn runtime_binary(root: &Path, tool: &str) -> PathBuf {
    match (tool, cfg!(windows)) {
        ("node", true) => root.join("node.exe"),
        ("node", false) => root.join("bin").join("node"),
        ("git", true) => root.join("cmd").join("git.exe"),
        ("git", false) => root.join("bin").join("git"),
        _ => root.join(tool),
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn staged_npm_cli(root: &Path) -> PathBuf {
    let npm_root = if cfg!(windows) {
        root.join("node_modules")
    } else {
        root.join("lib").join("node_modules")
    };
    npm_root.join("npm").join("bin").join("npm-cli.js")
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn activate_staged_runtime(staging: &Path, target: &Path, name: &str) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| format!("Managed {name} target has no parent directory"))?;
    let backup = parent.join(format!(".{name}-backup-{}", uuid::Uuid::new_v4()));
    if target.exists() {
        std::fs::rename(target, &backup)
            .map_err(|error| format!("Failed to stage existing managed {name}: {error}"))?;
    }
    if let Err(error) = std::fs::rename(staging, target) {
        if backup.exists() {
            std::fs::rename(&backup, target).map_err(|rollback_error| {
                format!(
                    "Failed to activate managed {name}: {error}; rollback failed: {rollback_error}"
                )
            })?;
        }
        return Err(format!("Failed to activate managed {name}: {error}"));
    }
    let _ = std::fs::remove_dir_all(backup);
    Ok(())
}

// ─── Platform helpers ──────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn refresh_path_from_registry() {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
    use winreg::enums::*;
    use winreg::{RegKey, RegValue};

    fn registry_string(value: &RegValue) -> Option<OsString> {
        let mut wide = value
            .bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        while wide.last() == Some(&0) {
            wide.pop();
        }
        if value.vtype != REG_EXPAND_SZ {
            return Some(OsString::from_wide(&wide));
        }

        wide.push(0);
        let required = unsafe { ExpandEnvironmentStringsW(wide.as_ptr(), std::ptr::null_mut(), 0) };
        if required == 0 {
            return None;
        }
        let mut expanded = vec![0_u16; required as usize];
        let written = unsafe {
            ExpandEnvironmentStringsW(wide.as_ptr(), expanded.as_mut_ptr(), expanded.len() as u32)
        };
        if written == 0 || written > required {
            return None;
        }
        expanded.truncate(written.saturating_sub(1) as usize);
        Some(OsString::from_wide(&expanded))
    }

    fn push_unique(parts: &mut Vec<OsString>, value: OsString) {
        for entry in std::env::split_paths(&value) {
            if entry.as_os_str().is_empty() {
                continue;
            }
            let marker = entry.to_string_lossy();
            if !parts
                .iter()
                .any(|existing| existing.to_string_lossy().eq_ignore_ascii_case(&marker))
            {
                parts.push(entry.into_os_string());
            }
        }
    }

    let mut parts: Vec<OsString> = Vec::new();
    if let Ok(env) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
    {
        if let Ok(val) = env.get_raw_value("Path") {
            if let Some(value) = registry_string(&val) {
                push_unique(&mut parts, value);
            }
        }
    }
    if let Ok(env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        if let Ok(val) = env.get_raw_value("Path") {
            if let Some(value) = registry_string(&val) {
                push_unique(&mut parts, value);
            }
        }
    }
    if let Some(current) = std::env::var_os("PATH") {
        push_unique(&mut parts, current);
    }
    if !parts.is_empty() {
        if let Ok(joined) = std::env::join_paths(parts) {
            std::env::set_var("PATH", joined);
        }
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn download_with_fallback(
    app: &tauri::AppHandle,
    step: &str,
    sources: &[(String, &'static str)],
    dest: &Path,
    expected_sha256: &str,
    prog_start: f64,
    prog_end: f64,
) -> Result<u64, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("JunQi Desktop runtime downloader")
        .build()
        .map_err(|error| format!("Failed to initialize downloader: {error}"))?;
    let mut last_error = "no download source responded".to_string();
    for (index, (url, label)) in sources.iter().enumerate() {
        emit(
            app,
            step,
            &format!(
                "【下载 {}/{}】正在连接 {}...",
                index + 1,
                sources.len(),
                label
            ),
            prog_start,
        );
        let response = match client.get(url).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => response,
                Err(error) => {
                    last_error = format!("{label}: {error}");
                    continue;
                }
            },
            Err(error) => {
                last_error = format!("{label}: {error}");
                continue;
            }
        };
        let total = response.content_length().unwrap_or(0);
        let bytes = match response.bytes().await {
            Ok(bytes) if !bytes.is_empty() => bytes,
            Ok(_) => {
                last_error = format!("{label}: empty response");
                continue;
            }
            Err(error) => {
                last_error = format!("{label}: {error}");
                continue;
            }
        };
        let actual = format!("{:x}", Sha256::digest(&bytes));
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            last_error = format!("{label}: SHA-256 mismatch");
            continue;
        }
        std::fs::write(dest, &bytes)
            .map_err(|error| format!("Failed to write {}: {error}", dest.display()))?;
        emit(
            app,
            step,
            &format!(
                "Download verified via {} ({:.1} MB)",
                label,
                total.max(bytes.len() as u64) as f64 / 1024.0 / 1024.0
            ),
            prog_end,
        );
        return Ok(bytes.len() as u64);
    }
    Err(format!("所有下载源均失败。最后错误：{last_error}"))
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn extract_zip(
    app: &tauri::AppHandle,
    step: &str,
    archive: &Path,
    dest: &Path,
    strip_top_level: bool,
    progress: f64,
) -> Result<(), String> {
    let file =
        std::fs::File::open(archive).map_err(|error| format!("Failed to open archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read zip archive: {error}"))?;
    emit(
        app,
        step,
        &format!("Extracting {} files...", archive.len()),
        progress,
    );
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(mut relative) = entry.enclosed_name() else {
            continue;
        };
        if strip_top_level {
            relative = relative.components().skip(1).collect();
            if relative.as_os_str().is_empty() {
                continue;
            }
        }
        let output = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = std::fs::File::create(&output)
                .map_err(|error| format!("Failed to create {}: {error}", output.display()))?;
            std::io::copy(&mut entry, &mut file)
                .map_err(|error| format!("Failed to extract {}: {error}", output.display()))?;
        }
    }
    Ok(())
}

fn extract_tar_gz(
    app: &tauri::AppHandle,
    step: &str,
    archive: &Path,
    dest: &Path,
    progress: f64,
) -> Result<(), String> {
    let file =
        std::fs::File::open(archive).map_err(|error| format!("Failed to open archive: {error}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    emit(app, step, "Extracting Node.js runtime...", progress);
    archive
        .unpack(dest)
        .map_err(|error| format!("Failed to extract Node.js archive: {error}"))
}

#[cfg(any(windows, target_os = "macos"))]
fn extract_node_archive(
    app: &tauri::AppHandle,
    archive: &Path,
    stage_container: &Path,
    version: &str,
    platform: ManagedNodePlatform,
) -> Result<PathBuf, String> {
    match platform.archive_format {
        NodeArchiveFormat::Zip => {
            extract_zip(app, "node", archive, stage_container, true, 0.65)?;
            Ok(stage_container.to_path_buf())
        }
        NodeArchiveFormat::TarGz => {
            extract_tar_gz(app, "node", archive, stage_container, 0.65)?;
            let top_level = platform
                .extracted_root(version)
                .ok_or("The Node.js platform model did not provide an extracted root")?;
            let extracted = stage_container.join(top_level);
            if !extracted.is_dir() {
                return Err("Downloaded Node.js archive has an unexpected directory layout".into());
            }
            Ok(extracted)
        }
    }
}

// ─── npm install with registry fallback ───────────────────────────────────────

const NPM_INACTIVITY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

const NPM_NOISY_LOG_PREFIXES: &[&str] = &["npm verbose", "npm sill", "npm timing", "npm notice"];

const NPM_SECRET_MARKERS: &[&str] = &[
    "_authtoken",
    "authorization",
    "bearer ",
    "password",
    "api_key",
    "apikey",
];

/// Keep npm's verbose stream available for inactivity detection without
/// forwarding internal chatter or credentials into the setup console.
fn npm_log_line_for_display(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let lowercase = line.to_ascii_lowercase();
    if NPM_NOISY_LOG_PREFIXES
        .iter()
        .any(|prefix| lowercase.starts_with(prefix))
    {
        return None;
    }

    if NPM_SECRET_MARKERS
        .iter()
        .any(|marker| lowercase.contains(marker))
    {
        return Some("[authentication details redacted]".into());
    }

    let redacted = line
        .split_whitespace()
        .map(|token| {
            let contains_url_credentials = token
                .find("://")
                .and_then(|scheme_end| token[scheme_end + 3..].find('@'))
                .is_some();
            if contains_url_credentials {
                "[registry URL redacted]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    const MAX_DISPLAY_CHARS: usize = 1_000;
    if redacted.chars().count() <= MAX_DISPLAY_CHARS {
        Some(redacted)
    } else {
        Some(
            redacted
                .chars()
                .take(MAX_DISPLAY_CHARS)
                .chain(std::iter::once('…'))
                .collect(),
        )
    }
}

enum NpmWaitResult {
    Exited(std::io::Result<std::process::ExitStatus>),
    Inactive,
}

async fn wait_for_npm_activity(
    child: &mut tokio::process::Child,
    activity: &mut tokio::sync::watch::Receiver<u64>,
) -> NpmWaitResult {
    wait_for_process_activity(child, activity, NPM_INACTIVITY_TIMEOUT).await
}

async fn wait_for_process_activity(
    child: &mut tokio::process::Child,
    activity: &mut tokio::sync::watch::Receiver<u64>,
    inactivity_timeout: std::time::Duration,
) -> NpmWaitResult {
    let wait = child.wait();
    tokio::pin!(wait);
    loop {
        tokio::select! {
            status = &mut wait => return NpmWaitResult::Exited(status),
            changed = activity.changed() => {
                if changed.is_err() {
                    return NpmWaitResult::Exited(wait.await);
                }
            }
            _ = tokio::time::sleep(inactivity_timeout) => return NpmWaitResult::Inactive,
        }
    }
}

/// Run `npm install -g <pinned-package>` against a user-writable global prefix
/// with live output streaming. The release contract is resolved once before
/// this function, so its registry order, version and Node.js requirement stay
/// aligned throughout a single installation attempt.
///
/// We deliberately use `-g` plus an `npm_config_prefix` env var rather than
/// `npm install --prefix <dir>`: `--prefix` is the project-local install
/// flag and produces non-standard bin layouts that diverge from a normal
/// global install. `-g` gives us the real global layout
/// (`<prefix>/bin/openclaw`, `<prefix>/lib/node_modules/openclaw/...`) and
/// respects whatever the user already has on `PATH` via `detect_openclaw`.
async fn npm_install_with_fallback(
    app: &tauri::AppHandle,
    step: &str,
    node_cmd: &str,
    npm_cli: Option<&str>,
    global_prefix: &std::path::Path,
    target: &npm_registry::OpenclawReleaseTarget,
    force: bool,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    let path_env = crate::commands::system::openclaw_search_path();
    let install_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::fs::create_dir_all(global_prefix).ok();
    let package_spec = target.package_spec();
    let registries = target.registries().to_vec();
    let mut last_err = String::new();
    let total_regs = registries.len();
    let registry_order = registries
        .iter()
        .map(|registry| registry.label())
        .collect::<Vec<_>>()
        .join(" -> ");
    emit(
        app,
        step,
        &format!(
            "npm source order: {}; OpenClaw target = {}",
            registry_order,
            target.version(),
        ),
        prog_start,
    );

    for (reg_idx, registry) in registries.into_iter().enumerate() {
        let staging_prefix = global_prefix.join(format!(
            ".junqi-openclaw-stage-{}-{}-{}",
            std::process::id(),
            install_nonce,
            reg_idx + 1
        ));
        let _staging_cleanup = cfg!(windows).then(|| TemporaryDirectory(staging_prefix.clone()));
        let install_prefix = if cfg!(windows) {
            staging_prefix.as_path()
        } else {
            global_prefix
        };
        let npm_prefix_str = install_prefix.to_string_lossy().to_string();
        if cfg!(windows) {
            std::fs::create_dir_all(&staging_prefix).map_err(|error| {
                format!(
                    "Cannot prepare the isolated OpenClaw installer at {}: {}",
                    staging_prefix.display(),
                    error
                )
            })?;
        }
        let reg_label = registry.label();
        emit(
            app,
            step,
            &format!(
                "【安装 {}/{}】使用 {} 安装 {}...",
                reg_idx + 1,
                total_regs,
                reg_label,
                package_spec
            ),
            prog_start,
        );

        let mut cmd = if let Some(cli) = npm_cli {
            let mut c = tokio::process::Command::new(node_cmd);
            c.arg(cli);
            c
        } else {
            tokio::process::Command::new(platform::bin_name("npm"))
        };

        cmd.args([
            "install",
            "-g",
            "--prefer-online",
            "--loglevel=http",
            "--foreground-scripts",
            "--fetch-retries=2",
            "--fetch-retry-mintimeout=1000",
            "--fetch-retry-maxtimeout=10000",
            "--fetch-timeout=120000",
            "--no-fund",
            "--no-audit",
        ]);
        if force {
            // An explicit reinstall must not be short-circuited by npm's
            // existing-package metadata. Keep the current payload in place
            // until npm has successfully replaced it.
            cmd.arg("--force");
        }
        cmd.arg(&package_spec)
            .env("PATH", &path_env)
            .env("npm_config_prefix", &npm_prefix_str)
            // This is deliberately process-scoped. Do not alter user or global npmrc.
            .env("npm_config_registry", registry.url)
            .env("NPM_CONFIG_REGISTRY", registry.url)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        crate::commands::system::apply_configured_npm_cache(&mut cmd);
        platform::configure_background_command(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("Failed to spawn npm: {}", e);
                continue;
            }
        };
        let child_pid = child.id();
        let (activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);

        // Stream stdout to progress events so the user sees live npm output
        let prog_live = prog_start + (prog_end - prog_start) * 0.4;
        let stdout_task = child.stdout.take().map(|stdout| {
            let app_c = app.clone();
            let step_c = step.to_string();
            let activity_tx = activity_tx.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    activity_tx.send_modify(|sequence| *sequence += 1);
                    let Some(line) = npm_log_line_for_display(&line) else {
                        continue;
                    };
                    emit(&app_c, &step_c, &format!("npm › {}", line), prog_live);
                }
            })
        });
        let tar_warning_count = Arc::new(AtomicUsize::new(0));
        let stderr_task = child.stderr.take().map(|stderr| {
            let app_e = app.clone();
            let step_e = step.to_string();
            let tar_warning_count_e = Arc::clone(&tar_warning_count);
            let activity_tx = activity_tx.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    activity_tx.send_modify(|sequence| *sequence += 1);
                    let Some(line) = npm_log_line_for_display(&line) else {
                        continue;
                    };
                    if line.contains("TAR_ENTRY_ERROR") && line.contains("ENOENT") {
                        let seen = tar_warning_count_e.fetch_add(1, Ordering::Relaxed);
                        // Preserve the first diagnostic but avoid flooding the
                        // setup UI with hundreds of identical npm warnings.
                        if seen > 0 {
                            continue;
                        }
                    }
                    emit(&app_e, &step_e, &format!("npm › {}", line), prog_live);
                }
            })
        });
        let (heartbeat_tx, mut heartbeat_rx) = tokio::sync::watch::channel(false);
        let heartbeat_app = app.clone();
        let heartbeat_step = step.to_string();
        let heartbeat_label = reg_label.to_string();
        let heartbeat_task = tokio::spawn(async move {
            let started = std::time::Instant::now();
            loop {
                tokio::select! {
                    changed = heartbeat_rx.changed() => {
                        if changed.is_err() || *heartbeat_rx.borrow() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                        emit(
                            &heartbeat_app,
                            &heartbeat_step,
                            &format!(
                                "npm is still installing via {} (elapsed {}s); waiting for network, extraction, or lifecycle scripts...",
                                heartbeat_label,
                                started.elapsed().as_secs(),
                            ),
                            prog_live,
                        );
                    }
                }
            }
        });
        let wait_result = wait_for_npm_activity(&mut child, &mut activity_rx).await;
        let _ = heartbeat_tx.send(true);
        let _ = heartbeat_task.await;
        let status = match wait_result {
            NpmWaitResult::Exited(Ok(s)) => s,
            NpmWaitResult::Exited(Err(e)) => {
                last_err = format!("npm process error: {}", e);
                if reg_idx + 1 < total_regs {
                    emit(
                        app,
                        step,
                        &format!(
                            "{} install errored, retrying with fallback source...",
                            reg_label
                        ),
                        prog_start,
                    );
                }
                continue;
            }
            NpmWaitResult::Inactive => {
                last_err = "npm install produced no child-process output for 10 minutes".into();
                terminate_process_tree(&mut child, child_pid).await;
                if reg_idx + 1 < total_regs {
                    emit(
                            app,
                            step,
                            &format!(
                                "{} install stopped after 10 minutes without child-process output; retrying with fallback source...",
                                reg_label
                            ),
                            prog_start,
                        );
                }
                continue;
            }
        };

        if let Some(task) = stdout_task {
            let _ = task.await;
        }
        if let Some(task) = stderr_task {
            let _ = task.await;
        }

        if status.success() {
            let tar_warnings = tar_warning_count.load(Ordering::Relaxed);
            if tar_warnings > 1 {
                emit(
                    app,
                    step,
                    &format!(
                        "npm reported {} duplicate extraction warnings; installation validation will confirm integrity",
                        tar_warnings
                    ),
                    prog_live,
                );
            }
            if cfg!(windows) {
                validate_staged_openclaw_install(&staging_prefix)?;
                promote_staged_openclaw_install(&staging_prefix, global_prefix).await?;
            }
            emit(
                app,
                step,
                &format!("{} installed (via {}) ✓", package_spec, reg_label),
                prog_end,
            );
            return Ok(());
        }

        last_err = format!("npm 退出码 {}", status.code().unwrap_or(-1));
        if reg_idx + 1 < total_regs {
            emit(
                app,
                step,
                &format!(
                    "{} install failed ({}), retrying with fallback source...",
                    reg_label, last_err
                ),
                prog_start,
            );
        }
    }

    Err(format!(
        "All npm registries failed. Last error: {}",
        last_err
    ))
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[cfg_attr(not(windows), allow(dead_code))]
async fn fetch_node_distribution_index(
    client: &reqwest::Client,
    url: &str,
) -> Option<Vec<NodeDistributionRelease>> {
    client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Vec<NodeDistributionRelease>>()
        .await
        .ok()
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_managed_node_version(
    requirement: &NodeRuntimeRequirement,
    platform: ManagedNodePlatform,
) -> Result<String, String> {
    let artifact = platform.distribution_artifact();
    resolve_managed_node_version_for_artifact(requirement, &artifact).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_managed_node_version_for_artifact(
    requirement: &NodeRuntimeRequirement,
    artifact: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(RUNTIME_NETWORK_TIMEOUT)
        .user_agent("JunQi Desktop Node.js release resolver")
        .build()
        .map_err(|error| format!("Failed to initialize Node.js resolver: {error}"))?;
    let mut releases = None;
    for source in node_index_sources() {
        if let Some(index) = fetch_node_distribution_index(&client, &source).await {
            releases = Some(index);
            break;
        }
    }
    let releases = releases.ok_or_else(|| "Node.js 国内镜像索引均不可用".to_string())?;
    select_preferred_release(requirement, &releases, artifact).ok_or_else(|| {
        format!(
            "No published Node.js release for artifact {artifact} satisfies OpenClaw requirement {}",
            requirement.expression()
        )
    })
}

fn parse_shasums(text: &str, filename: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let digest = fields.next()?;
        let listed = fields.next()?.trim_start_matches('*');
        (listed == filename
            && digest.len() == 64
            && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| digest.to_ascii_lowercase())
    })
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_node_sha256(
    version: &str,
    platform: ManagedNodePlatform,
) -> Result<String, String> {
    let filename = platform.archive_filename(version);
    resolve_node_sha256_for_filename(version, &filename).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_node_sha256_for_filename(version: &str, filename: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(RUNTIME_NETWORK_TIMEOUT)
        .user_agent("JunQi Desktop Node.js checksum resolver")
        .build()
        .map_err(|error| format!("Failed to initialize checksum resolver: {error}"))?;
    for source in node_checksum_sources(version) {
        let Ok(response) = client.get(source).send().await else {
            continue;
        };
        let Ok(response) = response.error_for_status() else {
            continue;
        };
        let Ok(text) = response.text().await else {
            continue;
        };
        if let Some(digest) = parse_shasums(&text, filename) {
            return Ok(digest);
        }
    }
    Err(format!(
        "Unable to obtain a publisher SHA-256 for Node.js {filename}"
    ))
}

struct OpenclawInstallTarget {
    release: npm_registry::OpenclawReleaseTarget,
    node_requirement: NodeRuntimeRequirement,
}

async fn target_openclaw_install_target() -> Result<OpenclawInstallTarget, String> {
    let release = npm_registry::resolve_latest_openclaw_release_target().await?;
    let node_requirement = NodeRuntimeRequirement::parse(
        release.node_requirement(),
        NodeRequirementSource::RegistryPackage,
    )?;
    Ok(OpenclawInstallTarget {
        release,
        node_requirement,
    })
}

pub(crate) async fn target_openclaw_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    Ok(target_openclaw_install_target().await?.node_requirement)
}

/// Setup has two runtime contracts: an existing local OpenClaw package is
/// authoritative for a reuse path, while a machine without OpenClaw must
/// resolve the exact target package before installing anything. Keeping this
/// distinction prevents an offline registry from blocking a healthy existing
/// installation and prevents a fresh installation from using a broad fallback.
async fn setup_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    if let Some(binary) = crate::commands::system::resolve_openclaw_binary_async().await {
        return crate::commands::system::required_node_requirement_for_openclaw_binary(&binary);
    }
    target_openclaw_node_requirement().await
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupNodeStatus {
    pub node: crate::commands::system::NodeStatus,
    pub requirement: String,
}

/// Check the current Node.js runtime against the active setup contract: the
/// installed package when one exists, otherwise the exact target release.
#[tauri::command]
pub async fn check_setup_node() -> Result<SetupNodeStatus, String> {
    let target = setup_node_requirement().await?;
    let node = crate::commands::system::check_node_for_requirement(&target).await?;
    Ok(SetupNodeStatus {
        node,
        requirement: target.expression().to_string(),
    })
}

#[tauri::command]
pub async fn install_node(app: tauri::AppHandle) -> Result<String, String> {
    let requirement = setup_node_requirement().await?;
    install_node_for_requirement(app, requirement, false).await
}

pub(crate) async fn update_managed_node_runtime(app: tauri::AppHandle) -> Result<String, String> {
    let requirement = crate::commands::system::installed_openclaw_node_requirement()?;
    #[cfg(windows)]
    {
        return install_node_for_requirement(app, requirement, true).await;
    }

    #[cfg(not(windows))]
    {
        if paths::configured_node_runtime_dir().is_some() {
            return install_node_for_requirement(app, requirement, true).await;
        }
        Err(
            "The active Node.js installation is managed by the operating system; update it with the system package manager"
                .into(),
        )
    }
}

async fn install_node_for_requirement(
    #[cfg_attr(all(not(windows), not(target_os = "macos")), allow(unused_variables))]
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
) -> Result<String, String> {
    let _guard = NODE_INSTALL_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;

    #[cfg(windows)]
    {
        return match paths::configured_node_runtime_dir() {
            Some(target) => install_portable_node_runtime(app, requirement, force, target).await,
            None => install_windows_system_node(app, requirement, force).await,
        };
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(target) = paths::configured_node_runtime_dir() {
            return install_portable_node_runtime(app, requirement, force, target).await;
        }
        if !force {
            let detected =
                crate::commands::system::check_node_for_requirement(&requirement).await?;
            if detected.available {
                return Ok(format!(
                    "Node.js {} already installed at {}",
                    detected.version.unwrap_or_default(),
                    detected.path.unwrap_or_default()
                ));
            }
        }
        return Err(format!(
            "Node.js {} is required. Install or update Node.js in its standard system location, then retry.",
            requirement.expression()
        ));
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    if !force {
        let detected = crate::commands::system::check_node_for_requirement(&requirement).await?;
        if detected.available {
            return Ok(format!(
                "Node.js {} already installed at {}",
                detected.version.unwrap_or_default(),
                detected.path.unwrap_or_default()
            ));
        }
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    return Err(format!(
        "Node.js {} is required. Install or update Node.js in its standard system location, then retry.",
        requirement.expression()
    ));
}

#[cfg(any(windows, target_os = "macos"))]
async fn install_portable_node_runtime(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    target: PathBuf,
) -> Result<String, String> {
    let target_node = runtime_binary(&target, "node");
    let target_npm = staged_npm_cli(&target);
    if !force && target_npm.is_file() {
        let mut command = tokio::process::Command::new(&target_node);
        command.arg("--version");
        platform::configure_background_command(&mut command);
        if let Ok(output) = command.output().await {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && requirement.supports(&version) {
                return Ok(format!(
                    "Node.js {version} already installed at {}",
                    target_node.display()
                ));
            }
        }
    }

    let platform = ManagedNodePlatform::current()?;
    let version = resolve_managed_node_version(&requirement, platform).await?;
    emit_keyed(
        &app,
        "node",
        &format!("Preparing to download Node.js v{version}, China mirror first..."),
        "setup.node.prepareDownload",
        0.05,
    );
    let sha256 = resolve_node_sha256(&version, platform).await?;
    let temp_dir =
        std::env::temp_dir().join(format!("junqi-node-download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create Node.js temporary directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let archive = temp_dir.join(platform.archive_filename(&version));
    let sources = node_archive_sources(platform, &version);
    download_with_fallback(&app, "node", &sources, &archive, &sha256, 0.08, 0.60).await?;

    let parent = target
        .parent()
        .ok_or("Selected Node.js runtime directory has no parent")?;
    let stage_container = parent.join(format!(".junqi-node-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&stage_container)
        .map_err(|error| format!("Failed to prepare Node.js staging directory: {error}"))?;
    let _staging_cleanup = TemporaryDirectory(stage_container.clone());
    let staging = extract_node_archive(&app, &archive, &stage_container, &version, platform)?;
    let staged_node = runtime_binary(&staging, "node");
    if !staged_npm_cli(&staging).is_file() {
        return Err("Downloaded Node.js runtime does not contain bundled npm".into());
    }
    let mut command = tokio::process::Command::new(&staged_node);
    command.arg("--version");
    platform::configure_background_command(&mut command);
    let detected = command
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|version| requirement.supports(version))
        .ok_or_else(|| {
            format!(
                "Downloaded Node.js does not satisfy OpenClaw requirement {}",
                requirement.expression()
            )
        })?;
    activate_staged_runtime(&staging, &target, "node")?;
    emit_keyed(
        &app,
        "node",
        &format!("Node.js {detected} installed in the selected directory"),
        "setup.node.done",
        1.0,
    );
    Ok(format!(
        "Node.js {detected} installed at {}",
        target.display()
    ))
}

#[cfg(windows)]
async fn install_windows_system_node(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
) -> Result<String, String> {
    let current = crate::commands::system::check_node_for_requirement(&requirement).await?;
    if current.available && !force {
        return Ok(format!(
            "Node.js {} already installed at {}",
            current.version.unwrap_or_default(),
            current.path.unwrap_or_default()
        ));
    }

    let mirror_error = match install_windows_system_node_from_mirrors(&app, &requirement).await {
        Ok(installed) => return Ok(installed),
        Err(error) => error,
    };
    emit_keyed(
        &app,
        "node",
        "The mainland mirror installer could not finish; trying Windows Package Manager...",
        "setup.node.systemPackageFallback",
        0.60,
    );
    install_windows_system_node_with_winget(&app, &requirement)
        .await
        .map_err(|error| {
            format!(
                "Node.js installer from mainland mirrors failed: {mirror_error}\nWindows Package Manager fallback failed: {error}"
            )
        })
}

#[cfg(windows)]
async fn install_windows_system_node_from_mirrors(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
) -> Result<String, String> {
    let platform = ManagedNodePlatform::current()?;
    let artifact = platform
        .installer_distribution_artifact()
        .ok_or("The current platform does not publish a Node.js MSI installer")?;
    let version = resolve_managed_node_version_for_artifact(requirement, &artifact).await?;
    let filename = platform
        .installer_filename(&version)
        .ok_or("The current platform does not publish a Node.js MSI installer")?;
    let sha256 = resolve_node_sha256_for_filename(&version, &filename).await?;
    let sources = node_installer_sources(platform, &version);
    if sources.is_empty() {
        return Err("No domestic Node.js MSI source is available for this platform".into());
    }

    emit_keyed(
        app,
        "node",
        "Installing Node.js to the official Windows default location...",
        "setup.node.systemInstall",
        0.10,
    );
    let temp_dir = std::env::temp_dir().join(format!(
        "junqi-node-system-installer-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to prepare Node.js installer directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let installer = temp_dir.join(&filename);
    download_with_fallback(app, "node", &sources, &installer, &sha256, 0.12, 0.62).await?;

    let msiexec = platform_path("msiexec.exe", "msiexec")
        .ok_or("Windows Installer (msiexec) is unavailable")?;
    let args = [
        std::ffi::OsString::from("/i"),
        installer.into_os_string(),
        std::ffi::OsString::from("/qn"),
        std::ffi::OsString::from("/norestart"),
    ];
    run_windows_installer(&msiexec, &args, "Node.js").await?;
    refresh_path_from_registry();

    let installed = crate::commands::system::check_node_for_requirement(requirement).await?;
    if !installed.available {
        return Err(format!(
            "The Node.js MSI completed but the system runtime does not satisfy {} (detected: {})",
            requirement.expression(),
            installed.version.unwrap_or_else(|| "not found".into())
        ));
    }
    emit_keyed(
        app,
        "node",
        "A compatible system Node.js runtime is ready",
        "setup.node.systemReady",
        1.0,
    );
    Ok(format!(
        "Node.js {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
async fn install_windows_system_node_with_winget(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
) -> Result<String, String> {
    install_or_upgrade_winget_package(WINGET_NODE_LTS_PACKAGE).await?;
    refresh_path_from_registry();
    let mut installed = crate::commands::system::check_node_for_requirement(&requirement).await?;
    if !installed.available {
        emit_keyed(
            &app,
            "node",
            "The LTS channel does not satisfy OpenClaw; trying the current Node.js channel...",
            "setup.node.systemCurrentInstall",
            0.55,
        );
        install_or_upgrade_winget_package(WINGET_NODE_CURRENT_PACKAGE).await?;
        refresh_path_from_registry();
        installed = crate::commands::system::check_node_for_requirement(&requirement).await?;
    }
    if !installed.available {
        return Err(format!(
            "The system Node.js installation does not satisfy OpenClaw requirement {} (detected: {})",
            requirement.expression(),
            installed.version.unwrap_or_else(|| "not found".into())
        ));
    }
    emit_keyed(
        &app,
        "node",
        "A compatible system Node.js runtime is ready",
        "setup.node.systemReady",
        1.0,
    );
    Ok(format!(
        "Node.js {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
fn platform_path(primary: &str, fallback: &str) -> Option<PathBuf> {
    let primary = platform::detect_path(primary);
    let path = if primary.is_empty() {
        platform::detect_path(fallback)
    } else {
        primary
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

#[cfg(windows)]
async fn run_windows_installer(
    executable: &Path,
    args: &[std::ffi::OsString],
    label: &str,
) -> Result<(), String> {
    let mut command = tokio::process::Command::new(executable);
    command.args(args);
    platform::configure_background_command(&mut command);
    let output = tokio::time::timeout(std::time::Duration::from_secs(20 * 60), command.output())
        .await
        .map_err(|_| format!("{label} installer timed out"))?
        .map_err(|error| format!("Failed to start {label} installer: {error}"))?;
    if output.status.success() {
        return Ok(());
    }
    let diagnostic = crate::commands::diagnostic_output::sanitize_diagnostic_text(
        &format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        ),
        1_500,
    );
    Err(if diagnostic.is_empty() {
        format!("{label} installer exited with {}", output.status)
    } else {
        format!(
            "{label} installer exited with {}: {diagnostic}",
            output.status
        )
    })
}

#[cfg(windows)]
async fn install_or_upgrade_winget_package(package_id: &str) -> Result<(), String> {
    let winget = platform::detect_path("winget");
    if winget.is_empty() {
        return Err(
            "Windows Package Manager (winget) is unavailable. Install the dependency with its standard system installer or select an explicit portable runtime directory in JunQi."
                .into(),
        );
    }
    if run_winget_package_command(&winget, "upgrade", package_id)
        .await
        .is_ok_and(|output| output.status.success())
    {
        return Ok(());
    }
    let install = run_winget_package_command(&winget, "install", package_id).await?;
    if install.status.success() {
        return Ok(());
    }
    let diagnostic = format!(
        "{}\n{}",
        String::from_utf8_lossy(&install.stdout).trim(),
        String::from_utf8_lossy(&install.stderr).trim()
    )
    .trim()
    .to_string();
    Err(if diagnostic.is_empty() {
        format!("winget could not install {package_id}")
    } else {
        format!("winget could not install {package_id}: {diagnostic}")
    })
}

#[cfg(windows)]
async fn run_winget_package_command(
    winget: &str,
    verb: &str,
    package_id: &str,
) -> Result<std::process::Output, String> {
    let mut command = tokio::process::Command::new(winget);
    command.args([
        verb,
        "-e",
        "--id",
        package_id,
        "--silent",
        "--disable-interactivity",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]);
    platform::configure_background_command(&mut command);
    tokio::time::timeout(std::time::Duration::from_secs(20 * 60), command.output())
        .await
        .map_err(|_| format!("winget {verb} timed out for {package_id}"))?
        .map_err(|error| format!("Failed to run winget {verb} for {package_id}: {error}"))
}

/// Ensure child processes use a Node.js release accepted by OpenClaw.
/// The requirement is read from OpenClaw metadata, so version evolution does
/// not require a JunQi release with another hard-coded range.
pub(crate) async fn ensure_compatible_node_runtime(
    app: &tauri::AppHandle,
    context_step: &str,
    requirement: &NodeRuntimeRequirement,
) -> Result<crate::commands::system::NodeStatus, String> {
    let mut node = crate::commands::system::check_node_for_requirement(requirement).await?;
    if !node.available {
        emit_keyed(
            app,
            context_step,
            &format!(
                "Node.js is outside OpenClaw's supported range ({} from {}); preparing a compatible runtime...",
                requirement.expression(),
                requirement.source().label()
            ),
            "setup.node.autoRepair",
            0.1,
        );
        install_node_for_requirement(app.clone(), requirement.clone(), false)
            .await
            .map_err(|error| {
                format!(
                    "Unable to install a compatible Node.js runtime (required: {}): {error}",
                    requirement.expression()
                )
            })?;
        node = crate::commands::system::check_node_for_requirement(requirement).await?;
    }

    if !node.available {
        return Err(format!(
            "OpenClaw requires Node.js {}; a compatible runtime was not detected",
            requirement.expression()
        ));
    }

    emit_keyed(
        app,
        context_step,
        &format!(
            "Node.js {} ready: {}",
            node.version.as_deref().unwrap_or("unknown"),
            crate::commands::system::display_path_text(node.path.as_deref().unwrap_or("node"))
        ),
        "setup.node.runtimeReady",
        0.25,
    );
    Ok(node)
}

#[tauri::command]
pub async fn install_git(app: tauri::AppHandle) -> Result<String, String> {
    install_git_impl(app, false).await
}

pub(crate) async fn update_managed_git_runtime(
    #[cfg_attr(not(windows), allow(unused_variables))] app: tauri::AppHandle,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        return install_git_impl(app, true).await;
    }

    #[cfg(not(windows))]
    {
        Err(
            "The active Git installation is managed by the operating system; update it with the system package manager"
                .into(),
        )
    }
}

async fn install_git_impl(app: tauri::AppHandle, force: bool) -> Result<String, String> {
    let _guard = GIT_INSTALL_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let step = "git";

    // ① Detect
    emit_keyed(
        &app,
        step,
        "Checking Git installation...",
        "setup.git.check",
        0.02,
    );
    #[cfg(windows)]
    if let Some(target) = paths::configured_git_runtime_dir() {
        return install_windows_portable_git(app, force, target).await;
    }

    let existing_git = crate::commands::system::check_git().await?;
    if existing_git.available && !force {
        let version = existing_git
            .version
            .unwrap_or_else(|| "unknown version".into());
        emit_keyed(
            &app,
            step,
            &format!("Git {} already installed, skipping", version),
            "setup.git.skip",
            1.0,
        );
        return Ok(format!("Git {} already installed", version));
    }

    #[cfg(windows)]
    {
        return install_windows_system_git(app).await;
    }

    #[cfg(target_os = "macos")]
    {
        emit_keyed(
            &app,
            step,
            "Git is not available. Please install Apple Command Line Tools manually, then retry.",
            "setup.git.manualRequired",
            1.0,
        );
        Err("Git is required. Install Apple Command Line Tools manually, then retry JunQi.".into())
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        emit_keyed(
            &app,
            step,
            "Git is not available. Install it with the operating-system package manager, then retry.",
            "setup.git.manualRequired",
            1.0,
        );
        Err("Git is required. Install Git with the operating-system package manager, then retry JunQi.".into())
    }
}

#[cfg(windows)]
async fn install_windows_system_git(app: tauri::AppHandle) -> Result<String, String> {
    let mirror_error = match install_windows_system_git_from_mirrors(&app).await {
        Ok(installed) => return Ok(installed),
        Err(error) => error,
    };
    emit_keyed(
        &app,
        "git",
        "The mainland mirror installer could not finish; trying Windows Package Manager...",
        "setup.git.systemPackageFallback",
        0.60,
    );
    install_or_upgrade_winget_package(WINGET_GIT_PACKAGE)
        .await
        .map_err(|error| {
            format!(
                "Git installer from mainland mirrors failed: {mirror_error}\nWindows Package Manager fallback failed: {error}"
            )
        })?;
    refresh_path_from_registry();
    let installed = crate::commands::system::check_git().await?;
    if !installed.available {
        return Err(
            "Git installation completed but git.exe was not detected on the system PATH".into(),
        );
    }
    emit_keyed(
        &app,
        "git",
        "System Git is ready",
        "setup.git.systemReady",
        1.0,
    );
    Ok(format!(
        "Git {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
async fn install_windows_system_git_from_mirrors(app: &tauri::AppHandle) -> Result<String, String> {
    let artifact = verified_system_git_installer_artifact(std::env::consts::ARCH)?;
    emit_keyed(
        app,
        "git",
        "Installing Git to the official Windows default location...",
        "setup.git.systemInstall",
        0.10,
    );
    let temp_dir = std::env::temp_dir().join(format!(
        "junqi-git-system-installer-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to prepare Git installer directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let installer = temp_dir.join(&artifact.filename);
    download_with_fallback(
        app,
        "git",
        &artifact.sources(),
        &installer,
        &artifact.sha256,
        0.12,
        0.62,
    )
    .await?;

    let args = [
        std::ffi::OsString::from("/VERYSILENT"),
        std::ffi::OsString::from("/NORESTART"),
        std::ffi::OsString::from("/SUPPRESSMSGBOXES"),
        std::ffi::OsString::from("/SP-"),
    ];
    run_windows_installer(&installer, &args, "Git").await?;
    refresh_path_from_registry();
    let installed = crate::commands::system::check_git().await?;
    if !installed.available {
        return Err(
            "The Git installer completed but git.exe was not detected on the system PATH".into(),
        );
    }
    emit_keyed(
        app,
        "git",
        "System Git is ready",
        "setup.git.systemReady",
        1.0,
    );
    Ok(format!(
        "Git {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
async fn install_windows_portable_git(
    app: tauri::AppHandle,
    force: bool,
    target: PathBuf,
) -> Result<String, String> {
    let target_git = runtime_binary(&target, "git");
    if target_git.is_file() && !force {
        let mut command = tokio::process::Command::new(&target_git);
        command.arg("--version");
        platform::configure_background_command(&mut command);
        if let Ok(output) = command.output().await {
            if output.status.success() {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !version.is_empty() {
                    return Ok(format!(
                        "Git {version} already installed at {}",
                        target_git.display()
                    ));
                }
            }
        }
    }

    let artifact = verified_managed_git_artifact(std::env::consts::ARCH)?;
    emit(
        &app,
        "git",
        &format!(
            "Preparing JunQi-verified Git v{} from domestic mirrors...",
            artifact.version
        ),
        0.04,
    );
    let temp_dir =
        std::env::temp_dir().join(format!("junqi-git-download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create Git temporary directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let archive = temp_dir.join(&artifact.filename);
    download_with_fallback(
        &app,
        "git",
        &artifact.sources(),
        &archive,
        &artifact.sha256,
        0.05,
        0.55,
    )
    .await?;

    let parent = target
        .parent()
        .ok_or("Selected Git runtime directory has no parent")?;
    let staging = parent.join(format!(".junqi-git-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|error| format!("Failed to prepare Git staging directory: {error}"))?;
    let _staging_cleanup = TemporaryDirectory(staging.clone());
    extract_zip(&app, "git", &archive, &staging, false, 0.62)?;
    let staged_git = runtime_binary(&staging, "git");
    let mut command = tokio::process::Command::new(&staged_git);
    command.arg("--version");
    platform::configure_background_command(&mut command);
    let version = command
        .output()
        .await
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|version| !version.is_empty())
        .ok_or("Portable Git extraction finished, but git.exe could not be verified")?;
    activate_staged_runtime(&staging, &target, "git")?;
    emit_keyed(
        &app,
        "git",
        &format!("Git {version} installed in the selected directory"),
        "setup.git.done",
        1.0,
    );
    Ok(format!("Git {version} installed at {}", target.display()))
}

/// Pick the directory we hand to `npm install -g` for the openclaw install.
///
/// Order of preference:
/// 1. An explicit custom prefix from the persisted install layout.
/// 2. The user's `npm config get prefix` from npm resolved by the login shell. This
///    matches what `npm i -g openclaw` from the user's terminal would
///    resolve to — same bin, same `package.json`, same place the user
///    can then manage with `npm i -g openclaw@latest`.
/// 3. Whatever is configured in `~/.npmrc` (`prefix=...`).
///
/// There is intentionally no hidden user-home or JunQi-owned fallback. If
/// npm's effective prefix is not writable, the installation guide asks for an
/// explicit choice instead of creating a second global OpenClaw installation.
async fn login_npm_prefix() -> Option<PathBuf> {
    let npm = platform::detect_path(&platform::bin_name("npm"));
    if npm.is_empty() {
        return paths::user_npm_prefix().and_then(|path| normalize_npm_prefix(&path));
    }
    let mut cmd = tokio::process::Command::new(npm);
    cmd.args(["config", "get", "prefix"])
        .env("PATH", platform::login_shell_path())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    platform::configure_background_command(&mut cmd);
    match cmd.output().await {
        Ok(out) if out.status.success() => {
            normalize_npm_prefix(Path::new(String::from_utf8_lossy(&out.stdout).trim()))
                .or_else(|| paths::user_npm_prefix().and_then(|path| normalize_npm_prefix(&path)))
        }
        _ => paths::user_npm_prefix().and_then(|path| normalize_npm_prefix(&path)),
    }
}

fn normalize_npm_prefix(raw: &Path) -> Option<PathBuf> {
    let raw = raw.to_string_lossy();
    let value = raw.trim().trim_matches(['"', '\'']);
    if value.is_empty() || matches!(value, "null" | "undefined") {
        return None;
    }
    let path = if value == "~" {
        platform::home_dir()?
    } else if value.starts_with("~/") || value.starts_with("~\\") {
        platform::home_dir()?.join(value[2..].trim_start_matches(['/', '\\']))
    } else {
        PathBuf::from(value)
    };
    path.is_absolute().then_some(path)
}

fn prefix_bin_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    }
}

fn prefix_bin_is_on_login_path(prefix: &std::path::Path) -> bool {
    let expected = prefix_bin_dir(prefix);
    let expected = std::fs::canonicalize(&expected).unwrap_or(expected);
    std::env::split_paths(platform::login_shell_path()).any(|entry| {
        let entry = std::fs::canonicalize(&entry).unwrap_or(entry);
        if cfg!(windows) {
            entry
                .to_string_lossy()
                .eq_ignore_ascii_case(&expected.to_string_lossy())
        } else {
            entry == expected
        }
    })
}

async fn pick_install_target(app: &tauri::AppHandle, step: &str) -> Result<PathBuf, String> {
    if let Some(prefix) = paths::configured_npm_prefix() {
        if !try_use_prefix(&prefix) {
            return Err(format!(
                "The selected npm global prefix is not writable: {}",
                prefix.display()
            ));
        }
        emit_keyed(
            app,
            step,
            &format!("Using custom npm prefix {}", prefix.display()),
            "setup.openclaw.customNpmPrefix",
            0.075,
        );
        return Ok(prefix);
    }

    let user_prefix = login_npm_prefix().await;
    if let Some(prefix) = user_prefix {
        if try_use_prefix(&prefix) {
            let terminal_ready = prefix_bin_is_on_login_path(&prefix);
            emit_keyed(
                app,
                step,
                &format!(
                    "Detected npm prefix {} (matches your `npm i -g`); installing openclaw there",
                    prefix.display()
                ),
                if terminal_ready {
                    "setup.openclaw.userNpmPrefix"
                } else {
                    "setup.openclaw.userNpmPrefixMissingPath"
                },
                0.075,
            );
            return Ok(prefix);
        }
        return Err(format!(
            "npm reports global prefix {}, but it is not writable. Choose a custom OpenClaw npm directory in the installation guide or update npm's own prefix.",
            prefix.display()
        ));
    }

    Err(
        "npm did not report an absolute global prefix. Install Node.js/npm normally, or choose a custom OpenClaw npm directory in the installation guide."
            .into(),
    )
}

/// Decide whether `path` is a usable install target. Returns true when
/// the directory exists (or can be created) AND we can write a probe
/// file into it. `false` means the caller should fall through to the
/// next fallback tier.
fn try_use_prefix(path: &std::path::Path) -> bool {
    if !path.exists() {
        if std::fs::create_dir_all(path).is_err() {
            return false;
        }
    }
    // Probe-write into the dir itself. Use a per-process unique name
    // so concurrent installs can't collide on the probe file.
    let probe = path.join(format!(
        ".junqi-write-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn openclaw_node_modules_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.join("node_modules")
    } else {
        prefix.join("lib").join("node_modules")
    }
}

fn windows_openclaw_package_dir(prefix: &std::path::Path) -> PathBuf {
    prefix.join("node_modules").join("openclaw")
}

fn validate_staged_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let package_dir = windows_openclaw_package_dir(prefix);
    let package_json = package_dir.join("package.json");
    let launcher = prefix.join("openclaw.cmd");
    if package_json.is_file() && launcher.is_file() {
        return Ok(());
    }
    Err(format!(
        "npm finished but the isolated OpenClaw install is incomplete at {}",
        prefix.display()
    ))
}

const OPENCLAW_PROMOTION_MARKER: &str = ".junqi-openclaw-promotion.json";
const OPENCLAW_PROMOTION_BACKUP: &str = ".junqi-openclaw-promotion-backup";
const OPENCLAW_PROMOTION_STAGED_SHIMS: &str = ".junqi-openclaw-promotion-shims";
const OPENCLAW_SHIMS: [&str; 3] = ["openclaw", "openclaw.cmd", "openclaw.ps1"];

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct OpenClawPromotionState {
    had_existing_package: bool,
    existing_shims: Vec<String>,
}

fn recover_interrupted_openclaw_promotion(target_prefix: &Path) -> Result<(), String> {
    let marker = target_prefix.join(OPENCLAW_PROMOTION_MARKER);
    if !marker.is_file() {
        return Ok(());
    }
    let state: OpenClawPromotionState = serde_json::from_str(
        &std::fs::read_to_string(&marker)
            .map_err(|error| format!("Cannot read OpenClaw promotion marker: {error}"))?,
    )
    .map_err(|error| format!("Cannot parse OpenClaw promotion marker: {error}"))?;
    let target_package = windows_openclaw_package_dir(target_prefix);
    let backup_root = target_prefix.join(OPENCLAW_PROMOTION_BACKUP);
    let backup_package = backup_root.join("package");
    let backup_shims = backup_root.join("shims");

    if backup_package.exists() {
        if target_package.exists() {
            std::fs::remove_dir_all(&target_package)
                .map_err(|error| format!("Cannot remove partial OpenClaw package: {error}"))?;
        }
        std::fs::rename(&backup_package, &target_package)
            .map_err(|error| format!("Cannot restore previous OpenClaw package: {error}"))?;
    } else if !state.had_existing_package && target_package.exists() {
        std::fs::remove_dir_all(&target_package)
            .map_err(|error| format!("Cannot remove interrupted OpenClaw package: {error}"))?;
    }

    for shim in OPENCLAW_SHIMS {
        let target = target_prefix.join(shim);
        let backup = backup_shims.join(shim);
        if backup.is_file() {
            if target.exists() {
                std::fs::remove_file(&target)
                    .map_err(|error| format!("Cannot remove partial launcher {shim}: {error}"))?;
            }
            std::fs::rename(&backup, &target)
                .map_err(|error| format!("Cannot restore launcher {shim}: {error}"))?;
        } else if !state.existing_shims.iter().any(|name| name == shim) && target.exists() {
            std::fs::remove_file(&target)
                .map_err(|error| format!("Cannot remove interrupted launcher {shim}: {error}"))?;
        }
    }

    let _ = std::fs::remove_dir_all(&backup_root);
    let _ = std::fs::remove_dir_all(target_prefix.join(OPENCLAW_PROMOTION_STAGED_SHIMS));
    std::fs::remove_file(&marker)
        .map_err(|error| format!("Cannot clear OpenClaw promotion marker: {error}"))
}

async fn promote_staged_openclaw_install(
    staging_prefix: &std::path::Path,
    target_prefix: &std::path::Path,
) -> Result<(), String> {
    std::fs::create_dir_all(target_prefix)
        .map_err(|error| format!("Cannot prepare OpenClaw target: {error}"))?;
    recover_interrupted_openclaw_promotion(target_prefix)?;

    let staged_package = windows_openclaw_package_dir(staging_prefix);
    let target_node_modules = target_prefix.join("node_modules");
    let target_package = target_node_modules.join("openclaw");
    let backup_root = target_prefix.join(OPENCLAW_PROMOTION_BACKUP);
    let backup_package = backup_root.join("package");
    let backup_shims = backup_root.join("shims");
    let staged_shims = target_prefix.join(OPENCLAW_PROMOTION_STAGED_SHIMS);
    let marker = target_prefix.join(OPENCLAW_PROMOTION_MARKER);
    let mut last_error = String::new();

    for attempt in 0..6 {
        std::fs::create_dir_all(&target_node_modules).map_err(|error| {
            format!(
                "Cannot prepare the OpenClaw package directory {}: {}",
                target_node_modules.display(),
                error
            )
        })?;
        let _ = std::fs::remove_dir_all(&backup_root);
        let _ = std::fs::remove_dir_all(&staged_shims);
        std::fs::create_dir_all(&staged_shims)
            .map_err(|error| format!("Cannot stage OpenClaw launchers: {error}"))?;
        for shim in OPENCLAW_SHIMS {
            let source = staging_prefix.join(shim);
            if source.is_file() {
                std::fs::copy(&source, staged_shims.join(shim))
                    .map_err(|error| format!("Cannot stage OpenClaw launcher {shim}: {error}"))?;
            }
        }
        if !staged_shims.join("openclaw.cmd").is_file() {
            return Err("The staged OpenClaw installation has no Windows command launcher".into());
        }

        let state = OpenClawPromotionState {
            had_existing_package: target_package.exists(),
            existing_shims: OPENCLAW_SHIMS
                .iter()
                .filter(|shim| target_prefix.join(shim).is_file())
                .map(|shim| (*shim).to_string())
                .collect(),
        };
        paths::atomic_write_text(
            &marker,
            &serde_json::to_string(&state)
                .map_err(|error| format!("Cannot serialize OpenClaw promotion state: {error}"))?,
        )?;

        let activation = (|| -> Result<(), String> {
            std::fs::create_dir_all(&backup_shims)
                .map_err(|error| format!("Cannot prepare OpenClaw backup: {error}"))?;
            if state.had_existing_package {
                std::fs::rename(&target_package, &backup_package).map_err(|error| {
                    format!("Cannot move the current OpenClaw installation because it is in use: {error}")
                })?;
            }
            for shim in &state.existing_shims {
                std::fs::rename(target_prefix.join(shim), backup_shims.join(shim))
                    .map_err(|error| format!("Cannot back up launcher {shim}: {error}"))?;
            }

            std::fs::rename(&staged_package, &target_package)
                .map_err(|error| format!("Cannot activate the staged OpenClaw package: {error}"))?;
            for shim in OPENCLAW_SHIMS {
                let source = staged_shims.join(shim);
                if source.is_file() {
                    std::fs::rename(&source, target_prefix.join(shim))
                        .map_err(|error| format!("Cannot activate launcher {shim}: {error}"))?;
                }
            }
            validate_staged_openclaw_install(target_prefix)
        })();

        match activation {
            Ok(()) => {
                std::fs::remove_file(&marker)
                    .map_err(|error| format!("Cannot finalize OpenClaw promotion: {error}"))?;
                let _ = std::fs::remove_dir_all(&backup_root);
                let _ = std::fs::remove_dir_all(&staged_shims);
                return Ok(());
            }
            Err(error) => {
                last_error = error;
                if let Err(rollback_error) = recover_interrupted_openclaw_promotion(target_prefix) {
                    return Err(format!(
                        "OpenClaw activation failed: {last_error}; rollback also failed: {rollback_error}"
                    ));
                }
                if !staged_package.exists() {
                    return Err(format!(
                        "OpenClaw activation failed and was rolled back: {last_error}"
                    ));
                }
            }
        }

        if attempt < 5 {
            tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1))).await;
        }
    }

    Err(format!(
        "OpenClaw was downloaded safely, but its current installation is locked. Close OpenClaw, Gateway, and any antivirus scan using {}, then retry. Last error: {}",
        target_prefix.display(),
        last_error
    ))
}

/// Remove only a broken npm package payload before reinstalling it. User data
/// lives under `~/.openclaw`, outside every npm prefix selected above.
fn remove_broken_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let node_modules = openclaw_node_modules_dir(prefix);
    let package_dir = node_modules.join("openclaw");
    if package_dir.exists() {
        std::fs::remove_dir_all(&package_dir).map_err(|error| {
            format!(
                "Cannot remove the incomplete OpenClaw package at {}: {}. Close running OpenClaw processes and retry.",
                package_dir.display(),
                error
            )
        })?;
    }

    if let Ok(entries) = std::fs::read_dir(&node_modules) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with(".openclaw-") {
                let path = entry.path();
                let result = if path.is_dir() {
                    std::fs::remove_dir_all(&path)
                } else {
                    std::fs::remove_file(&path)
                };
                result.map_err(|error| {
                    format!(
                        "Cannot remove the incomplete npm staging path {}: {}. Close running OpenClaw processes and retry.",
                        path.display(),
                        error
                    )
                })?;
            }
        }
    }

    let shim_dir = if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    };
    for shim in ["openclaw", "openclaw.cmd", "openclaw.ps1"] {
        let path = shim_dir.join(shim);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|error| {
                format!(
                    "Cannot remove the stale OpenClaw launcher at {}: {}. Close running OpenClaw processes and retry.",
                    path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn install_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<String, String> {
    install_openclaw_impl(app, state, OpenclawInstallMode::Normal).await
}

/// Reinstall the selected OpenClaw package even when a binary is still
/// detectable. This is deliberately separate from normal first-install
/// detection so a user-visible "reinstall" action has real repair semantics.
#[tauri::command]
pub async fn reinstall_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<String, String> {
    install_openclaw_impl(app, state, OpenclawInstallMode::ReinstallExisting).await
}

#[tauri::command]
pub async fn relocate_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<String, String> {
    if !paths::openclaw_relocation_required() {
        return Err("OpenClaw relocation was not requested by storage migration".into());
    }
    install_openclaw_impl(app, state, OpenclawInstallMode::Relocate).await
}

fn existing_npm_prefix_for_reinstall(binary: &Path, windows: bool) -> Option<PathBuf> {
    crate::commands::system::npm_prefix_for_openclaw_binary(binary, windows)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenclawInstallMode {
    Normal,
    ReinstallExisting,
    Relocate,
}

impl OpenclawInstallMode {
    /// Every install entry point honors a persisted relocation request. This
    /// keeps future callers from reusing the old npm prefix while a storage
    /// migration is unfinished.
    fn for_current_storage(self) -> Self {
        if paths::openclaw_relocation_required() {
            Self::Relocate
        } else {
            self
        }
    }

    fn forces_npm_install(self) -> bool {
        !matches!(self, Self::Normal)
    }
}

fn verify_relocated_openclaw_prefix(binary: &Path, expected_prefix: &Path) -> Result<(), String> {
    let installed_prefix =
        crate::commands::system::npm_prefix_for_openclaw_binary(binary, cfg!(windows)).ok_or_else(
            || {
                format!(
                    "OpenClaw was installed but its npm prefix could not be verified: {}",
                    binary.display()
                )
            },
        )?;
    if paths::paths_refer_to_same_location(&installed_prefix, expected_prefix) {
        return Ok(());
    }
    Err(format!(
        "OpenClaw was installed at {}, but the selected npm directory is {}",
        installed_prefix.display(),
        expected_prefix.display()
    ))
}

#[derive(Debug, Clone)]
struct OpenclawRelocationRequest {
    expected_npm_prefix: Option<PathBuf>,
}

impl OpenclawRelocationRequest {
    fn capture() -> Result<Self, String> {
        let layout = paths::load_storage_bootstrap()
            .ok_or("Storage setup must be completed before relocating OpenClaw")?;
        if !layout.openclaw_relocation_required {
            return Err("OpenClaw relocation is no longer pending".into());
        }
        Ok(Self {
            expected_npm_prefix: layout.npm_prefix,
        })
    }

    fn commit(&self, binary: &Path, installed_prefix: &Path) -> Result<(), String> {
        verify_relocated_openclaw_prefix(binary, installed_prefix)?;
        crate::commands::terminal_integration::sync_terminal_integration_for_relocation(binary)?;
        crate::commands::system::persist_selected_openclaw_binary(binary)?;
        paths::complete_openclaw_relocation(self.expected_npm_prefix.as_deref())
    }
}

async fn install_openclaw_impl(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    mode: OpenclawInstallMode,
) -> Result<String, String> {
    let step = "openclaw";
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let install_lock = OPENCLAW_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = install_lock.lock().await;
    let mode = mode.for_current_storage();
    let relocation = matches!(mode, OpenclawInstallMode::Relocate)
        .then(OpenclawRelocationRequest::capture)
        .transpose()?;

    emit_keyed(
        &app,
        step,
        "Checking for existing local OpenClaw...",
        "setup.openclaw.checkExisting",
        0.02,
    );
    let existing = crate::commands::system::detect_openclaw().await;
    if existing.installed && matches!(mode, OpenclawInstallMode::Normal) {
        let detail = match (&existing.version, &existing.path) {
            (Some(version), Some(path)) => {
                format!("Using existing OpenClaw {} at {}", version, path)
            }
            (_, Some(path)) => format!("Using existing OpenClaw at {}", path),
            _ => "Using existing local OpenClaw".to_string(),
        };
        if paths::terminal_integration_requested() {
            crate::commands::terminal_integration::sync_terminal_integration()?;
        }
        emit_keyed(&app, step, &detail, "setup.openclaw.useExisting", 1.0);
        return Ok(detail);
    }

    if matches!(mode, OpenclawInstallMode::ReinstallExisting) && existing.installed {
        emit_keyed(
            &app,
            step,
            "Reinstalling the detected OpenClaw package...",
            "setup.openclaw.reinstall",
            0.03,
        );
    }

    if matches!(mode, OpenclawInstallMode::Relocate) {
        emit_keyed(
            &app,
            step,
            "Moving OpenClaw to the newly selected npm directory...",
            "setup.openclaw.relocate",
            0.03,
        );
    } else if matches!(mode, OpenclawInstallMode::Normal) {
        emit_keyed(
            &app,
            step,
            "No existing OpenClaw was found; installing a managed local OpenClaw for this computer...",
            "setup.openclaw.firstInstall",
            0.03,
        );
    }

    let target = target_openclaw_install_target().await?;
    let compatible_node =
        ensure_compatible_node_runtime(&app, step, &target.node_requirement).await?;

    // ① 定位 Node.js 二进制
    emit_keyed(
        &app,
        step,
        "Locating Node.js executable...",
        "setup.openclaw.locateNode",
        0.05,
    );
    let node_cmd = if let Some(path) = compatible_node.path.filter(|_| compatible_node.available) {
        emit_keyed(
            &app,
            step,
            &format!("Using detected Node.js: {}", path),
            "setup.openclaw.useLocalNode",
            0.05,
        );
        path
    } else {
        return Err("A compatible Node.js runtime was not detected".into());
    };

    // Use the npm bundled with the exact Node.js runtime selected above when
    // it is available. This keeps installation and later Gateway execution on
    // one verified Node.js release instead of mixing PATH shims.
    let npm_cli = crate::commands::system::npm_cli_for_node(Path::new(&node_cmd));
    let npm_cli = if let Some(npm_cli) = npm_cli {
        emit_keyed(
            &app,
            step,
            &format!(
                "Using npm bundled with selected Node.js: {}",
                npm_cli.display()
            ),
            "setup.openclaw.useNodeNpm",
            0.07,
        );
        Some(npm_cli.to_string_lossy().to_string())
    } else {
        emit_keyed(
            &app,
            step,
            "Using system npm",
            "setup.openclaw.useSystemNpm",
            0.07,
        );
        None
    };

    // ② Resolve the install prefix dynamically. An explicit setup choice
    // wins; otherwise use the login terminal's actual npm prefix. No
    // user-specific path is hard-coded here and no hidden prefix is created.
    let openclaw_prefix = match mode {
        OpenclawInstallMode::ReinstallExisting => existing
            .path
            .as_deref()
            .and_then(|path| existing_npm_prefix_for_reinstall(Path::new(path), cfg!(windows)))
            .ok_or_else(|| {
                "The detected OpenClaw is not an npm installation JunQi can safely replace in place. Update or reinstall it with its original package manager, then retry."
                    .to_string()
            })?,
        OpenclawInstallMode::Relocate => {
            pick_install_target(&app, step).await?
        }
        OpenclawInstallMode::Normal => pick_install_target(&app, step).await?,
    };
    emit_keyed(
        &app,
        step,
        &format!("Preparing install target {}...", openclaw_prefix.display()),
        "setup.openclaw.prepareDir",
        0.08,
    );
    std::fs::create_dir_all(&openclaw_prefix).ok();
    if !cfg!(windows) && !existing.installed {
        remove_broken_openclaw_install(&openclaw_prefix)?;
    }

    // ③ npm install（CN 源优先，官方兜底，全程输出实时日志）
    emit(
        &app,
        step,
        "Checking npmjs.org and npmmirror.com, then using the fastest current source...",
        0.10,
    );

    npm_install_with_fallback(
        &app,
        step,
        &node_cmd,
        npm_cli.as_deref(),
        &openclaw_prefix,
        &target.release,
        mode.forces_npm_install(),
        0.10,
        0.90,
    )
    .await?;

    // ④ 验证
    emit_keyed(
        &app,
        step,
        "Verifying openclaw installation...",
        "setup.openclaw.verify",
        0.92,
    );
    // `npm i -g <prefix>` 写出来的 bin 在 `<prefix>/bin/<name>`，部分
    // 环境下也可能落在 `<prefix>/node_modules/.bin/<name>`，优先前者
    // 后者兜底。`openclaw_prefix` 已经是 `pick_install_target` 选出来的
    // 真实落点（用户 npm prefix 或显式选择的前缀），不要再回退到任何
    // 隐藏的全局目录。
    let mut openclaw_bin = if cfg!(windows) {
        openclaw_prefix.join("openclaw.cmd")
    } else {
        openclaw_prefix
            .join("bin")
            .join(platform::bin_name("openclaw"))
    };
    if !openclaw_bin.exists() {
        let alt_bin = openclaw_prefix
            .join("node_modules")
            .join(".bin")
            .join(platform::bin_name("openclaw"));
        if !alt_bin.exists() {
            return Err("No executable found in openclaw install directory, please retry".into());
        }
        openclaw_bin = alt_bin;
    }

    let search_path = crate::commands::system::openclaw_search_path();
    let verified =
        crate::commands::system::validate_openclaw_binary(&openclaw_bin, &search_path).await;
    if !verified.installed {
        return Err(format!(
            "OpenClaw was installed but failed validation: {}",
            verified
                .error
                .unwrap_or_else(|| "unknown validation error".into())
        ));
    }
    let installed_package_version =
        crate::commands::system::openclaw_package_version_for_binary(&openclaw_bin)?;
    if installed_package_version != target.release.version() {
        return Err(format!(
            "OpenClaw package version mismatch after installation: expected {}, found {}",
            target.release.version(),
            installed_package_version
        ));
    }
    let installed_requirement =
        crate::commands::system::required_node_requirement_for_openclaw_binary(&openclaw_bin)?;
    if installed_requirement.expression() != target.node_requirement.expression() {
        return Err(format!(
            "OpenClaw {} changed its Node.js requirement during installation: expected {}, found {}",
            installed_package_version,
            target.node_requirement.expression(),
            installed_requirement.expression()
        ));
    }
    let post_install_node =
        crate::commands::system::check_node_for_requirement(&installed_requirement).await?;
    if !post_install_node.available {
        return Err(format!(
            "OpenClaw {} requires Node.js {}, but the selected runtime is no longer compatible after installation",
            installed_package_version,
            installed_requirement.expression()
        ));
    }
    if let Some(relocation) = relocation {
        relocation.commit(&openclaw_bin, &openclaw_prefix)?;
    } else {
        if paths::terminal_integration_requested() {
            crate::commands::terminal_integration::sync_terminal_integration()?;
        }
        crate::commands::system::persist_selected_openclaw_binary(&openclaw_bin)?;
    }

    let installed_version = verified.version.unwrap_or_else(|| "unknown version".into());
    emit(
        &app,
        step,
        &format!("OpenClaw {} installed successfully ✓", installed_version),
        1.0,
    );
    Ok(format!(
        "OpenClaw {} installed successfully",
        installed_version
    ))
}

/// 准备 Gateway — 在 install_openclaw 完成后由前端调用。
///
/// 输出 step="gateway" 的 setup-progress 事件，前端会拿这些 message
/// 当作实时状态文本展示。这一组文案与 "正在准备 OpenClaw Gateway…
/// 检测、连接并同步运行时状态…" 的形态保持一致——逐条细分、可读、
/// 进度平滑推进。
#[tauri::command]
pub async fn prepare_gateway(app: tauri::AppHandle) -> Result<String, String> {
    if matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Docker
    ) {
        return Err(
            "Docker is the selected OpenClaw runtime. Start its container instead of preparing a native Gateway."
                .to_string(),
        );
    }
    crate::commands::system::ensure_openclaw_relocation_complete()?;
    let step = "gateway";

    // ⓘ Stage 1: detect local runtime
    emit_keyed(
        &app,
        step,
        "Preparing OpenClaw Gateway...",
        "setup.gateway.preparing",
        0.05,
    );
    tokio::time::sleep(std::time::Duration::from_millis(120)).await;

    emit_keyed(
        &app,
        step,
        "Detecting local runtime (Node.js / npm / openclaw binary)...",
        "setup.gateway.detectRuntime",
        0.12,
    );

    let node_ok = crate::commands::system::check_node()
        .await
        .map(|status| status.available)
        .unwrap_or(false);
    let openclaw_status = crate::commands::system::detect_openclaw().await;
    let oclaw_ok = openclaw_status.installed;
    let summary = format!(
        "Runtime check done: {} {}",
        if node_ok {
            "Node.js ✓,"
        } else {
            "Node.js ✗,"
        },
        if oclaw_ok {
            "openclaw ✓"
        } else {
            "openclaw ✗"
        },
    );
    emit_keyed(&app, step, &summary, "setup.gateway.runtimeSummary", 0.22);
    if !oclaw_ok {
        return Err(format!(
            "OpenClaw is not ready for Gateway startup: {}",
            openclaw_status
                .error
                .unwrap_or_else(|| "validation failed".into())
        ));
    }
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // ⓘ Stage 2: config port probing
    let config_path = paths::config_path();
    emit_keyed(
        &app,
        step,
        &format!("Reading gateway port from {}...", config_path.display()),
        "setup.gateway.readPort",
        0.32,
    );
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let port = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|cfg| crate::commands::config::gateway_port_from_config(&cfg))
        .unwrap_or_else(crate::commands::config::default_gateway_port);
    emit_keyed(
        &app,
        step,
        &format!(
            "Target port = {} (source: openclaw.json or OpenClaw default)",
            port
        ),
        "setup.gateway.portResolved",
        0.42,
    );
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    // ⓘ Stage 3: probe existing Gateway process
    emit_keyed(
        &app,
        step,
        &format!(
            "Probing {}:{} for existing Gateway listener...",
            crate::commands::config::default_gateway_host(),
            port,
        ),
        "setup.gateway.probe",
        0.52,
    );

    let reachable = crate::commands::gateway::is_gateway_healthy(port).await;
    if reachable {
        emit_keyed(
            &app,
            step,
            &format!(
                "OpenClaw Gateway health check passed on port {}; skipping start",
                port
            ),
            "setup.gateway.alreadyUp",
            0.92,
        );
        emit_keyed(&app, step, "Gateway is ready ✓", "setup.gateway.ready", 1.0);
    } else {
        emit_keyed(
            &app,
            step,
            "No Gateway detected - the frontend launcher will start it",
            "setup.gateway.willStart",
            0.62,
        );
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        emit_keyed(
            &app,
            step,
            "Syncing runtime state (AGENTS / SESSIONS / HEALTH)...",
            "setup.gateway.syncState",
            0.78,
        );
        emit_keyed(
            &app,
            step,
            "Gateway prepared; starting service next...",
            "setup.gateway.preparedToStart",
            1.0,
        );
    }

    Ok(format!("Gateway prepared on port {}", port))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "junqi-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_windows_openclaw(prefix: &Path, version: &str) {
        let package = windows_openclaw_package_dir(prefix);
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(
            package.join("package.json"),
            format!(r#"{{"name":"openclaw","version":"{version}"}}"#),
        )
        .unwrap();
        std::fs::write(prefix.join("openclaw.cmd"), format!("@echo {version}\r\n")).unwrap();
    }

    #[test]
    fn npm_prefix_normalization_rejects_ambiguous_values() {
        assert_eq!(normalize_npm_prefix(Path::new("")), None);
        assert_eq!(normalize_npm_prefix(Path::new("undefined")), None);
        assert_eq!(normalize_npm_prefix(Path::new("relative/prefix")), None);

        let absolute = std::env::temp_dir().join("junqi-npm-prefix");
        assert_eq!(normalize_npm_prefix(&absolute), Some(absolute));
        assert!(normalize_npm_prefix(Path::new("~/junqi-npm-prefix"))
            .is_some_and(|path| path.is_absolute()));
    }

    #[test]
    fn node_checksum_parser_requires_the_exact_archive_name() {
        let digest = "a".repeat(64);
        let checksums = format!(
            "{digest}  node-v24.18.1-win-x64.zip\n{}  node-v24.18.1-win-arm64.zip\n",
            "b".repeat(64)
        );
        assert_eq!(
            parse_shasums(&checksums, "node-v24.18.1-win-x64.zip"),
            Some(digest)
        );
        assert_eq!(parse_shasums(&checksums, "node-v24.18.1-win-x86.zip"), None);
    }

    #[test]
    fn npm_log_filter_hides_internal_noise_but_keeps_download_progress() {
        assert_eq!(
            npm_log_line_for_display("npm verbose cli /usr/bin/node /usr/bin/npm"),
            None
        );
        assert_eq!(
            npm_log_line_for_display("npm http fetch GET 200 https://registry.npmjs.org/openclaw"),
            Some("npm http fetch GET 200 https://registry.npmjs.org/openclaw".into())
        );
        assert_eq!(
            npm_log_line_for_display("npm warn deprecated package@1.0.0"),
            Some("npm warn deprecated package@1.0.0".into())
        );
    }

    #[test]
    fn npm_log_filter_redacts_credentials() {
        assert_eq!(
            npm_log_line_for_display("npm error authorization: Bearer secret-value"),
            Some("[authentication details redacted]".into())
        );
        assert_eq!(
            npm_log_line_for_display("request https://user:secret@example.com/package failed"),
            Some("request [registry URL redacted] failed".into())
        );
    }

    #[test]
    fn npm_log_filter_bounds_untrusted_output() {
        let output = npm_log_line_for_display(&"x".repeat(1_500)).expect("line remains visible");
        assert_eq!(output.chars().count(), 1_001);
        assert!(output.ends_with('…'));
    }

    #[tokio::test]
    async fn openclaw_promotion_replaces_package_and_clears_transaction() {
        let root = test_dir("openclaw-promote");
        let staging = root.join("staging");
        let target = root.join("target");
        write_windows_openclaw(&staging, "2.0.0");
        write_windows_openclaw(&target, "1.0.0");

        promote_staged_openclaw_install(&staging, &target)
            .await
            .unwrap();

        let package =
            std::fs::read_to_string(windows_openclaw_package_dir(&target).join("package.json"))
                .unwrap();
        assert!(package.contains("2.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        assert!(!target.join(OPENCLAW_PROMOTION_BACKUP).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_openclaw_promotion_restores_package_and_launcher() {
        let root = test_dir("openclaw-rollback");
        let target = root.join("target");
        let backup = target.join(OPENCLAW_PROMOTION_BACKUP);
        write_windows_openclaw(&target, "2.0.0");
        write_windows_openclaw(&backup, "1.0.0");
        std::fs::create_dir_all(backup.join("shims")).unwrap();
        std::fs::rename(
            windows_openclaw_package_dir(&backup),
            backup.join("package"),
        )
        .unwrap();
        std::fs::rename(
            backup.join("openclaw.cmd"),
            backup.join("shims").join("openclaw.cmd"),
        )
        .unwrap();
        paths::atomic_write_text(
            &target.join(OPENCLAW_PROMOTION_MARKER),
            &serde_json::to_string(&OpenClawPromotionState {
                had_existing_package: true,
                existing_shims: vec!["openclaw.cmd".into()],
            })
            .unwrap(),
        )
        .unwrap();

        recover_interrupted_openclaw_promotion(&target).unwrap();

        let package =
            std::fs::read_to_string(windows_openclaw_package_dir(&target).join("package.json"))
                .unwrap();
        assert!(package.contains("1.0.0"));
        assert!(std::fs::read_to_string(target.join("openclaw.cmd"))
            .unwrap()
            .contains("1.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reinstall_resolves_the_detected_npm_prefix_in_place() {
        let root = test_dir("openclaw-reinstall-prefix");
        write_windows_openclaw(&root, "1.0.0");
        let dot_bin = root.join("node_modules").join(".bin").join("openclaw.cmd");
        std::fs::create_dir_all(dot_bin.parent().unwrap()).unwrap();
        std::fs::write(&dot_bin, "@echo off\r\n").unwrap();

        assert_eq!(
            existing_npm_prefix_for_reinstall(&root.join("openclaw.cmd"), true),
            Some(root.clone())
        );
        assert_eq!(
            existing_npm_prefix_for_reinstall(&dot_bin, true),
            Some(root.clone())
        );
        assert_eq!(
            existing_npm_prefix_for_reinstall(&root.join("elsewhere").join("openclaw.cmd"), true),
            None
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn process_activity_wait_returns_exit_status() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "process.exit(0)"])
            .spawn()
            .expect("Node.js is required by the desktop build");
        let (_activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);

        // Hosted CI runners can take more than a second to schedule a freshly
        // spawned Node process. Keep the inactivity budget representative of
        // process startup while retaining a separate hard test deadline.
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            wait_for_process_activity(
                &mut child,
                &mut activity_rx,
                std::time::Duration::from_secs(10),
            ),
        )
        .await
        .expect("process activity wait must finish within the test deadline");

        assert!(matches!(result, NpmWaitResult::Exited(Ok(status)) if status.success()));
    }

    #[tokio::test]
    async fn process_activity_wait_detects_inactivity() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => {}, 10000)"])
            .spawn()
            .expect("Node.js is required by the desktop build");
        let (_activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);

        let result = wait_for_process_activity(
            &mut child,
            &mut activity_rx,
            std::time::Duration::from_millis(25),
        )
        .await;

        assert!(matches!(result, NpmWaitResult::Inactive));
        let pid = child.id();
        terminate_process_tree(&mut child, pid).await;
    }
}
