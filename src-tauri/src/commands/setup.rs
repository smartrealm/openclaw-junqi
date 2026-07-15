use crate::commands::git_runtime::{
    select_managed_git_artifact, GitForWindowsRelease, ManagedGitArtifact,
    GIT_FOR_WINDOWS_LATEST_RELEASE,
};
use crate::commands::node_runtime::{
    current_platform_artifact, select_preferred_release, NodeDistributionRelease,
    NodeRequirementSource, NodeRuntimeRequirement,
};
use crate::commands::npm_registry;
use crate::commands::process_control::terminate_process_tree;
use crate::commands::setup_progress::{emit, emit_keyed};
use crate::paths;
use crate::platform;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};

static OPENCLAW_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static NODE_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static GIT_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
const NODE_INDEX_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(12);
const OFFICIAL_NODE_INDEX: &str = "https://nodejs.org/dist/index.json";
const CHINA_NODE_INDEX: &str = "https://npmmirror.com/mirrors/node/index.json";

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn runtime_binary(root: &Path, tool: &str) -> PathBuf {
    match (tool, cfg!(windows)) {
        ("node", true) => root.join("node.exe"),
        ("node", false) => root.join("bin").join("node"),
        ("git", true) => root.join("cmd").join("git.exe"),
        ("git", false) => root.join("bin").join("git"),
        _ => root.join(tool),
    }
}

fn staged_npm_cli(root: &Path) -> PathBuf {
    let npm_root = if cfg!(windows) {
        root.join("node_modules")
    } else {
        root.join("lib").join("node_modules")
    };
    npm_root.join("npm").join("bin").join("npm-cli.js")
}

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
            if let Err(rollback_error) = std::fs::rename(&backup, target) {
                return Err(format!(
                    "Failed to activate managed {name} update: {error}; rollback also failed: {rollback_error}"
                ));
            }
        }
        return Err(format!("Failed to activate managed {name} update: {error}"));
    }
    let _ = std::fs::remove_dir_all(backup);
    Ok(())
}

// ─── Platform helpers ──────────────────────────────────────────────────────────

#[cfg(windows)]
pub fn refresh_path_from_registry() {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use winreg::enums::*;
    use winreg::RegKey;

    let mut parts: Vec<String> = Vec::new();
    if let Ok(env) = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")
    {
        if let Ok(val) = env.get_raw_value("Path") {
            let wide: Vec<u16> = val
                .bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let s = OsString::from_wide(&wide);
            if let Some(s) = s.to_str() {
                parts.extend(s.trim_end_matches('\0').split(';').map(|p| p.to_string()));
            }
        }
    }
    if let Ok(env) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
        if let Ok(val) = env.get_raw_value("Path") {
            let wide: Vec<u16> = val
                .bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let s = OsString::from_wide(&wide);
            if let Some(s) = s.to_str() {
                parts.extend(s.trim_end_matches('\0').split(';').map(|p| p.to_string()));
            }
        }
    }
    if !parts.is_empty() {
        std::env::set_var("PATH", parts.join(";"));
    }
}

#[cfg(windows)]
pub fn find_git_in_default_paths() -> Option<PathBuf> {
    let candidates = [
        r"C:\Program Files\Git\cmd\git.exe",
        r"C:\Program Files (x86)\Git\cmd\git.exe",
    ];
    for p in &candidates {
        let path = PathBuf::from(p);
        if path.exists() {
            return Some(path);
        }
    }
    None
}

// ─── Download sources ──────────────────────────────────────────────────────────

fn node_filename(version: &str) -> String {
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    };
    if cfg!(windows) {
        format!("node-v{}-win-{}.zip", version, arch)
    } else if cfg!(target_os = "macos") {
        format!("node-v{}-darwin-{}.tar.gz", version, arch)
    } else {
        format!("node-v{}-linux-{}.tar.gz", version, arch)
    }
}

/// (url, display_label) pairs — CN mirror first, official fallback.
fn node_sources(version: &str) -> Vec<(String, &'static str)> {
    let f = node_filename(version);
    vec![
        (
            format!("https://npmmirror.com/mirrors/node/v{}/{}", version, f),
            "npmmirror.com（国内）",
        ),
        (
            format!("https://nodejs.org/dist/v{}/{}", version, f),
            "nodejs.org（官方）",
        ),
    ]
}

// ─── Download helper ───────────────────────────────────────────────────────────

/// Download a file from the first reachable source.
/// Progress events are emitted every ~2 percentage points during streaming.
/// Returns number of bytes written on success.
async fn download_with_fallback(
    app: &tauri::AppHandle,
    step: &str,
    sources: &[(String, &'static str)],
    dest: &PathBuf,
    expected_sha256: Option<&str>,
    prog_start: f64,
    prog_end: f64,
) -> Result<u64, String> {
    let mut last_err = "unknown error".to_string();
    let total_sources = sources.len();

    for (idx, (url, label)) in sources.iter().enumerate() {
        emit(
            app,
            step,
            &format!(
                "【下载 {}/{}】正在连接 {}...",
                idx + 1,
                total_sources,
                label
            ),
            prog_start,
        );

        let resp = match reqwest::get(url.as_str()).await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                last_err = format!("HTTP {}", r.status());
                let next_hint = if idx + 1 < total_sources {
                    "，切换备用源..."
                } else {
                    ""
                };
                emit(
                    app,
                    step,
                    &format!("{} 返回错误 ({}){}", label, last_err, next_hint),
                    prog_start,
                );
                continue;
            }
            Err(e) => {
                last_err = e.to_string();
                let next_hint = if idx + 1 < total_sources {
                    "，切换备用源..."
                } else {
                    ""
                };
                emit(
                    app,
                    step,
                    &format!("{} 无法连接{}", label, next_hint),
                    prog_start,
                );
                continue;
            }
        };

        let total_bytes = resp.content_length().unwrap_or(0);
        let size_str = if total_bytes > 0 {
            format!("{:.1} MB", total_bytes as f64 / 1024.0 / 1024.0)
        } else {
            "大小未知".into()
        };

        emit(
            app,
            step,
            &format!("Connected to {}, size {}, downloading...", label, size_str),
            prog_start,
        );

        let mut downloaded: u64 = 0;
        let mut last_reported_pct: u64 = 0;
        let mut data: Vec<u8> = Vec::with_capacity(total_bytes as usize);
        let mut resp = resp;
        let mut download_ok = true;

        loop {
            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    downloaded += chunk.len() as u64;
                    data.extend_from_slice(&chunk);

                    if total_bytes > 0 {
                        let pct = downloaded * 100 / total_bytes;
                        if pct >= last_reported_pct + 2 {
                            last_reported_pct = pct;
                            let frac = downloaded as f64 / total_bytes as f64;
                            let prog = prog_start + frac * (prog_end - prog_start);
                            emit(
                                app,
                                step,
                                &format!(
                                    "下载中 {}%（{:.1}/{} MB）via {}",
                                    pct,
                                    downloaded as f64 / 1024.0 / 1024.0,
                                    size_str,
                                    label,
                                ),
                                prog,
                            );
                        }
                    } else {
                        // Unknown total: emit every ~2 MB
                        let mb = downloaded / (2 * 1024 * 1024);
                        if mb > last_reported_pct {
                            last_reported_pct = mb;
                            emit(
                                app,
                                step,
                                &format!(
                                    "Downloading... got {:.1} MB via {}",
                                    downloaded as f64 / 1024.0 / 1024.0,
                                    label
                                ),
                                prog_start + 0.1,
                            );
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    last_err = format!("传输中断: {}", e);
                    download_ok = false;
                    break;
                }
            }
        }

        if !download_ok || data.is_empty() {
            if idx + 1 < total_sources {
                emit(
                    app,
                    step,
                    "Download failed, switching to fallback source...",
                    prog_start,
                );
            }
            continue;
        }

        if let Some(expected) = expected_sha256 {
            let actual = format!("{:x}", Sha256::digest(&data));
            if !actual.eq_ignore_ascii_case(expected) {
                last_err = format!("SHA-256 mismatch from {label}");
                emit(
                    app,
                    step,
                    &format!("{} 完整性校验失败，切换备用源...", label),
                    prog_start,
                );
                continue;
            }
        }

        std::fs::write(dest, &data).map_err(|e| format!("写入文件失败: {}", e))?;

        emit(
            app,
            step,
            &format!(
                "Download complete ({:.1} MB), source: {}",
                downloaded as f64 / 1024.0 / 1024.0,
                label
            ),
            prog_end,
        );
        return Ok(downloaded);
    }

    Err(format!("所有下载源均失败。最后错误：{}", last_err))
}

// ─── Extraction helpers ────────────────────────────────────────────────────────

fn extract_zip(
    app: &tauri::AppHandle,
    step: &str,
    archive: &PathBuf,
    dest: &PathBuf,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 失败: {}", e))?;
    let total = zip.len();
    emit(
        app,
        step,
        &format!("Extracting, {} files total...", total),
        prog_start,
    );

    for i in 0..total {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        // Strip top-level directory (node-vX.X.X-win-x64/)
        let parts: Vec<&str> = name.splitn(2, '/').collect();
        if parts.len() < 2 || parts[1].is_empty() {
            continue;
        }
        let outpath = dest.join(parts[1]);
        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p).ok();
            }
            let mut out = std::fs::File::create(&outpath)
                .map_err(|e| format!("创建 {} 失败: {}", outpath.display(), e))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("解压 {} 失败: {}", parts[1], e))?;
        }
        if i % 200 == 0 && total > 0 {
            let frac = i as f64 / total as f64;
            emit(
                app,
                step,
                &format!("Extracting {}% ({}/{})...", (frac * 100.0) as u32, i, total),
                prog_start + frac * (prog_end - prog_start),
            );
        }
    }
    Ok(())
}

fn extract_zip_preserving_root(
    app: &tauri::AppHandle,
    step: &str,
    archive: &PathBuf,
    dest: &PathBuf,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("读取 zip 失败: {}", e))?;
    let total = zip.len();
    emit(
        app,
        step,
        &format!("Extracting managed Git runtime ({} files)...", total),
        prog_start,
    );

    for i in 0..total {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(relative) = entry.enclosed_name() else {
            continue;
        };
        let outpath = dest.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut output = std::fs::File::create(&outpath)
                .map_err(|e| format!("创建 {} 失败: {}", outpath.display(), e))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|e| format!("解压 {} 失败: {}", relative.display(), e))?;
        }
        if i % 200 == 0 && total > 0 {
            let fraction = i as f64 / total as f64;
            emit(
                app,
                step,
                &format!(
                    "Extracting Git {}% ({}/{})...",
                    (fraction * 100.0) as u32,
                    i,
                    total
                ),
                prog_start + fraction * (prog_end - prog_start),
            );
        }
    }
    Ok(())
}

fn extract_targz(
    app: &tauri::AppHandle,
    step: &str,
    archive: &PathBuf,
    dest: &PathBuf,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    emit(app, step, "Extracting tar.gz archive...", prog_start);
    let file = std::fs::File::open(archive).map_err(|e| format!("打开压缩包失败: {}", e))?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(gz);
    let mut count: usize = 0;

    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path().map_err(|e| e.to_string())?.to_path_buf();
        let components: Vec<_> = path.components().collect();
        if components.len() < 2 {
            continue;
        }
        // Strip top-level dir (node-vX.X.X-darwin-arm64/)
        let relative: PathBuf = components[1..].iter().collect();
        let outpath = dest.join(&relative);

        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(p) = outpath.parent() {
                std::fs::create_dir_all(p).ok();
            }
            entry
                .unpack(&outpath)
                .map_err(|e| format!("解压 {} 失败: {}", relative.display(), e))?;
        }
        count += 1;
        if count % 200 == 0 {
            // tar.gz doesn't know total entry count upfront; show a count instead
            let prog = (prog_start + (prog_end - prog_start) * 0.5).min(prog_end - 0.05);
            emit(
                app,
                step,
                &format!("Extracting... processed {} files", count),
                prog,
            );
        }
    }
    emit(
        app,
        step,
        &format!("Extraction complete, {} files processed", count),
        prog_end,
    );
    Ok(())
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

/// Run `npm install -g <pkg>` against a user-writable global prefix with
/// live output streaming. The registry order is selected from verified package
/// metadata and current network latency, then returns Ok on first success.
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
    pkg: &str,
    prog_start: f64,
    prog_end: f64,
) -> Result<(), String> {
    let node_bin_dir = paths::node_bin_dir();
    let git_bin_dir = paths::git_bin_dir();
    let node_bin_str = node_bin_dir.to_string_lossy().to_string();
    let git_bin_str = if git_bin_dir.exists() {
        Some(git_bin_dir.to_string_lossy().to_string())
    } else {
        None
    };
    let path_env = platform::build_path(&node_bin_str, git_bin_str.as_deref());
    let install_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    // A fresh cache avoids npm repeatedly reusing a partially extracted tarball
    // after an interrupted Windows install. It is removed when this call ends.
    let npm_cache_root =
        paths::npm_cache_dir().join(format!("install-{}-{}", std::process::id(), install_nonce));
    let _npm_cache_cleanup = TemporaryDirectory(npm_cache_root.clone());
    std::fs::create_dir_all(&npm_cache_root).ok();
    std::fs::create_dir_all(global_prefix).ok();
    let registry_selection = npm_registry::select_npm_registry().await;
    let expected_version = registry_selection.package_version.clone();
    let registries = registry_selection.candidates();
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
            "npm source order: {}{}",
            registry_order,
            expected_version
                .as_deref()
                .map(|version| format!("; OpenClaw latest = {}", version))
                .unwrap_or_default()
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
        // A failed source must not poison the fallback source with partially
        // extracted cache entries.
        let npm_cache = npm_cache_root.join(format!("registry-{}", reg_idx + 1));
        std::fs::create_dir_all(&npm_cache).ok();
        let reg_label = registry.label();
        emit(
            app,
            step,
            &format!(
                "【安装 {}/{}】使用 {} 安装 {}...",
                reg_idx + 1,
                total_regs,
                reg_label,
                pkg
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
            pkg,
        ])
        .env("PATH", &path_env)
        .env("npm_config_prefix", &npm_prefix_str)
        .env("npm_config_cache", &npm_cache)
        // This is deliberately process-scoped. Do not alter user or global npmrc.
        .env("npm_config_registry", registry.url)
        .env("NPM_CONFIG_REGISTRY", registry.url)
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "url.https://github.com/.insteadOf")
        .env("GIT_CONFIG_VALUE_0", "ssh://git@github.com/")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
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
                &format!("{} installed (via {}) ✓", pkg, reg_label),
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

async fn resolve_managed_node_version(
    requirement: &NodeRuntimeRequirement,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(NODE_INDEX_TIMEOUT)
        .timeout(NODE_INDEX_TIMEOUT)
        .user_agent("JunQi Desktop Node.js release resolver")
        .build()
        .map_err(|error| format!("Failed to initialize Node.js release resolver: {error}"))?;
    let (official, mirror) = tokio::join!(
        fetch_node_distribution_index(&client, OFFICIAL_NODE_INDEX),
        fetch_node_distribution_index(&client, CHINA_NODE_INDEX),
    );
    let releases = official.as_deref().or(mirror.as_deref());
    if let Some(version) = releases.and_then(|items| {
        select_preferred_release(requirement, items, &current_platform_artifact())
    }) {
        return Ok(version);
    }
    Err(format!(
        "Unable to resolve a published Node.js release for this platform that satisfies OpenClaw requirement {}",
        requirement.expression()
    ))
}

async fn target_openclaw_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    let selection = npm_registry::select_npm_registry().await;
    if let Some(expression) = selection.node_requirement {
        return NodeRuntimeRequirement::parse(expression, NodeRequirementSource::RegistryPackage);
    }
    crate::commands::system::installed_openclaw_node_requirement()
}

async fn resolve_managed_git_artifact() -> Result<ManagedGitArtifact, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(NODE_INDEX_TIMEOUT)
        .timeout(NODE_INDEX_TIMEOUT)
        .user_agent("JunQi Desktop managed runtime resolver")
        .build()
        .map_err(|error| format!("Failed to initialize Git release resolver: {error}"))?;
    let release = client
        .get(GIT_FOR_WINDOWS_LATEST_RELEASE)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Failed to query Git-for-Windows releases: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Git-for-Windows release query failed: {error}"))?
        .json::<GitForWindowsRelease>()
        .await
        .map_err(|error| format!("Invalid Git-for-Windows release metadata: {error}"))?;
    select_managed_git_artifact(&release, std::env::consts::ARCH)
}

#[tauri::command]
pub async fn install_node(app: tauri::AppHandle) -> Result<String, String> {
    let requirement = target_openclaw_node_requirement().await?;
    install_node_for_requirement(app, requirement, false).await
}

pub(crate) async fn update_managed_node_runtime(app: tauri::AppHandle) -> Result<String, String> {
    let requirement = crate::commands::system::installed_openclaw_node_requirement()?;
    install_node_for_requirement(app, requirement, true).await
}

async fn install_node_for_requirement(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
) -> Result<String, String> {
    let _guard = NODE_INSTALL_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;
    let step = "node";
    let node_dir = paths::runtime_dir().join("node");
    let node_bin = paths::local_node_path();

    // ① 检测现有版本
    emit_keyed(
        &app,
        step,
        "Checking installed Node.js version...",
        "setup.node.check",
        0.02,
    );

    if node_bin.exists() {
        let mut version_command = tokio::process::Command::new(&node_bin);
        version_command.arg("--version");
        platform::configure_background_command(&mut version_command);
        let version_str = version_command.output().await.ok().and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        });

        let bundled_npm_available = paths::local_npm_cli_path().is_file();
        let needs_upgrade = match &version_str {
            Some(v) => !requirement.supports(v) || !bundled_npm_available,
            None => true,
        };

        if !needs_upgrade && !force {
            let ver = version_str.unwrap_or_default();
            emit_keyed(
                &app,
                step,
                &format!(
                    "Node.js {} meets requirement ({}), skipping",
                    ver,
                    requirement.expression()
                ),
                "setup.node.skip",
                1.0,
            );
            return Ok(format!("Node.js {} already installed", ver));
        }

        let ver = if force {
            format!(
                "{}; user requested latest compatible release",
                version_str.unwrap_or_else(|| "current Node.js".into())
            )
        } else if !bundled_npm_available {
            format!(
                "{} with missing bundled npm",
                version_str.unwrap_or_else(|| "unknown Node.js".into())
            )
        } else {
            version_str.unwrap_or_else(|| "older version".into())
        };
        emit_keyed(
            &app,
            step,
            &format!(
                "Detected {}; preparing a managed runtime that satisfies {}...",
                ver,
                requirement.expression()
            ),
            "setup.node.upgrade",
            0.04,
        );
    }

    // ② Download (CN mirror first, official fallback)
    let node_version = resolve_managed_node_version(&requirement).await?;
    emit_keyed(
        &app,
        step,
        &format!(
            "Preparing to download Node.js v{}, prefer CN mirror...",
            node_version
        ),
        "setup.node.prepareDownload",
        0.05,
    );
    let temp_dir = paths::desktop_dir()
        .join("tmp")
        .join(format!("node-download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let archive_path = temp_dir.join(node_filename(&node_version));

    download_with_fallback(
        &app,
        step,
        &node_sources(&node_version),
        &archive_path,
        None,
        0.06,
        0.60,
    )
    .await?;

    // Extract into an isolated directory so a failed update keeps the active runtime.
    let staging_dir = paths::runtime_dir().join(format!(".node-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create Node.js staging directory: {}", e))?;
    let _staging_cleanup = TemporaryDirectory(staging_dir.clone());
    emit_keyed(
        &app,
        step,
        &format!(
            "Extracting to staging directory {}...",
            staging_dir.display()
        ),
        "setup.node.extract",
        0.62,
    );

    if cfg!(windows) {
        extract_zip(&app, step, &archive_path, &staging_dir, 0.62, 0.90)?;
    } else {
        extract_targz(&app, step, &archive_path, &staging_dir, 0.62, 0.90)?;
    }

    // ④ Cleanup
    emit_keyed(
        &app,
        step,
        "Cleaning up temp files...",
        "setup.node.cleanup",
        0.92,
    );
    let _ = std::fs::remove_file(&archive_path);
    let _ = std::fs::remove_dir_all(&temp_dir);

    // ⑤ Verify
    emit_keyed(
        &app,
        step,
        "Verifying installation...",
        "setup.node.verify",
        0.96,
    );
    let staged_node = runtime_binary(&staging_dir, "node");
    if !staged_npm_cli(&staging_dir).is_file() {
        let _ = std::fs::remove_dir_all(&staging_dir);
        return Err("Downloaded Node.js runtime does not contain bundled npm".into());
    }
    let mut version_command = tokio::process::Command::new(&staged_node);
    version_command.arg("--version");
    platform::configure_background_command(&mut version_command);
    let ver = version_command
        .output()
        .await
        .ok()
        .and_then(|o| {
            if o.status.success() {
                Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
            } else {
                None
            }
        })
        .filter(|version| requirement.supports(version))
        .ok_or_else(|| {
            let _ = std::fs::remove_dir_all(&staging_dir);
            format!(
                "Downloaded Node.js runtime does not satisfy OpenClaw requirement {}",
                requirement.expression()
            )
        })?;

    activate_staged_runtime(&staging_dir, &node_dir, "node")?;

    emit_keyed(
        &app,
        step,
        &format!("Node.js {} installed successfully ✓", ver),
        "setup.node.done",
        1.0,
    );
    Ok(format!("Node.js {} installed successfully", ver))
}

/// Ensure child processes use a Node.js release accepted by OpenClaw.
///
/// JunQi's managed Node directory is first on the child PATH, so installing a
/// compatible managed runtime repairs an incompatible system Node without
/// mutating the user's global Node.js installation.
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
                "Node.js is outside OpenClaw's supported range ({} from {}); resolving a compatible managed release...",
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
            "OpenClaw requires Node.js {}; JunQi could not prepare a compatible runtime",
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

pub(crate) async fn update_managed_git_runtime(app: tauri::AppHandle) -> Result<String, String> {
    if !cfg!(windows) {
        return Err(
            "Git is managed by the operating system on macOS/Linux; use the platform package manager"
                .into(),
        );
    }
    install_git_impl(app, true).await
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
    let local_git = paths::local_git_path();
    let system_git = platform::bin_name("git");

    let existing_git = if local_git.exists() {
        Some(local_git.clone())
    } else {
        let mut command = tokio::process::Command::new(&system_git);
        command.arg("--version");
        platform::configure_background_command(&mut command);
        command
            .output()
            .await
            .ok()
            .filter(|output| output.status.success())
            .map(|_| PathBuf::from(&system_git))
    };
    if let Some(git_path) = existing_git.filter(|_| !force) {
        let mut command = tokio::process::Command::new(&git_path);
        command.arg("--version");
        platform::configure_background_command(&mut command);
        let version = command
            .output()
            .await
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
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

    if cfg!(windows) {
        // ── Windows: extract managed MinGit without a wizard or console ───────

        let artifact = resolve_managed_git_artifact().await?;

        emit(
            &app,
            step,
            &format!(
                "Preparing managed MinGit v{} (China mirror first)...",
                artifact.version
            ),
            0.04,
        );

        let temp_dir = paths::desktop_dir()
            .join("tmp")
            .join(format!("git-download-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to create temp dir: {}", e))?;
        let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
        let archive_path = temp_dir.join(&artifact.filename);

        download_with_fallback(
            &app,
            step,
            &artifact.sources(),
            &archive_path,
            Some(&artifact.sha256),
            0.05,
            0.55,
        )
        .await?;
        let git_dir = paths::runtime_dir().join("git");
        let staging_dir = paths::runtime_dir().join(format!(".git-stage-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&staging_dir)
            .map_err(|e| format!("Failed to prepare managed Git staging directory: {}", e))?;
        let _staging_cleanup = TemporaryDirectory(staging_dir.clone());
        if let Err(error) =
            extract_zip_preserving_root(&app, step, &archive_path, &staging_dir, 0.56, 0.88)
        {
            let _ = std::fs::remove_dir_all(&staging_dir);
            return Err(error);
        }

        let _ = std::fs::remove_file(&archive_path);
        let _ = std::fs::remove_dir_all(&temp_dir);

        emit_keyed(
            &app,
            step,
            "Verifying managed Git runtime...",
            "setup.git.verify",
            0.95,
        );

        let staged_git = runtime_binary(&staging_dir, "git");
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
            .ok_or_else(|| {
                let _ = std::fs::remove_dir_all(&staging_dir);
                "Managed Git extraction finished, but git.exe could not be verified".to_string()
            })?;

        activate_staged_runtime(&staging_dir, &git_dir, "git")?;
        emit_keyed(
            &app,
            step,
            &format!("Git {} installed successfully ✓", version),
            "setup.git.done",
            1.0,
        );
        Ok(format!("Git {} installed successfully", version))
    } else {
        emit_keyed(
            &app,
            step,
            "Git is not available. Please install Apple Command Line Tools manually, then retry.",
            "setup.git.manualRequired",
            1.0,
        );
        Err("Git is required. Install Apple Command Line Tools manually, then retry JunQi.".into())
    }
}

/// Pick the directory we hand to `npm install -g` for the openclaw install.
///
/// Order of preference:
/// 1. An explicit custom prefix from the persisted install layout.
/// 2. The user's `npm config get prefix` from npm resolved by the login shell. This
///    matches what `npm i -g openclaw` from the user's terminal would
///    resolve to — same bin, same `package.json`, same place the user
///    can then manage with `npm i -g openclaw@latest`.
/// 3. Whatever is hard-coded in `~/.npmrc` (`prefix=...`).
/// 4. The user-owned `~/.local` fallback.
/// 5. Fall back to the JunQi-managed sandbox at
///    `paths::openclaw_global_dir()` if neither is writable, so the
///    install never silently fails.
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
        // User's npm prefix exists but isn't writable (typical case:
        // default `prefix=/usr/local` from a Homebrew/apt/Stock-Windows
        // install). Fall through to the XDG tier.
    }

    // Tier 2: XDG Base Directory fallback at `~/.local`. User-owned on
    // every platform we ship to, so `npm install -g` always lands and
    // the bin ends up in a place the user can put on PATH.
    let local = paths::local_npm_prefix();
    if try_use_prefix(&local) {
        let bin = paths::local_npm_bin_dir();
        emit_keyed(
            app,
            step,
            &format!(
                "User npm prefix not writable; using XDG fallback {} (add {} to your PATH to use openclaw from terminal)",
                local.display(),
                bin.display()
            ),
            "setup.openclaw.localNpmPrefix",
            0.075,
        );
        return Ok(local);
    }

    // Tier 3: JunQi-managed sandbox under the selected state directory.
    // Caller will surface the path so the user can still run
    // `openclaw` from JunQi even if their terminal can't find it.
    // We announce the resolved sandbox path through
    // `setup.openclaw.sandboxNpmPrefix` so the frontend can surface a
    // dedicated install-location card just like tiers 1/2.
    let sandbox = paths::openclaw_global_dir();
    emit_keyed(
        app,
        step,
        &format!(
            "User npm prefix and ~/.local both unwritable; using JunQi sandbox {}",
            sandbox.display()
        ),
        "setup.openclaw.sandboxNpmPrefix",
        0.075,
    );
    Ok(sandbox)
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

fn validate_staged_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let package_dir = openclaw_node_modules_dir(prefix).join("openclaw");
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

async fn promote_staged_openclaw_install(
    staging_prefix: &std::path::Path,
    target_prefix: &std::path::Path,
) -> Result<(), String> {
    let staged_package = openclaw_node_modules_dir(staging_prefix).join("openclaw");
    let target_node_modules = openclaw_node_modules_dir(target_prefix);
    let target_package = target_node_modules.join("openclaw");
    let backup_package =
        target_node_modules.join(format!(".junqi-openclaw-backup-{}", std::process::id()));
    let mut last_error = String::new();

    for attempt in 0..6 {
        std::fs::create_dir_all(&target_node_modules).map_err(|error| {
            format!(
                "Cannot prepare the OpenClaw package directory {}: {}",
                target_node_modules.display(),
                error
            )
        })?;
        let _ = std::fs::remove_dir_all(&backup_package);

        let had_existing_package = target_package.exists();
        if had_existing_package {
            if let Err(error) = std::fs::rename(&target_package, &backup_package) {
                last_error = format!(
                    "Cannot move the current OpenClaw installation because it is in use: {}",
                    error
                );
                if attempt < 5 {
                    tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1))).await;
                }
                continue;
            }
        }

        match std::fs::rename(&staged_package, &target_package) {
            Ok(()) => {
                for shim in ["openclaw", "openclaw.cmd", "openclaw.ps1"] {
                    let source = staging_prefix.join(shim);
                    if source.is_file() {
                        std::fs::copy(&source, target_prefix.join(shim)).map_err(|error| {
                            format!("Cannot install the OpenClaw launcher {}: {}", shim, error)
                        })?;
                    }
                }
                let _ = std::fs::remove_dir_all(&backup_package);
                return Ok(());
            }
            Err(error) => {
                last_error = format!(
                    "Cannot activate the staged OpenClaw package at {}: {}",
                    target_package.display(),
                    error
                );
                if had_existing_package {
                    let _ = std::fs::rename(&backup_package, &target_package);
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
pub async fn install_openclaw(app: tauri::AppHandle) -> Result<String, String> {
    let step = "openclaw";
    let install_lock = OPENCLAW_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = install_lock.lock().await;

    emit_keyed(
        &app,
        step,
        "Checking for existing local OpenClaw...",
        "setup.openclaw.checkExisting",
        0.02,
    );
    let existing = crate::commands::system::detect_openclaw().await;
    if existing.installed {
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

    emit_keyed(
        &app,
        step,
        "No existing OpenClaw was found; installing a managed local OpenClaw for this computer...",
        "setup.openclaw.firstInstall",
        0.03,
    );

    let target_requirement = target_openclaw_node_requirement().await?;
    ensure_compatible_node_runtime(&app, step, &target_requirement).await?;

    // ① 定位 Node.js 二进制
    emit_keyed(
        &app,
        step,
        "Locating Node.js executable...",
        "setup.openclaw.locateNode",
        0.05,
    );
    let local_node = paths::local_node_path();
    let node_cmd = if local_node.exists() {
        let path = local_node.to_string_lossy().to_string();
        emit_keyed(
            &app,
            step,
            &format!("Using local Node.js: {}", path),
            "setup.openclaw.useLocalNode",
            0.05,
        );
        path
    } else {
        emit_keyed(
            &app,
            step,
            "Using system Node.js",
            "setup.openclaw.useSystemNode",
            0.05,
        );
        platform::bin_name("node")
    };

    // 检查 npm-cli.js
    let local_npm_cli = paths::local_npm_cli_path();
    let npm_cli = if local_npm_cli.exists() {
        emit_keyed(
            &app,
            step,
            &format!("Using local npm: {}", local_npm_cli.display()),
            "setup.openclaw.useLocalNpm",
            0.07,
        );
        Some(local_npm_cli.to_string_lossy().to_string())
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
    // wins; otherwise use the login terminal's npm prefix, then user-owned
    // fallbacks. No user-specific path is hard-coded here.
    let openclaw_prefix = pick_install_target(&app, step).await?;
    emit_keyed(
        &app,
        step,
        &format!("Preparing install target {}...", openclaw_prefix.display()),
        "setup.openclaw.prepareDir",
        0.08,
    );
    std::fs::create_dir_all(&openclaw_prefix).ok();
    if !cfg!(windows) {
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
        "openclaw",
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
    // 真实落点（用户 npm prefix 或 JunQi sandbox），不要再回退到硬编码
    // 的 global 目录。
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
    crate::commands::system::persist_selected_openclaw_binary(&openclaw_bin)?;
    if paths::terminal_integration_requested() {
        crate::commands::terminal_integration::sync_terminal_integration()?;
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
    emit_keyed(
        &app,
        step,
        "Reading gateway port from ~/.openclaw/openclaw.json...",
        "setup.gateway.readPort",
        0.32,
    );
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let port = std::fs::read_to_string(paths::config_path())
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

    let reachable = crate::commands::gateway::is_gateway_serving(port).await;
    if reachable {
        emit_keyed(
            &app,
            step,
            &format!(
                "Port {} already in use - assuming Gateway is running, skipping start",
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

/// Install a package via winget (Windows only).
#[tauri::command]
pub async fn install_winget_package(package_id: String) -> Result<String, String> {
    if !package_id
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_' | '/'))
    {
        return Err("Invalid package ID".into());
    }

    #[cfg(not(windows))]
    {
        let _ = package_id;
        return Err("winget 仅在 Windows 上可用".into());
    }

    #[cfg(windows)]
    {
        let output = tokio::process::Command::new("winget")
            .args([
                "install",
                "-e",
                "--id",
                &package_id,
                "--accept-source-agreements",
                "--accept-package-agreements",
            ])
            .output()
            .await
            .map_err(|e| format!("执行 winget 失败: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if output.status.success() {
            refresh_path_from_registry();
            Ok(format!("{}\n{}", stdout, stderr).trim().to_string())
        } else {
            Err(format!(
                "winget install 失败（退出码 {}）:\n{}\n{}",
                output.status.code().unwrap_or(-1),
                stdout,
                stderr
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_runtime_activation_replaces_target_and_removes_backup() {
        let root = std::env::temp_dir().join(format!(
            "junqi-runtime-activation-test-{}",
            uuid::Uuid::new_v4()
        ));
        let target = root.join("node");
        let staging = root.join(".node-stage");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(target.join("version"), "old").unwrap();
        std::fs::write(staging.join("version"), "new").unwrap();

        activate_staged_runtime(&staging, &target, "node").unwrap();

        assert_eq!(
            std::fs::read_to_string(target.join("version")).unwrap(),
            "new"
        );
        assert!(!staging.exists());
        assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .contains("backup")));
        let _ = std::fs::remove_dir_all(root);
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
