//! Centralized path helpers — the single source of truth for all
//! filesystem paths used across the application.
//!
//! Every module that needs a path MUST import it from here, never
//! construct it inline.

use std::path::PathBuf;

// ── App state root ────────────────────────────────────────────

/// Returns `~/.openclaw` — the isolated application state directory.
/// All app runtime data (config, node, workspace, devices, cache) lives under here.
pub fn desktop_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".openclaw")
}

// ── Config ─────────────────────────────────────────────────────

/// Returns `~/.openclaw/openclaw.json` — the standard OpenClaw config path.
pub fn config_path() -> PathBuf {
    desktop_dir().join("openclaw.json")
}

// ── Node.js ────────────────────────────────────────────────────

/// Returns the path to our bundled Node.js binary.
pub fn local_node_path() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("node").join("node.exe")
    } else {
        desktop_dir().join("node").join("bin").join("node")
    }
}

/// Returns the directory containing the bundled Node.js binary.
pub fn node_bin_dir() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("node")
    } else {
        desktop_dir().join("node").join("bin")
    }
}

/// Returns the path to npm-cli.js from our bundled Node installation.
pub fn local_npm_cli_path() -> PathBuf {
    if cfg!(windows) {
        desktop_dir()
            .join("node")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js")
    } else {
        desktop_dir()
            .join("node")
            .join("lib")
            .join("node_modules")
            .join("npm")
            .join("bin")
            .join("npm-cli.js")
    }
}

/// Returns the npm cache directory for our bundled Node.
pub fn npm_cache_dir() -> PathBuf {
    desktop_dir().join("npm-cache")
}

// ── Git ────────────────────────────────────────────────────────

/// Returns the path to our locally installed Git binary (Windows MinGit).
pub fn local_git_path() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("git").join("cmd").join("git.exe")
    } else {
        desktop_dir().join("git").join("bin").join("git")
    }
}

/// Returns the directory containing our local Git binary.
pub fn git_bin_dir() -> PathBuf {
    if cfg!(windows) {
        desktop_dir().join("git").join("cmd")
    } else {
        desktop_dir().join("git").join("bin")
    }
}

// ── Workspace ──────────────────────────────────────────────────

/// Default workspace directory, used as a fallback when no workspace
/// is configured by the user.
pub fn default_workspace_dir() -> PathBuf {
    desktop_dir().join("workspace")
}

/// Reads the user-configured workspace path from openclaw.json.
/// Returns None if the config doesn't exist or specify a workspace.
pub fn read_workspace_from_config(config_path: &std::path::Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let workspace = config
        .get("agents")?
        .get("defaults")?
        .get("workspace")?
        .as_str()?;
    Some(PathBuf::from(workspace))
}

// ── Devices ────────────────────────────────────────────────────

/// Returns the devices directory for pairing state.
#[allow(dead_code)]
pub fn devices_dir() -> PathBuf {
    desktop_dir().join("devices")
}
