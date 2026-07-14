// ── App settings (ported from nezha app_settings.rs, simplified) ─────────────
//
// Persists user-level settings to `~/.nezha/settings.json`. Tracks:
//   - claude_path / codex_path: optional override of the agent executable
//   - send_shortcut: "enter" | "mod_enter"
//   - terminal_shift_enter_newline: bool
//   - claude_force_default_tui: bool
//
// Differences from nezha upstream:
//   - `detect_path`, `login_shell_*`, `home_dir` are inlined here (junqi has no
//     equivalent platform module exposing these).
//   - Windows-only codex vendor resolution (`@openai/codex` bin detection) is
//     dropped — macOS/Linux launch path uses PATH lookup.
//   - `crate::hooks::regenerate_claude_settings()` integration is dropped —
//     nezha-specific; junqi doesn't use that hook system yet.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

fn default_send_shortcut() -> String {
    "mod_enter".to_string()
}

fn normalize_send_shortcut(value: String) -> String {
    match value.as_str() {
        "enter" | "mod_enter" => value,
        _ => default_send_shortcut(),
    }
}

fn default_shift_enter_newline() -> bool {
    true
}

fn default_claude_force_default_tui() -> bool {
    true
}

fn default_terminal_scrollback() -> u32 {
    1000
}

fn clamp_terminal_scrollback(value: u32) -> u32 {
    let clamped = value.clamp(500, 5000);
    ((clamped + 250) / 500) * 500
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AppSettings {
    #[serde(default)]
    pub claude_path: String,
    #[serde(default)]
    pub codex_path: String,
    #[serde(default = "default_send_shortcut")]
    pub send_shortcut: String,
    #[serde(default = "default_shift_enter_newline")]
    pub terminal_shift_enter_newline: bool,
    #[serde(default = "default_claude_force_default_tui")]
    pub claude_force_default_tui: bool,
    #[serde(default = "default_terminal_scrollback")]
    pub terminal_scrollback: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            claude_path: String::new(),
            codex_path: String::new(),
            send_shortcut: default_send_shortcut(),
            terminal_shift_enter_newline: default_shift_enter_newline(),
            claude_force_default_tui: default_claude_force_default_tui(),
            terminal_scrollback: default_terminal_scrollback(),
        }
    }
}

fn settings_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn nezha_dir() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".nezha"))
}

fn settings_path() -> Result<PathBuf, String> {
    Ok(nezha_dir()?.join("settings.json"))
}

/// Atomically write `content` to `path` via temp file + rename.
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let uid = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file_name}.{uid}.tmp"));
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Detect the absolute path of a binary by looking it up via the platform's
/// `which` (Unix) or `where` (Windows). Returns empty string if not found.
fn detect_path(binary: &str) -> String {
    let lookup = if cfg!(windows) { "where" } else { "which" };
    Command::new(lookup)
        .arg(binary)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        })
        .unwrap_or_default()
}

/// Capture the login shell PATH so child processes inherit it instead of the
/// minimal PATH that GUI apps get on macOS.
fn login_shell_path() -> String {
    // Best-effort: try `echo $PATH` via login shell; fall back to current PATH.
    let shell = if cfg!(windows) {
        None
    } else {
        std::env::var("SHELL").ok()
    };
    let Some(shell) = shell else {
        return std::env::var("PATH").unwrap_or_default();
    };
    let output = Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .output();
    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => std::env::var("PATH").unwrap_or_default(),
    }
}

/// Run the shell login once on startup so the PATH is captured before any
/// agent subprocess inherits it. Idempotent.
pub fn prime_login_shell_path() {
    let path = login_shell_path();
    if !path.is_empty() {
        // SAFETY: only setting env during startup single-threaded phase.
        unsafe {
            std::env::set_var("PATH", path);
        }
    }
}

fn load_settings_unlocked() -> AppSettings {
    let path = match settings_path() {
        Ok(p) => p,
        Err(_) => return AppSettings::default(),
    };

    if !path.exists() {
        // First run: detect paths and persist defaults.
        let settings = AppSettings {
            claude_path: detect_path("claude"),
            codex_path: detect_path("codex"),
            send_shortcut: default_send_shortcut(),
            terminal_shift_enter_newline: default_shift_enter_newline(),
            claude_force_default_tui: default_claude_force_default_tui(),
            terminal_scrollback: default_terminal_scrollback(),
        };
        if let Ok(dir) = nezha_dir() {
            let _ = fs::create_dir_all(&dir);
        }
        if let Ok(raw) = serde_json::to_string_pretty(&settings) {
            let _ = atomic_write(&path, &raw);
        }
        return settings;
    }

    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return AppSettings::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn agent_program_from_settings(settings: &AppSettings, agent: &str) -> String {
    let configured = match agent {
        "codex" => settings.codex_path.trim(),
        "claude" => settings.claude_path.trim(),
        _ => "",
    };
    crate::platform::resolve_spawn_program(if configured.is_empty() {
        agent
    } else {
        configured
    })
}

pub fn get_agent_program(agent: &str) -> String {
    agent_program_from_settings(&load_settings_unlocked(), agent)
}

pub fn claude_force_default_tui() -> bool {
    load_settings_unlocked().claude_force_default_tui
}

#[tauri::command]
pub async fn load_app_settings() -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(load_settings_unlocked)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    let _guard = settings_lock().lock();
    let dir = nezha_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = settings_path()?;
    let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    atomic_write(&path, &raw)
}

#[tauri::command]
pub async fn save_terminal_scrollback(scrollback: u32) -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = settings_lock().lock();
        let mut settings = load_settings_unlocked();
        settings.terminal_scrollback = clamp_terminal_scrollback(scrollback);
        let dir = nezha_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = settings_path()?;
        let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        atomic_write(&path, &raw)?;
        Ok::<AppSettings, String>(settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_terminal_shift_enter_newline(enabled: bool) -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = settings_lock().lock();
        let mut settings = load_settings_unlocked();
        settings.terminal_shift_enter_newline = enabled;
        let dir = nezha_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = settings_path()?;
        let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        atomic_write(&path, &raw)?;
        Ok::<AppSettings, String>(settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn detect_agent_paths() -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(|| {
        let mut settings = load_settings_unlocked();
        settings.claude_path = detect_path("claude");
        settings.codex_path = detect_path("codex");
        let _guard = settings_lock().lock();
        let dir = nezha_dir()?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = settings_path()?;
        let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        atomic_write(&path, &raw)?;
        Ok::<AppSettings, String>(settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn detect_claude_version() -> Option<String> {
    run_version_command(&get_agent_program("claude"))
}

pub fn detect_codex_version() -> Option<String> {
    run_version_command(&get_agent_program("codex"))
}

fn run_version_command(binary: &str) -> Option<String> {
    let output = Command::new(binary).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if s.is_empty() {
        let s2 = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if s2.is_empty() {
            None
        } else {
            Some(s2)
        }
    } else {
        Some(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_scrollback_is_clamped_and_snapped() {
        assert_eq!(clamp_terminal_scrollback(0), 500);
        assert_eq!(clamp_terminal_scrollback(749), 500);
        assert_eq!(clamp_terminal_scrollback(750), 1000);
        assert_eq!(clamp_terminal_scrollback(3200), 3000);
        assert_eq!(clamp_terminal_scrollback(9999), 5000);
    }

    #[test]
    fn legacy_settings_receive_default_scrollback() {
        let settings: AppSettings = serde_json::from_str(r#"{"send_shortcut":"enter"}"#).unwrap();
        assert_eq!(settings.terminal_scrollback, 1000);
    }

    #[test]
    fn terminal_defaults_match_the_settings_ui() {
        let settings = AppSettings::default();
        assert_eq!(settings.terminal_scrollback, 1000);
        assert!(settings.terminal_shift_enter_newline);
    }

    #[test]
    fn configured_agent_program_takes_priority_over_the_default_binary() {
        let settings = AppSettings {
            claude_path: "/custom/bin/claude".to_string(),
            codex_path: "/custom/bin/codex".to_string(),
            ..AppSettings::default()
        };
        assert_eq!(
            agent_program_from_settings(&settings, "claude"),
            "/custom/bin/claude"
        );
        assert_eq!(
            agent_program_from_settings(&settings, "codex"),
            "/custom/bin/codex"
        );
        let gemini = agent_program_from_settings(&settings, "gemini");
        assert_ne!(gemini, settings.claude_path);
        assert!(std::path::Path::new(&gemini)
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.to_ascii_lowercase().starts_with("gemini")));
    }

    #[test]
    fn ai_agent_entry_points_use_the_configured_program() {
        assert!(
            include_str!("agent_task_pty.rs").contains("app_settings::get_agent_program(spec.bin)")
        );
        assert!(include_str!("agent_assist.rs").contains("app_settings::get_agent_program(&agent)"));
        assert!(include_str!("git_neu.rs").contains("app_settings::get_agent_program(\"codex\")"));
    }

    #[test]
    fn version_detection_uses_the_same_configured_agent_program() {
        let source = include_str!("app_settings.rs");
        assert!(source.contains("run_version_command(&get_agent_program(\"claude\"))"));
        assert!(source.contains("run_version_command(&get_agent_program(\"codex\"))"));
    }
}
