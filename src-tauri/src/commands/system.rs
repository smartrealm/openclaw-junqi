use crate::paths;
use crate::platform;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Stdio;

#[derive(Debug, Serialize)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub home_dir: String,
    pub desktop_dir: String,
}

#[derive(Debug, Serialize)]
pub struct GitStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>, // "local" or "system"
}

#[derive(Debug, Serialize)]
pub struct NodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>, // "local" or "system"
}

#[derive(Debug, Serialize)]
pub struct OpenclawStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub binary_found: bool,
    pub version_ok: bool,
    pub package_valid: bool,
    pub gateway_command_ok: bool,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct OpenclawBinarySelection {
    path: String,
}

const MIN_NODE_VERSION: (u32, u32, u32) = (24, 14, 0);

async fn get_node_version(node_path: &str) -> Option<String> {
    let output = tokio::process::Command::new(node_path)
        .arg("--version")
        .output()
        .await
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

fn version_meets_minimum(version: &str) -> bool {
    let parts: Vec<u32> = version
        .trim_start_matches('v')
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect();
    if parts.len() < 3 {
        return false;
    }
    let (major, minor, patch) = (parts[0], parts[1], parts[2]);
    let (req_major, req_minor, req_patch) = MIN_NODE_VERSION;
    (major, minor, patch) >= (req_major, req_minor, req_patch)
}

#[tauri::command]
pub async fn get_platform_info() -> Result<PlatformInfo, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    let ma_dir = paths::desktop_dir();

    Ok(PlatformInfo {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        home_dir: home.to_string_lossy().to_string(),
        desktop_dir: ma_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn check_node() -> Result<NodeStatus, String> {
    // Check local node first
    let local = paths::local_node_path();
    if local.exists() {
        let path_str = local.to_string_lossy().to_string();
        let version = get_node_version(&path_str).await;
        let meets_min = version.as_ref().map_or(false, |v| version_meets_minimum(v));
        if meets_min {
            return Ok(NodeStatus {
                available: true,
                version,
                path: Some(path_str),
                source: Some("local".into()),
            });
        }
        // Local node exists but is too old — fall through to system check,
        // and if that also fails, report unavailable so setup re-installs.
    }

    // Check system node
    let system_node = platform::bin_name("node");
    if let Some(version) = get_node_version(&system_node).await {
        if version_meets_minimum(&version) {
            return Ok(NodeStatus {
                available: true,
                version: Some(version),
                path: Some(system_node.into()),
                source: Some("system".into()),
            });
        }
    }

    Ok(NodeStatus {
        available: false,
        version: None,
        path: None,
        source: None,
    })
}

#[tauri::command]
pub async fn check_openclaw() -> Result<OpenclawStatus, String> {
    Ok(detect_openclaw().await)
}

pub(crate) fn openclaw_search_path() -> String {
    let mut path_parts = vec![
        paths::node_bin_dir().to_string_lossy().to_string(),
        // JunQi-managed `npm i -g` install lands here. Listed ahead of the
        // legacy `--prefix` location and the user's home bins so a fresh
        // JunQi install doesn't shadow a user-owned copy, and so the
        // leftover legacy dir (if any) is still picked up.
        paths::openclaw_global_bin_dir().to_string_lossy().to_string(),
        paths::desktop_dir()
            .join("openclaw")
            .join("bin")
            .to_string_lossy()
            .to_string(),
        paths::desktop_dir()
            .join("openclaw")
            .join("node_modules")
            .join(".bin")
            .to_string_lossy()
            .to_string(),
    ];
    if let Some(home) = dirs::home_dir() {
        path_parts.push(
            home.join(".local")
                .join("bin")
                .to_string_lossy()
                .to_string(),
        );
        path_parts.push(
            home.join(".npm-global")
                .join("bin")
                .to_string_lossy()
                .to_string(),
        );
        path_parts.push(
            home.join(".pnpm")
                .to_string_lossy()
                .to_string(),
        );
        path_parts.push(
            home.join(".bun")
                .join("bin")
                .to_string_lossy()
                .to_string(),
        );
        path_parts.push(
            home.join(".volta")
                .join("bin")
                .to_string_lossy()
                .to_string(),
        );
        path_parts.push(
            home.join(".cargo")
                .join("bin")
                .to_string_lossy()
                .to_string(),
        );
        // asdf / mise shims (this is where many users' `node` actually lives)
        path_parts.push(
            home.join(".asdf")
                .join("shims")
                .to_string_lossy()
                .to_string(),
        );
        #[cfg(windows)]
        {
            // npm global bin on Windows. Prefer APPDATA but also include the
            // canonical Roaming/npm path for Store/portable Node installs.
            if let Ok(appdata) = std::env::var("APPDATA") {
                path_parts.push(
                    std::path::PathBuf::from(appdata)
                        .join("npm")
                        .to_string_lossy()
                        .to_string(),
                );
            }
            path_parts.push(
                home.join("AppData")
                    .join("Roaming")
                    .join("npm")
                    .to_string_lossy()
                    .to_string(),
            );
            path_parts.push(
                home.join("AppData")
                    .join("Local")
                    .join("pnpm")
                    .to_string_lossy()
                    .to_string(),
            );
            path_parts.push(
                home.join("scoop")
                    .join("shims")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    for env_key in ["OPENCLAW_HOME", "PNPM_HOME", "BUN_INSTALL", "VOLTA_HOME", "CARGO_HOME"] {
        if let Ok(value) = std::env::var(env_key) {
            let base = std::path::PathBuf::from(value);
            path_parts.push(base.to_string_lossy().to_string());
            path_parts.push(base.join("bin").to_string_lossy().to_string());
        }
    }
    #[cfg(windows)]
    {
        if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
            let base = std::path::PathBuf::from(localappdata);
            path_parts.push(base.join("pnpm").to_string_lossy().to_string());
            path_parts.push(base.join("Programs").join("OpenClaw").to_string_lossy().to_string());
            path_parts.push(
                base.join("Programs")
                    .join("OpenClaw")
                    .join("bin")
                    .to_string_lossy()
                    .to_string(),
            );
            path_parts.push(base.join("OpenClaw").join("bin").to_string_lossy().to_string());
        }
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            let base = std::path::PathBuf::from(program_files);
            path_parts.push(base.join("OpenClaw").to_string_lossy().to_string());
            path_parts.push(base.join("OpenClaw").join("bin").to_string_lossy().to_string());
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            let base = std::path::PathBuf::from(program_files_x86);
            path_parts.push(base.join("OpenClaw").to_string_lossy().to_string());
            path_parts.push(base.join("OpenClaw").join("bin").to_string_lossy().to_string());
        }
        if let Ok(chocolatey) = std::env::var("ChocolateyInstall") {
            path_parts.push(
                std::path::PathBuf::from(chocolatey)
                    .join("bin")
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    // Homebrew: macOS (Apple Silicon + Intel) and the classic /usr/local prefix.
    path_parts.push("/opt/homebrew/bin".to_string());
    path_parts.push("/usr/local/bin".to_string());
    #[cfg(target_os = "linux")]
    {
        // Linuxbrew is the Linux port of Homebrew — only present on Linux.
        path_parts.push("/home/linuxbrew/.linuxbrew/bin".to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        path_parts.push(existing);
    }
    path_parts.join(if cfg!(windows) { ";" } else { ":" })
}

fn openclaw_binary_names() -> &'static [&'static str] {
    if cfg!(windows) {
        &["openclaw.cmd", "openclaw.exe", "openclaw"]
    } else {
        &["openclaw"]
    }
}

fn managed_openclaw_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    // New `npm i -g` layout: `<prefix>/bin/<name>`.
    for name in openclaw_binary_names() {
        candidates.push(paths::openclaw_global_bin_dir().join(name));
        candidates.push(
            paths::openclaw_global_dir()
                .join("node_modules")
                .join(".bin")
                .join(name),
        );
    }
    // Legacy `--prefix` layout, kept so existing user installs still
    // resolve before the user reruns setup.
    for name in openclaw_binary_names() {
        candidates.push(paths::desktop_dir().join("openclaw").join("bin").join(name));
        candidates.push(
            paths::desktop_dir()
                .join("openclaw")
                .join("node_modules")
                .join(".bin")
                .join(name),
        );
    }
    candidates
}

fn is_clawx_wrapper(path: &Path) -> bool {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical.to_string_lossy().to_lowercase().contains("clawx")
}

fn is_valid_openclaw_candidate(path: &Path) -> bool {
    path.exists()
        && !is_clawx_wrapper(path)
        && (read_openclaw_pkg_version(path).is_some() || read_openclaw_cli_version(path).is_some())
}

fn read_selected_openclaw_binary() -> Option<PathBuf> {
    let raw = std::fs::read_to_string(paths::openclaw_binary_selection_path()).ok()?;
    let selection: OpenclawBinarySelection = serde_json::from_str(&raw).ok()?;
    let path = PathBuf::from(selection.path);
    is_valid_openclaw_candidate(&path).then_some(path)
}

pub(crate) fn persist_selected_openclaw_binary(path: &Path) -> Result<(), String> {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if !is_valid_openclaw_candidate(&canonical) {
        return Err(format!(
            "Refusing to persist invalid OpenClaw binary: {}",
            path.display()
        ));
    }

    let selection_path = paths::openclaw_binary_selection_path();
    if let Some(parent) = selection_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create OpenClaw runtime dir: {}", e))?;
    }
    let payload = serde_json::to_string_pretty(&OpenclawBinarySelection {
        path: canonical.to_string_lossy().to_string(),
    })
    .map_err(|e| format!("Failed to serialize OpenClaw binary selection: {}", e))?;
    std::fs::write(&selection_path, payload)
        .map_err(|e| format!("Failed to write OpenClaw binary selection: {}", e))
}

pub(crate) fn resolve_openclaw_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("OPENCLAW_BIN") {
        let explicit = PathBuf::from(explicit);
        if is_valid_openclaw_candidate(&explicit) {
            return Some(explicit);
        }
    }

    if let Some(selected) = read_selected_openclaw_binary() {
        return Some(selected);
    }

    for candidate in managed_openclaw_candidates() {
        if is_valid_openclaw_candidate(&candidate) {
            return Some(candidate);
        }
    }

    let search_path = openclaw_search_path();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let candidates = search_path
        .split(separator)
        .filter(|part| !part.trim().is_empty())
        .flat_map(|part| {
            let dir = PathBuf::from(part);
            openclaw_binary_names()
                .iter()
                .map(move |name| dir.join(name))
        })
        .filter(|path| path.exists())
        .collect::<Vec<_>>();

    let mut seen = HashSet::new();
    candidates.into_iter().find(|path| {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());
        let marker = canonical.to_string_lossy().to_lowercase();
        seen.insert(marker) && is_valid_openclaw_candidate(path)
    })
}

pub(crate) async fn detect_openclaw() -> OpenclawStatus {
    let search_path = openclaw_search_path();
    let Some(path) = resolve_openclaw_binary() else {
        return OpenclawStatus {
            installed: false,
            version: None,
            path: None,
            binary_found: false,
            version_ok: false,
            package_valid: false,
            gateway_command_ok: false,
            error: Some("OpenClaw binary was not found on JunQi's search path".into()),
        };
    };
    let _ = persist_selected_openclaw_binary(&path);
    validate_openclaw_binary(&path, &search_path).await
}

pub(crate) async fn validate_openclaw_binary(path: &Path, _search_path: &str) -> OpenclawStatus {
    let path_string = path.to_string_lossy().to_string();
    let package_version = read_openclaw_pkg_version(path);
    let cli_version = read_openclaw_cli_version(path);
    let package_valid = package_version.is_some();
    let version = package_version.or(cli_version);
    let version_ok = version.is_some();
    let gateway_command_ok = version_ok && !is_clawx_wrapper(path);
    let installed = version_ok && gateway_command_ok;
    let errors = if installed {
        Vec::new()
    } else {
        vec!["OpenClaw binary did not expose a valid package or CLI version".to_string()]
    };
    OpenclawStatus {
        installed,
        version,
        path: Some(path_string),
        binary_found: true,
        version_ok,
        package_valid,
        gateway_command_ok,
        error: if installed {
            None
        } else {
            Some(errors.join("; "))
        },
    }
}

fn read_openclaw_pkg_version_file(package_json: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(package_json).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    if value.get("name").and_then(|name| name.as_str()) != Some("openclaw") {
        return None;
    }
    value
        .get("version")
        .and_then(|version| version.as_str())
        .map(|version| version.to_string())
}

fn parse_openclaw_version(output: &str) -> Option<String> {
    let trimmed = output.trim();
    if !trimmed.to_lowercase().contains("openclaw") {
        return None;
    }
    trimmed
        .split_whitespace()
        .find(|part| {
            part.trim_start_matches('v')
                .chars()
                .next()
                .is_some_and(|ch| ch.is_ascii_digit())
        })
        .map(|part| part.trim_start_matches('v').to_string())
}

fn read_openclaw_cli_version(bin: &Path) -> Option<String> {
    let mut command = std::process::Command::new(bin);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::piped())
        .stdout(Stdio::piped());
    platform::suppress_console_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    parse_openclaw_version(&text)
}

/// Resolve the `openclaw` package version from common npm layouts:
/// symlinked Unix bins resolve inside node_modules/openclaw, while Windows
/// shims usually sit beside node_modules/openclaw/package.json.
fn read_openclaw_pkg_version(bin: &Path) -> Option<String> {
    let real = std::fs::canonicalize(bin).ok()?;
    let mut dir = real.parent();
    for _ in 0..6 {
        let d = dir?;
        if let Some(version) = read_openclaw_pkg_version_file(&d.join("package.json")) {
            return Some(version);
        }
        let nested_package_json = d
            .join("node_modules")
            .join("openclaw")
            .join("package.json");
        if let Some(version) = read_openclaw_pkg_version_file(&nested_package_json) {
            return Some(version);
        }
        dir = d.parent();
    }
    None
}

async fn get_git_version(git_path: &str) -> Option<String> {
    let output = tokio::process::Command::new(git_path)
        .arg("--version")
        .output()
        .await
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

#[cfg(target_os = "macos")]
fn xcode_tools_available() -> bool {
    std::process::Command::new("xcode-select")
        .arg("-p")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn macos_git_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".local").join("bin").join("git"));
        candidates.push(home.join(".npm-global").join("bin").join("git"));
        candidates.push(home.join(".asdf").join("shims").join("git"));
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/git"));
    candidates.push(PathBuf::from("/usr/local/bin/git"));
    if xcode_tools_available() {
        candidates.push(PathBuf::from("/usr/bin/git"));
    }
    candidates
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    let expanded = if path.starts_with("~/") || path == "~" {
        let home = dirs::home_dir().ok_or("Could not determine home directory")?;
        if path == "~" {
            home
        } else {
            home.join(&path[2..])
        }
    } else {
        PathBuf::from(&path)
    };

    // Create directory if it doesn't exist
    if !expanded.exists() {
        std::fs::create_dir_all(&expanded)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    platform::open_in_explorer(&expanded).map_err(|e| format!("Failed to open folder: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn check_git() -> Result<GitStatus, String> {
    // Check local git first (Windows MinGit)
    let local = paths::local_git_path();
    if local.exists() {
        let path_str = local.to_string_lossy().to_string();
        let version = get_git_version(&path_str).await;
        return Ok(GitStatus {
            available: true,
            version,
            path: Some(path_str),
            source: Some("local".into()),
        });
    }

    // On Windows, refresh PATH from registry so we detect newly-installed Git
    #[cfg(windows)]
    crate::commands::setup::refresh_path_from_registry();

    #[cfg(target_os = "macos")]
    {
        for git_path in macos_git_candidates() {
            if !git_path.exists() {
                continue;
            }
            let path_str = git_path.to_string_lossy().to_string();
            if let Some(version) = get_git_version(&path_str).await {
                return Ok(GitStatus {
                    available: true,
                    version: Some(version),
                    path: Some(path_str),
                    source: Some("system".into()),
                });
            }
        }
        return Ok(GitStatus {
            available: false,
            version: None,
            path: None,
            source: None,
        });
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Check system git
        let system_git = platform::bin_name("git");
        if let Some(version) = get_git_version(&system_git).await {
            return Ok(GitStatus {
                available: true,
                version: Some(version),
                path: Some(system_git.into()),
                source: Some("system".into()),
            });
        }

        // Check default install paths (Windows)
        #[cfg(windows)]
        {
            if let Some(git_path) = crate::commands::setup::find_git_in_default_paths() {
                let path_str = git_path.to_string_lossy().to_string();
                if let Some(version) = get_git_version(&path_str).await {
                    return Ok(GitStatus {
                        available: true,
                        version: Some(version),
                        path: Some(path_str),
                        source: Some("system".into()),
                    });
                }
            }
        }

        Ok(GitStatus {
            available: false,
            version: None,
            path: None,
            source: None,
        })
    }
}

// ── get_terminal_env ──────────────────────────────────────────────────────
/// Project-level environment detection for the status bar pills, mirroring
/// kooky `session.environment` (pythonVenv, nodeVersion, goVersion).
#[derive(serde::Serialize)]
pub struct TerminalEnvInfo {
    pub node_version: Option<String>,
    pub python_venv: Option<String>,
    pub go_version: Option<String>,
}

#[tauri::command]
pub async fn get_terminal_env(project_path: String) -> Result<TerminalEnvInfo, String> {
    // Run node, go, and python detection concurrently with tokio::process::Command
    // so NVM/asdf shims don't block the Tokio executor thread.
    let pp = project_path.clone();

    let node_fut = async {
        tokio::process::Command::new("node")
            .arg("--version")
            .current_dir(&pp)
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let v = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    Some(v.trim_start_matches('v').to_string())
                } else {
                    None
                }
            })
    };

    let pp2 = project_path.clone();
    let go_fut = async {
        tokio::process::Command::new("go")
            .arg("version")
            .current_dir(&pp2)
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    let text = String::from_utf8_lossy(&o.stdout).into_owned();
                    text.split_whitespace()
                        .find(|t| t.starts_with("go1.") || t.starts_with("go2."))
                        .map(|t| t.trim_start_matches("go").to_string())
                } else {
                    None
                }
            })
    };

    // Python venv: filesystem-only detection (.venv / venv / env dirs).
    // Deliberately skip std::env::var("VIRTUAL_ENV") -- that reads the Tauri
    // process environment, not the PTY terminal's activated venv.
    let pp3 = project_path.clone();
    let python_fut = async {
        for candidate in &[".venv", "venv", "env"] {
            let venv_dir = std::path::Path::new(&pp3).join(candidate);
            let py_win = venv_dir.join("Scripts").join("python.exe");
            let py_unix = venv_dir.join("bin").join("python");
            // Check each path once to avoid double filesystem stat.
            let py = if py_win.exists() {
                Some(py_win)
            } else if py_unix.exists() {
                Some(py_unix)
            } else {
                None
            };
            if let Some(py_path) = py {
                let ver = tokio::process::Command::new(&py_path)
                    .arg("--version")
                    .output()
                    .await
                    .ok()
                    .map(|o| {
                        let out = String::from_utf8_lossy(&o.stdout).trim().to_string();
                        if out.is_empty() {
                            String::from_utf8_lossy(&o.stderr).trim().to_string()
                        } else {
                            out
                        }
                    })
                    .unwrap_or_else(|| candidate.to_string());
                let clean = ver.strip_prefix("Python ").unwrap_or(&ver).to_string();
                return Some(clean);
            }
        }
        None
    };

    let (node_version, go_version, python_venv) = tokio::join!(node_fut, go_fut, python_fut);

    Ok(TerminalEnvInfo {
        node_version,
        python_venv,
        go_version,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_openclaw_version;

    #[test]
    fn parse_openclaw_version_accepts_plain_cli_output() {
        assert_eq!(
            parse_openclaw_version("OpenClaw 2026.6.11 (e085fa1)"),
            Some("2026.6.11".to_string())
        );
    }

    #[test]
    fn parse_openclaw_version_accepts_v_prefixed_output() {
        assert_eq!(
            parse_openclaw_version("openclaw v2026.6.11"),
            Some("2026.6.11".to_string())
        );
    }

    #[test]
    fn parse_openclaw_version_rejects_unrelated_output() {
        assert_eq!(parse_openclaw_version("ClawX 1.0.0"), None);
        assert_eq!(parse_openclaw_version("2026.6.11"), None);
    }
}
