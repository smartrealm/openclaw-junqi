//! Platform abstraction layer — every OS conditional lives here.
//!
//! No other module should use `cfg!(windows)`, `cfg!(target_os)`,
//! or `#[cfg(windows)]` directly for behavioral differences.

use std::path::Path;

/// Append `.exe` on Windows, leave unchanged otherwise.
///
/// ```ignore
/// let node = bin_name("node");   // "node.exe" on Windows, "node" elsewhere
/// let npm  = bin_name("npm");    // "npm.cmd" on Windows, "npm" elsewhere
/// ```
pub fn bin_name(base: &str) -> String {
    if cfg!(windows) {
        match base {
            "npm" => "npm.cmd".to_string(),
            "openclaw" => "openclaw.cmd".to_string(),
            _ => format!("{}.exe", base),
        }
    } else {
        base.to_string()
    }
}

/// Open a file path in the system file explorer.
pub fn open_in_explorer(path: &Path) -> std::io::Result<std::process::Output> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg(path).output()
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path).output()
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open").arg(path).output()
    }
}

/// Apply platform-specific flags to suppress console windows on Windows.
/// No-op on other platforms.
#[allow(dead_code)]
pub fn suppress_console_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd; // suppress unused warning on non-Windows
}

/// Build a PATH string that prepends the bundled Node and Git bin dirs
/// so post-install scripts can find them.
pub fn build_path(node_bin: &str, git_bin: Option<&str>) -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut parts = vec![node_bin.to_string()];
    if let Some(gb) = git_bin {
        parts.push(gb.to_string());
    }
    if let Ok(existing) = std::env::var("PATH") {
        parts.push(existing);
    }
    parts.join(sep)
}
