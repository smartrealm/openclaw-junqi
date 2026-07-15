use crate::commands::node_runtime::{NodeRequirementSource, NodeRuntimeRequirement};
use crate::commands::npm_registry;
use crate::commands::process_control::terminate_process_tree;
use crate::commands::setup_progress::{emit, emit_keyed};
use crate::paths;
use crate::platform;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, OnceLock,
};

static OPENCLAW_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static NODE_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static GIT_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
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
    let path_env = crate::commands::system::openclaw_search_path();
    let install_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let configured_cache = paths::configured_npm_cache_dir();
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
        // This is deliberately process-scoped. Do not alter user or global npmrc.
        .env("npm_config_registry", registry.url)
        .env("NPM_CONFIG_REGISTRY", registry.url)
        .env("GIT_CONFIG_COUNT", "1")
        .env("GIT_CONFIG_KEY_0", "url.https://github.com/.insteadOf")
        .env("GIT_CONFIG_VALUE_0", "ssh://git@github.com/")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
        if let Some(cache) = configured_cache.as_deref() {
            cmd.env("npm_config_cache", cache);
        }
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

async fn target_openclaw_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    let selection = npm_registry::select_npm_registry().await;
    if let Some(expression) = selection.node_requirement {
        return NodeRuntimeRequirement::parse(expression, NodeRequirementSource::RegistryPackage);
    }
    crate::commands::system::installed_openclaw_node_requirement()
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
    #[cfg_attr(not(windows), allow(unused_variables))] app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
) -> Result<String, String> {
    let _guard = NODE_INSTALL_LOCK
        .get_or_init(|| tokio::sync::Mutex::new(()))
        .lock()
        .await;

    #[cfg(windows)]
    {
        return install_windows_system_node(app, requirement, force).await;
    }

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
    return Err(format!(
        "Node.js {} is required. Install or update Node.js in its standard system location, then retry.",
        requirement.expression()
    ));
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
    emit_keyed(
        &app,
        "node",
        "Installing Node.js to the official Windows default location...",
        "setup.node.systemInstall",
        0.10,
    );
    install_or_upgrade_winget_package("OpenJS.NodeJS.LTS").await?;
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
        install_or_upgrade_winget_package("OpenJS.NodeJS").await?;
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
        "Node.js system installation is ready",
        "setup.node.done",
        1.0,
    );
    Ok(format!(
        "Node.js {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
async fn install_or_upgrade_winget_package(package_id: &str) -> Result<(), String> {
    let common = [
        "-e",
        "--id",
        package_id,
        "--silent",
        "--disable-interactivity",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ];
    let upgrade = tokio::process::Command::new("winget")
        .arg("upgrade")
        .args(common)
        .output()
        .await;
    if upgrade.as_ref().is_ok_and(|output| output.status.success()) {
        return Ok(());
    }
    let install = tokio::process::Command::new("winget")
        .arg("install")
        .args(common)
        .output()
        .await
        .map_err(|error| format!("Failed to launch winget: {error}"))?;
    if install.status.success() {
        return Ok(());
    }

    // `winget upgrade` and `winget install` may both use a non-zero exit code
    // when the requested package is already installed and no update exists.
    // Treat an exact installed-package match as success; callers still verify
    // the executable and its version before continuing.
    let listed = tokio::process::Command::new("winget")
        .args(["list", "-e", "--id", package_id, "--disable-interactivity"])
        .output()
        .await;
    if listed.as_ref().is_ok_and(|output| output.status.success()) {
        return Ok(());
    }

    let diagnostic = String::from_utf8_lossy(&install.stderr).trim().to_string();
    Err(if diagnostic.is_empty() {
        format!("winget could not install {package_id}")
    } else {
        format!("winget could not install {package_id}: {diagnostic}")
    })
}

/// Ensure child processes use a system Node.js release accepted by OpenClaw.
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
                "Node.js is outside OpenClaw's supported range ({} from {}); preparing a compatible system installation...",
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
                    "Unable to install a compatible system Node.js (required: {}): {error}",
                    requirement.expression()
                )
            })?;
        node = crate::commands::system::check_node_for_requirement(requirement).await?;
    }

    if !node.available {
        return Err(format!(
            "OpenClaw requires Node.js {}; a compatible system installation was not detected",
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
    let detected_git = platform::detect_path("git");
    let system_git = if detected_git.is_empty() {
        platform::bin_name("git")
    } else {
        detected_git
    };

    let existing_git = {
        let mut command = tokio::process::Command::new(&system_git);
        command.arg("--version");
        platform::configure_background_command(&mut command);
        command
            .output()
            .await
            .ok()
            .filter(|output| output.status.success())
            .map(|_| PathBuf::from(&system_git))
            .or_else(|| {
                paths::local_git_path()
                    .is_file()
                    .then(paths::local_git_path)
            })
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

    #[cfg(windows)]
    {
        emit_keyed(
            &app,
            step,
            "Installing Git to the official Windows default location...",
            "setup.git.systemInstall",
            0.10,
        );
        install_or_upgrade_winget_package("Git.Git").await?;
        refresh_path_from_registry();
        let installed = crate::commands::system::check_git().await?;
        if !installed.available {
            return Err(
                "Git installation completed but git.exe was not detected on the system PATH".into(),
            );
        }
        emit_keyed(
            &app,
            step,
            "Git system installation is ready",
            "setup.git.done",
            1.0,
        );
        return Ok(format!(
            "Git {} installed at {}",
            installed.version.unwrap_or_default(),
            installed.path.unwrap_or_default()
        ));
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
    let detected_node = crate::commands::system::check_node().await?;
    let node_cmd = if let Some(path) = detected_node.path.filter(|_| detected_node.available) {
        emit_keyed(
            &app,
            step,
            &format!("Using detected Node.js: {}", path),
            "setup.openclaw.useLocalNode",
            0.05,
        );
        path
    } else {
        return Err("A compatible system Node.js installation was not detected".into());
    };

    // 检查 npm-cli.js
    let local_npm_cli = paths::local_npm_cli_path();
    let npm_cli = if detected_node.source.as_deref() == Some("local") && local_npm_cli.exists() {
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
