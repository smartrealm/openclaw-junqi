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
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            claude_path: String::new(),
            codex_path: String::new(),
            send_shortcut: default_send_shortcut(),
            terminal_shift_enter_newline: default_shift_enter_newline(),
            claude_force_default_tui: default_claude_force_default_tui(),
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

/// Detect Claude Code version by running `claude --version`.
/// Result is cached per-process.
pub fn detect_claude_version() -> Option<String> {
    static CACHE: OnceLock<Mutex<Option<Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache.lock().expect("version cache poisoned");
        if let Some(v) = guard.as_ref() {
            return v.clone();
        }
    }
    let version = run_version_command("claude");
    let mut guard = cache.lock().expect("version cache poisoned");
    *guard = Some(version.clone());
    version
}

/// Detect Codex version by running `codex --version`.
pub fn detect_codex_version() -> Option<String> {
    static CACHE: OnceLock<Mutex<Option<Option<String>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    {
        let guard = cache.lock().expect("version cache poisoned");
        if let Some(v) = guard.as_ref() {
            return v.clone();
        }
    }
    let version = run_version_command("codex");
    let mut guard = cache.lock().expect("version cache poisoned");
    *guard = Some(version.clone());
    version
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
