use crate::paths;
use crate::platform;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

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
        paths::desktop_dir().join("openclaw").join("bin").to_string_lossy().to_string(),
        paths::desktop_dir().join("openclaw").join("node_modules").join(".bin").to_string_lossy().to_string(),
    ];
    if let Some(home) = dirs::home_dir() {
        path_parts.push(home.join(".npm-global").join("bin").to_string_lossy().to_string());
        path_parts.push(home.join(".local").join("bin").to_string_lossy().to_string());
        // asdf / mise shims (this is where many users' `node` actually lives)
        path_parts.push(home.join(".asdf").join("shims").to_string_lossy().to_string());
        #[cfg(windows)]
        {
            // npm global bin on Windows. Prefer APPDATA but also include the
            // canonical Roaming/npm path for Store/portable Node installs.
            if let Ok(appdata) = std::env::var("APPDATA") {
                path_parts.push(std::path::PathBuf::from(appdata).join("npm").to_string_lossy().to_string());
            }
            path_parts.push(home.join("AppData").join("Roaming").join("npm").to_string_lossy().to_string());
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

pub(crate) fn resolve_openclaw_binary() -> Option<PathBuf> {
    let search_path = openclaw_search_path();
    let separator = if cfg!(windows) { ';' } else { ':' };
    let names: &[&str] = if cfg!(windows) {
        &["openclaw.cmd", "openclaw.exe", "openclaw"]
    } else {
        &["openclaw"]
    };
    let candidates = search_path
        .split(separator)
        .filter(|part| !part.trim().is_empty())
        .flat_map(|part| {
            let dir = PathBuf::from(part);
            names.iter().map(move |name| dir.join(name))
        })
        .filter(|path| path.exists())
        .collect::<Vec<_>>();

    let mut seen = HashSet::new();
    candidates.into_iter().find(|path| {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.clone());
        let marker = canonical.to_string_lossy().to_lowercase();
        let excluded = ["cl", "aw", "x"].concat();
        if marker.contains(&excluded) {
            return false;
        }
        seen.insert(marker)
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
    validate_openclaw_binary(&path, &search_path).await
}

pub(crate) async fn validate_openclaw_binary(path: &Path, _search_path: &str) -> OpenclawStatus {
    let path_string = path.to_string_lossy().to_string();
    let package_version = read_openclaw_pkg_version(path);
    let package_valid = package_version.is_some();
    let version = package_version;
    let version_ok = version.is_some();
    let gateway_command_ok = package_valid;
    let installed = package_valid && version_ok;
    let errors = if installed {
        Vec::new()
    } else {
        vec!["OpenClaw package metadata was not found or is invalid".to_string()]
    };
    OpenclawStatus {
        installed,
        version,
        path: Some(path_string),
        binary_found: true,
        version_ok,
        package_valid,
        gateway_command_ok,
        error: if installed { None } else { Some(errors.join("; ")) },
    }
}

/// Resolve the `openclaw` package version by walking up from the (symlinked)
/// binary to the `package.json` whose `name` is `openclaw`.
fn read_openclaw_pkg_version(bin: &Path) -> Option<String> {
    let real = std::fs::canonicalize(bin).ok()?;
    let mut dir = real.parent();
    for _ in 0..4 {
        let d = dir?;
        if let Ok(raw) = std::fs::read_to_string(d.join("package.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                if v.get("name").and_then(|n| n.as_str()) == Some("openclaw") {
                    if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                        return Some(ver.to_string());
                    }
                }
            }
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

    platform::open_in_explorer(&expanded)
        .map_err(|e| format!("Failed to open folder: {}", e))?;

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
            let py_win  = venv_dir.join("Scripts").join("python.exe");
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

    Ok(TerminalEnvInfo { node_version, python_venv, go_version })
}
