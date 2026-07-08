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

/// Returns the directory we hand to `npm install -g` as the global prefix
/// when JunQi itself needs to install OpenClaw. We intentionally avoid
/// `desktop_dir().join("openclaw")` here — that path is what `--prefix` used
/// to write to, and it created a parallel copy that shadowed the user's own
/// `npm i -g openclaw`. Now we install into a true global prefix layout:
/// `~/.openclaw/global/lib/node_modules/openclaw` with a `bin/openclaw`
/// symlink, exactly like a normal `npm i -g openclaw` would.
pub fn openclaw_global_dir() -> PathBuf {
    desktop_dir().join("global")
}

/// Returns `<openclaw_global_dir>/bin` — where the openclaw launcher lives
/// after `npm install -g` writes to the global prefix.
pub fn openclaw_global_bin_dir() -> PathBuf {
    openclaw_global_dir().join("bin")
}

/// Stores the OpenClaw binary selected during setup/detection.
/// Subsequent gateway starts prefer this exact binary so the app does not
/// drift between global npm, bundled wrappers, and JunQi-managed installs.
pub fn openclaw_binary_selection_path() -> PathBuf {
    desktop_dir().join("runtime").join("openclaw-binary.json")
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
