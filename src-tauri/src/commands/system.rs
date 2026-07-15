use crate::commands::node_runtime::{NodeRequirementSource, NodeRuntimeRequirement};
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

#[derive(Debug, Clone, Serialize)]
pub struct NodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>, // "local" or "system"
}

/// A native OpenClaw executable bound to the exact Node.js runtime that was
/// checked against the installed package's `engines.node` contract. Keeping
/// this pair together prevents a later PATH lookup from silently selecting an
/// incompatible Node.js executable on Windows or Unix.
#[derive(Debug, Clone)]
pub(crate) struct NativeOpenclawRuntime {
    binary: PathBuf,
    node: PathBuf,
}

impl NativeOpenclawRuntime {
    pub(crate) fn command(&self) -> tokio::process::Command {
        openclaw_command_with_node(&self.binary, Some(&self.node))
    }
}

pub(crate) fn native_openclaw_runtime(
    binary: PathBuf,
    node: &NodeStatus,
) -> Result<NativeOpenclawRuntime, String> {
    if !node.available {
        return Err("A compatible Node.js runtime is not available".to_string());
    }
    let node = node
        .path
        .as_deref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            "The compatible Node.js runtime did not report an executable path".to_string()
        })?;
    Ok(NativeOpenclawRuntime { binary, node })
}

/// Resolve the selected native OpenClaw executable and a compatible Node.js
/// runtime without changing the machine. Mutating workflows call setup's
/// ensure helper first, then construct this same context from its result.
pub(crate) async fn resolve_compatible_native_openclaw_runtime(
) -> Result<NativeOpenclawRuntime, String> {
    let binary = resolve_openclaw_binary_async().await.ok_or_else(|| {
        "OpenClaw is not installed; official CLI operations are unavailable".to_string()
    })?;
    compatible_native_openclaw_runtime(binary).await
}

pub(crate) async fn compatible_native_openclaw_runtime(
    binary: PathBuf,
) -> Result<NativeOpenclawRuntime, String> {
    let requirement = node_requirement_for_openclaw_binary(&binary)?;
    let node = check_node_for_requirement(&requirement).await?;
    if !node.available {
        return Err(format!(
            "OpenClaw requires Node.js {}; no compatible runtime was found",
            requirement.expression()
        ));
    }
    native_openclaw_runtime(binary, &node)
}

#[derive(Debug, Serialize)]
pub struct NpmStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct OpenclawStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub source: Option<String>,
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

async fn get_node_version(node_path: &str) -> Option<String> {
    let mut command = tokio::process::Command::new(node_path);
    command.arg("--version");
    platform::configure_background_command(&mut command);
    let output = command.output().await.ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn check_npm() -> Result<NpmStatus, String> {
    // A user-selected portable Node.js is an explicit runtime choice. Keep its
    // bundled npm paired with it instead of mixing it with a system npm.
    if let (Some(node), Some(npm)) = (
        paths::configured_node_path(),
        paths::configured_npm_cli_path(),
    ) {
        if node.is_file() && npm.is_file() {
            let mut command = tokio::process::Command::new(&node);
            command.arg(&npm).arg("--version");
            platform::configure_background_command(&mut command);
            if let Ok(output) = command.output().await {
                let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if output.status.success() && !version.is_empty() {
                    return Ok(NpmStatus {
                        available: true,
                        version: Some(version),
                        path: Some(npm.to_string_lossy().into_owned()),
                        source: Some("local".into()),
                    });
                }
            }
        }
    }

    let system_npm = platform::detect_path("npm");
    let system_npm = if system_npm.is_empty() {
        platform::bin_name("npm")
    } else {
        system_npm
    };
    let mut command = tokio::process::Command::new(&system_npm);
    command.arg("--version");
    platform::configure_background_command(&mut command);
    if let Ok(output) = command.output().await {
        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success() && !version.is_empty() {
            return Ok(NpmStatus {
                available: true,
                version: Some(version),
                path: Some(system_npm),
                source: Some("system".into()),
            });
        }
    }

    // Older JunQi releases installed a private Node/npm pair. Keep it as a
    // compatibility fallback, but never let it shadow a system installation.
    let local_node = paths::legacy_local_node_path();
    let local_npm = paths::legacy_local_npm_cli_path();
    if local_node.is_file() && local_npm.is_file() {
        let mut command = tokio::process::Command::new(&local_node);
        command.arg(&local_npm).arg("--version");
        platform::configure_background_command(&mut command);
        if let Ok(output) = command.output().await {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && !version.is_empty() {
                return Ok(NpmStatus {
                    available: true,
                    version: Some(version),
                    path: Some(local_npm.to_string_lossy().into_owned()),
                    source: Some("local".into()),
                });
            }
        }
    }

    Ok(NpmStatus {
        available: false,
        version: None,
        path: None,
        source: None,
    })
}

/// Apply the user's explicit npm cache choice to a child npm/OpenClaw process.
/// When no override exists, leave the variable unset so npm resolves the
/// active user's native cache location itself.
pub(crate) fn apply_configured_npm_cache(command: &mut tokio::process::Command) {
    if let Some(cache) = paths::configured_npm_cache_dir() {
        command.env("npm_config_cache", cache);
    }
}

fn portable_node_is_compatible(node: &Path) -> bool {
    node.is_file()
        && std::process::Command::new(node)
            .arg("--version")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
            .is_some_and(|version| {
                installed_openclaw_node_requirement()
                    .unwrap_or_else(|_| NodeRuntimeRequirement::fallback())
                    .supports(&version)
            })
}

fn legacy_managed_node_is_compatible() -> bool {
    portable_node_is_compatible(&paths::legacy_local_node_path())
}

/// Build an OpenClaw command without relying on command-shim behavior when an
/// exact compatible Node.js runtime is available. npm's `openclaw.cmd` is only
/// a wrapper, and Unix npm launchers can drift through `env node` as well.
pub(crate) fn openclaw_command_with_node(
    binary: &Path,
    node: Option<&Path>,
) -> tokio::process::Command {
    #[cfg(windows)]
    if let Some(entry) = npm_openclaw_entry(binary) {
        let node = if let Some(node) = node {
            node.to_path_buf()
        } else if let Some(configured) =
            paths::configured_node_path().filter(|path| portable_node_is_compatible(path))
        {
            configured
        } else {
            let legacy = paths::legacy_local_node_path();
            if legacy_managed_node_is_compatible() {
                legacy
            } else {
                let detected = platform::detect_path("node");
                if detected.is_empty() {
                    PathBuf::from(platform::bin_name("node"))
                } else {
                    PathBuf::from(detected)
                }
            }
        };
        let mut command = tokio::process::Command::new(node);
        command.arg(entry);
        return command;
    }

    #[cfg(not(windows))]
    if let (Some(node), Some(entry)) = (node, npm_openclaw_entry(binary)) {
        let mut command = tokio::process::Command::new(node);
        command.arg(entry);
        return command;
    }

    tokio::process::Command::new(binary)
}

fn npm_openclaw_entry(binary: &Path) -> Option<PathBuf> {
    if binary
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return None;
    }
    let entry = openclaw_package_dir(binary)?.join("openclaw.mjs");
    entry.is_file().then_some(entry)
}

/// Locate the npm CLI shipped with the exact Node.js executable selected for
/// an installation. This avoids mixing a compatible Node.js with an unrelated
/// `npm` shim from PATH after a system upgrade or a custom portable runtime.
pub(crate) fn npm_cli_for_node(node: &Path) -> Option<PathBuf> {
    let bin_dir = node.parent()?;
    let direct = bin_dir
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if direct.is_file() {
        return Some(direct);
    }
    let unix_global = bin_dir
        .parent()?
        .join("lib")
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    unix_global.is_file().then_some(unix_global)
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
    let requirement = installed_openclaw_node_requirement()?;
    check_node_for_requirement(&requirement).await
}

pub(crate) async fn check_node_for_requirement(
    requirement: &NodeRuntimeRequirement,
) -> Result<NodeStatus, String> {
    // An explicit portable runtime is the user's choice and must not drift to
    // whichever Node.js happens to be first on PATH. A missing or incompatible
    // selected runtime is reported as such so recovery can repair that exact
    // location instead of silently changing environments.
    if let Some(configured) = paths::configured_node_path() {
        let path_str = configured.to_string_lossy().to_string();
        let version = get_node_version(&path_str).await;
        return Ok(NodeStatus {
            available: version
                .as_ref()
                .is_some_and(|version| requirement.supports(version)),
            version,
            path: Some(path_str),
            source: Some("local".into()),
        });
    }

    // System Node.js is authoritative for default setup. The legacy private
    // runtime below is only a compatibility fallback for older installations.
    let system_node = platform::detect_path("node");
    let system_node = if system_node.is_empty() {
        platform::bin_name("node")
    } else {
        system_node
    };
    let system_version = get_node_version(&system_node).await;
    if system_version
        .as_ref()
        .is_some_and(|version| requirement.supports(version))
    {
        return Ok(NodeStatus {
            available: true,
            version: system_version,
            path: Some(system_node.clone()),
            source: Some("system".into()),
        });
    }

    let local = paths::legacy_local_node_path();
    if local.exists() {
        let path_str = local.to_string_lossy().to_string();
        let version = get_node_version(&path_str).await;
        let meets_min = version.as_ref().is_some_and(|v| requirement.supports(v));
        if meets_min {
            return Ok(NodeStatus {
                available: true,
                version,
                path: Some(path_str),
                source: Some("local".into()),
            });
        }
        if system_version.is_none() {
            return Ok(NodeStatus {
                available: false,
                version,
                path: Some(path_str),
                source: Some("local".into()),
            });
        }
    }

    if system_version.is_some() {
        return Ok(NodeStatus {
            available: false,
            version: system_version,
            path: Some(system_node),
            source: Some("system".into()),
        });
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
    // Prefer locations selected by setup or reported by npm. Generic PATH is
    // retained as the final discovery surface; do not infer a user profile or
    // an installation directory from a machine-specific directory pattern.
    let mut path_parts = vec![
        paths::configured_node_path()
            .filter(|path| path.is_file())
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        legacy_managed_node_is_compatible()
            .then(paths::legacy_local_node_path)
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        paths::configured_git_path()
            .filter(|path| path.is_file())
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        paths::legacy_local_git_path()
            .is_file()
            .then(paths::legacy_local_git_path)
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        // The setup guide persists a user-selected prefix. Search its exact
        // npm shim directory before any heuristic so restarts keep using the
        // location the user approved.
        paths::configured_npm_prefix()
            .map(|prefix| paths::npm_bin_dir_for_prefix(&prefix))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default(),
        // Tier 1: user's actual npm prefix (read from `~/.npmrc`). This is
        // the canonical `npm i -g openclaw` bin dir the user finds on PATH.
        paths::user_npm_bin_dir()
            .map(|d| d.to_string_lossy().to_string())
            .unwrap_or_default(),
    ];
    for env_key in [
        "OPENCLAW_HOME",
        "PNPM_HOME",
        "BUN_INSTALL",
        "VOLTA_HOME",
        "CARGO_HOME",
    ] {
        if let Ok(value) = std::env::var(env_key) {
            let base = std::path::PathBuf::from(value);
            path_parts.push(base.to_string_lossy().to_string());
            path_parts.push(base.join("bin").to_string_lossy().to_string());
        }
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

fn is_legacy_brand_wrapper(path: &Path) -> bool {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    canonical
        .to_string_lossy()
        .to_lowercase()
        .contains(&format!("{}{}", "cla", "wx"))
}

fn is_valid_openclaw_candidate(path: &Path) -> bool {
    path.exists()
        && !is_legacy_brand_wrapper(path)
        && (read_openclaw_pkg_version(path).is_some() || read_openclaw_cli_version(path).is_some())
}

fn read_selected_openclaw_binary() -> Option<PathBuf> {
    let raw = std::fs::read_to_string(paths::openclaw_binary_selection_path()).ok()?;
    let selection: OpenclawBinarySelection = serde_json::from_str(&raw).ok()?;
    let path = PathBuf::from(selection.path);
    is_valid_openclaw_candidate(&path).then_some(path)
}

fn openclaw_candidate_matches(candidate: &Path, selected: &Path) -> bool {
    let candidate = std::fs::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf());
    let selected = std::fs::canonicalize(selected).unwrap_or_else(|_| selected.to_path_buf());
    candidate == selected
}

fn classify_openclaw_binary_path(path: &Path) -> Option<&'static str> {
    if let Some(prefix) = paths::configured_npm_prefix() {
        let bin_dir = paths::npm_bin_dir_for_prefix(&prefix);
        for name in openclaw_binary_names() {
            if openclaw_candidate_matches(&bin_dir.join(name), path) {
                return Some("configured-npm-prefix");
            }
        }
    }

    if let Some(bin_dir) = paths::user_npm_bin_dir() {
        for name in openclaw_binary_names() {
            if openclaw_candidate_matches(&bin_dir.join(name), path) {
                return Some("user-npm-prefix");
            }
        }
    }

    None
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
    resolve_openclaw_binary_with_source().map(|(path, _source)| path)
}

async fn npm_reported_global_prefix() -> Option<PathBuf> {
    let npm = platform::detect_path(&platform::bin_name("npm"));
    if npm.trim().is_empty() {
        return None;
    }
    let mut command = tokio::process::Command::new(npm);
    command
        .args(["config", "get", "prefix"])
        .env("PATH", platform::login_shell_path())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    platform::configure_background_command(&mut command);
    let output = tokio::time::timeout(std::time::Duration::from_secs(10), command.output())
        .await
        .ok()?
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let prefix = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    prefix.is_absolute().then_some(prefix)
}

/// Resolve OpenClaw asynchronously using npm's own effective configuration as
/// a final discovery source. This covers pre-existing installations whose
/// prefix comes from a global npm config, environment, or Node manager rather
/// than a visible `.npmrc` entry.
pub(crate) async fn resolve_openclaw_binary_async() -> Option<PathBuf> {
    if let Some(binary) = resolve_openclaw_binary() {
        return Some(binary);
    }
    let prefix = npm_reported_global_prefix().await?;
    let bin_dir = paths::npm_bin_dir_for_prefix(&prefix);
    for name in openclaw_binary_names() {
        let candidate = bin_dir.join(name);
        if is_valid_openclaw_candidate(&candidate) {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn resolve_openclaw_binary_with_source() -> Option<(PathBuf, String)> {
    if let Ok(explicit) = std::env::var("OPENCLAW_BIN") {
        let explicit = PathBuf::from(explicit);
        if is_valid_openclaw_candidate(&explicit) {
            return Some((explicit, "OPENCLAW_BIN".into()));
        }
    }

    if let Some(selected) = read_selected_openclaw_binary() {
        let source = classify_openclaw_binary_path(&selected)
            .map(|tier| format!("saved-selection:{}", tier))
            .unwrap_or_else(|| "saved-selection".into());
        return Some((selected, source));
    }

    if let Some(prefix) = paths::configured_npm_prefix() {
        let bin_dir = paths::npm_bin_dir_for_prefix(&prefix);
        for name in openclaw_binary_names() {
            let candidate = bin_dir.join(name);
            if is_valid_openclaw_candidate(&candidate) {
                return Some((candidate, "configured-npm-prefix".into()));
            }
        }
    }

    if let Some(bin_dir) = paths::user_npm_bin_dir() {
        for name in openclaw_binary_names() {
            let candidate = bin_dir.join(name);
            if is_valid_openclaw_candidate(&candidate) {
                return Some((candidate, "user-npm-prefix".into()));
            }
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
    candidates.into_iter().find_map(|path| {
        let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let marker = canonical.to_string_lossy().to_lowercase();
        (seen.insert(marker) && is_valid_openclaw_candidate(&path)).then_some((path, "PATH".into()))
    })
}

pub(crate) async fn detect_openclaw() -> OpenclawStatus {
    let search_path = openclaw_search_path();
    let (path, source) = match resolve_openclaw_binary_with_source() {
        Some(resolved) => resolved,
        None => match resolve_openclaw_binary_async().await {
            Some(path) => (path, "npm-config-prefix".to_string()),
            None => {
                return OpenclawStatus {
                    installed: false,
                    version: None,
                    path: None,
                    source: None,
                    binary_found: false,
                    version_ok: false,
                    package_valid: false,
                    gateway_command_ok: false,
                    error: Some("OpenClaw binary was not found on JunQi's search path".into()),
                };
            }
        },
    };
    let _ = persist_selected_openclaw_binary(&path);
    let mut status = validate_openclaw_binary(&path, &search_path).await;
    status.source = Some(source);
    status
}

pub(crate) async fn validate_openclaw_binary(path: &Path, _search_path: &str) -> OpenclawStatus {
    let path_string = path_for_display(path);
    let package_version = read_openclaw_pkg_version(path);
    let cli_version = read_openclaw_cli_version(path);
    let package_valid = package_version.is_some();
    let version = package_version.or(cli_version);
    let version_ok = version.is_some();
    let gateway_command_ok = version_ok && !is_legacy_brand_wrapper(path);
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
        source: None,
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

fn path_text_for_display(raw: &str, windows: bool) -> String {
    if !windows {
        return raw.to_string();
    }
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{}", rest);
    }
    raw.strip_prefix(r"\\?\").unwrap_or(raw).to_string()
}

pub(crate) fn display_path_text(raw: &str) -> String {
    path_text_for_display(raw, cfg!(windows))
}

pub(crate) fn path_for_display(path: &Path) -> String {
    display_path_text(&path.to_string_lossy())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenclawPackageMetadata {
    version: String,
    node_requirement: Option<String>,
}

fn read_openclaw_package_metadata_file(package_json: &Path) -> Option<OpenclawPackageMetadata> {
    let raw = std::fs::read_to_string(package_json).ok()?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).ok()?;
    if value.get("name").and_then(|name| name.as_str()) != Some("openclaw") {
        return None;
    }
    let version = value
        .get("version")
        .and_then(|version| version.as_str())
        .filter(|version| !version.trim().is_empty())?
        .to_string();
    let node_requirement = value
        .get("engines")
        .and_then(|engines| engines.get("node"))
        .and_then(|node| node.as_str())
        .map(str::trim)
        .filter(|requirement| !requirement.is_empty())
        .map(str::to_string);
    Some(OpenclawPackageMetadata {
        version,
        node_requirement,
    })
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

fn is_openclaw_package_dir(dir: &Path) -> bool {
    read_openclaw_package_metadata_file(&dir.join("package.json")).is_some()
}

/// Resolve the physical `openclaw` package root from a selected executable.
///
/// npm can expose the same package through a Windows prefix shim, a
/// `node_modules/.bin` shim, or a Unix symlink. The resolver starts from both
/// the visible binary and its canonical target, then verifies `package.json`
/// instead of assuming a user-specific global prefix.
pub(crate) fn openclaw_package_dir(binary: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(binary).unwrap_or_else(|_| binary.to_path_buf());
    for candidate in [binary.to_path_buf(), canonical] {
        let mut dir = candidate.parent();
        for _ in 0..8 {
            let Some(current) = dir else {
                break;
            };
            if is_openclaw_package_dir(current) {
                return Some(current.to_path_buf());
            }
            let nested = current.join("node_modules").join("openclaw");
            if is_openclaw_package_dir(&nested) {
                return Some(nested);
            }
            dir = current.parent();
        }
    }
    None
}

/// Derive the npm global prefix owning an installed OpenClaw package. The
/// structure is validated through `openclaw_package_dir`; `windows` only
/// selects npm's documented shim layout, never a hard-coded filesystem path.
pub(crate) fn npm_prefix_for_openclaw_binary(binary: &Path, windows: bool) -> Option<PathBuf> {
    if !binary.is_file() {
        return None;
    }
    let package_dir = openclaw_package_dir(binary)?;
    let node_modules = package_dir.parent()?;
    if node_modules.file_name().and_then(|name| name.to_str())? != "node_modules" {
        return None;
    }
    let layout_root = node_modules.parent()?.to_path_buf();
    if windows {
        return Some(layout_root);
    }
    if layout_root.file_name().and_then(|name| name.to_str()) == Some("lib") {
        return layout_root.parent().map(Path::to_path_buf);
    }
    Some(layout_root)
}

fn read_openclaw_package_metadata(bin: &Path) -> Option<OpenclawPackageMetadata> {
    let package_dir = openclaw_package_dir(bin)?;
    read_openclaw_package_metadata_file(&package_dir.join("package.json"))
}

fn read_openclaw_pkg_version(bin: &Path) -> Option<String> {
    read_openclaw_package_metadata(bin).map(|metadata| metadata.version)
}

pub(crate) fn node_requirement_for_openclaw_binary(
    binary: &Path,
) -> Result<NodeRuntimeRequirement, String> {
    let Some(metadata) = read_openclaw_package_metadata(binary) else {
        return Ok(NodeRuntimeRequirement::fallback());
    };
    let Some(expression) = metadata.node_requirement else {
        return Ok(NodeRuntimeRequirement::fallback());
    };
    NodeRuntimeRequirement::parse(expression, NodeRequirementSource::InstalledPackage)
}

pub(crate) fn installed_openclaw_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    let Some(binary) = resolve_openclaw_binary() else {
        return Ok(NodeRuntimeRequirement::fallback());
    };
    node_requirement_for_openclaw_binary(&binary)
}

async fn get_git_version(git_path: &str) -> Option<String> {
    let mut command = tokio::process::Command::new(git_path);
    command.arg("--version");
    platform::configure_background_command(&mut command);
    let output = command.output().await.ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
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
    // On Windows, refresh PATH from registry so we detect newly-installed Git
    #[cfg(windows)]
    crate::commands::setup::refresh_path_from_registry();

    if let Some(configured) = paths::configured_git_path() {
        let path = configured.to_string_lossy().into_owned();
        let version = get_git_version(&path).await;
        return Ok(GitStatus {
            available: version.is_some(),
            version,
            path: Some(path),
            source: Some("local".into()),
        });
    }

    // System Git is discovered through the current PATH on every platform.
    // Do not infer package-manager or home-directory locations: the system
    // installation (or an explicitly selected portable directory above) is
    // the only authoritative source for new setups.
    let detected_git = platform::detect_path("git");
    let system_git = if detected_git.is_empty() {
        platform::bin_name("git")
    } else {
        detected_git
    };
    if let Some(version) = get_git_version(&system_git).await {
        return Ok(GitStatus {
            available: true,
            version: Some(version),
            path: Some(system_git),
            source: Some("system".into()),
        });
    }

    let legacy = paths::legacy_local_git_path();
    if legacy.is_file() {
        let path = legacy.to_string_lossy().into_owned();
        let version = get_git_version(&path).await;
        return Ok(GitStatus {
            available: version.is_some(),
            version,
            path: Some(path),
            source: Some("local".into()),
        });
    }
    Ok(GitStatus {
        available: false,
        version: None,
        path: None,
        source: None,
    })
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
    use super::{
        npm_cli_for_node, npm_openclaw_entry, npm_prefix_for_openclaw_binary, openclaw_package_dir,
        parse_openclaw_version, path_text_for_display, read_openclaw_package_metadata,
    };

    #[test]
    fn windows_npm_shim_resolves_to_package_entry_point() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-command-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let entry = root
            .join("node_modules")
            .join("openclaw")
            .join("openclaw.mjs");
        std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
        std::fs::write(&entry, "").unwrap();
        std::fs::write(
            entry.parent().unwrap().join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1"}"#,
        )
        .unwrap();

        assert_eq!(npm_openclaw_entry(&root.join("openclaw.cmd")), Some(entry));
        assert_eq!(npm_openclaw_entry(&root.join("openclaw.exe")), None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn windows_npm_dot_bin_shim_uses_the_verified_package_prefix() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-dot-bin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let package = root.join("node_modules").join("openclaw");
        let entry = package.join("openclaw.mjs");
        let shim = root.join("node_modules").join(".bin").join("openclaw.cmd");
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(&shim, "@echo off").unwrap();
        std::fs::write(&entry, "").unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1"}"#,
        )
        .unwrap();

        assert_eq!(openclaw_package_dir(&shim), Some(package));
        assert_eq!(npm_openclaw_entry(&shim), Some(entry));
        assert_eq!(
            npm_prefix_for_openclaw_binary(&shim, true),
            Some(root.clone())
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn npm_cli_is_derived_from_the_selected_node_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-node-npm-layout-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let node = root.join("bin").join("node");
        let npm = root
            .join("lib")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js");
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
        std::fs::write(&node, "").unwrap();
        std::fs::write(&npm, "").unwrap();

        assert_eq!(npm_cli_for_node(&node), Some(npm));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn package_metadata_reads_version_and_node_engine_from_windows_shim_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-openclaw-metadata-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let package = root.join("node_modules").join("openclaw");
        std::fs::create_dir_all(&package).unwrap();
        let shim = root.join("openclaw.cmd");
        std::fs::write(&shim, "@echo off").unwrap();
        std::fs::write(
            package.join("package.json"),
            r#"{"name":"openclaw","version":"2026.7.1","engines":{"node":">=24.15.0 <25"}}"#,
        )
        .unwrap();

        let metadata = read_openclaw_package_metadata(&shim).unwrap();
        assert_eq!(metadata.version, "2026.7.1");
        assert_eq!(metadata.node_requirement.as_deref(), Some(">=24.15.0 <25"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn windows_display_paths_hide_verbatim_prefixes() {
        assert_eq!(
            path_text_for_display(r"\\?\C:\Users\Wang\AppData\Roaming\npm\openclaw.cmd", true),
            r"C:\Users\Wang\AppData\Roaming\npm\openclaw.cmd"
        );
        assert_eq!(
            path_text_for_display(r"\\?\UNC\server\share\openclaw.cmd", true),
            r"\\server\share\openclaw.cmd"
        );
    }

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
        let unrelated_brand_output = format!("{}{} 1.0.0", "Cla", "wX");
        assert_eq!(parse_openclaw_version(&unrelated_brand_output), None);
        assert_eq!(parse_openclaw_version("2026.6.11"), None);
    }
}
