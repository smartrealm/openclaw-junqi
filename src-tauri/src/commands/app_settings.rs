// ── JunQi application settings ───────────────────────────────────────────────
//
// Persists user-level settings to `<app-config>/settings.json`. Tracks:
//   - claude_path / codex_path: optional override of the agent executable
//   - send_shortcut: "enter" | "mod_enter"
//   - terminal_shift_enter_newline: bool
//   - claude_force_default_tui: bool
//   - language: native menu locale synchronized from the webview
//
use std::collections::BTreeMap;
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

fn default_privacy_lock_auto_lock_seconds() -> u64 {
    300
}

fn default_privacy_lock_shortcut() -> String {
    "CommandOrControl+Shift+L".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyLockSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_privacy_lock_auto_lock_seconds")]
    pub auto_lock_seconds: u64,
    #[serde(default = "default_true")]
    pub lock_on_resume: bool,
    #[serde(default = "default_true")]
    pub lock_on_startup: bool,
    #[serde(default = "default_true")]
    pub global_shortcut_enabled: bool,
    #[serde(default = "default_privacy_lock_shortcut")]
    pub global_shortcut: String,
}

impl Default for PrivacyLockSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            auto_lock_seconds: default_privacy_lock_auto_lock_seconds(),
            lock_on_resume: true,
            lock_on_startup: true,
            global_shortcut_enabled: true,
            global_shortcut: default_privacy_lock_shortcut(),
        }
    }
}

fn normalize_privacy_lock_settings(mut settings: PrivacyLockSettings) -> PrivacyLockSettings {
    if settings.enabled {
        // An enabled privacy lock must survive process termination, renderer
        // reload, and system resume. These are security invariants rather than
        // optional convenience preferences.
        settings.lock_on_startup = true;
        settings.lock_on_resume = true;
    }
    settings.auto_lock_seconds = if settings.auto_lock_seconds == 0 {
        0
    } else {
        settings.auto_lock_seconds.clamp(60, 3_600)
    };
    let shortcut = settings.global_shortcut.trim();
    settings.global_shortcut = if shortcut.is_empty() {
        default_privacy_lock_shortcut()
    } else {
        shortcut.chars().take(128).collect()
    };
    settings
}

const FALLBACK_APPLICATION_LANGUAGE: &str = "en";

fn normalize_application_language(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "zh-tw"
        || normalized == "zh_tw"
        || normalized == "zh-hk"
        || normalized == "zh_hk"
        || normalized == "zh-mo"
        || normalized == "zh_mo"
        || normalized.contains("hant")
    {
        Some("zh-TW")
    } else if normalized == "zh"
        || normalized == "zh-cn"
        || normalized == "zh_cn"
        || normalized == "zh-sg"
        || normalized == "zh_sg"
        || normalized.contains("hans")
    {
        Some("zh")
    } else if normalized == "ar" || normalized.starts_with("ar-") || normalized.starts_with("ar_") {
        Some("ar")
    } else if normalized == "en" || normalized.starts_with("en-") || normalized.starts_with("en_") {
        Some("en")
    } else {
        None
    }
}

fn system_application_language() -> Option<&'static str> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;

        let mut locale = [0_u16; 85];
        // SAFETY: `locale` is a writable UTF-16 buffer sized above the Windows
        // locale-name maximum. The API writes at most the supplied length.
        let length = unsafe { GetUserDefaultLocaleName(locale.as_mut_ptr(), locale.len() as i32) };
        if length > 1 {
            let locale = String::from_utf16_lossy(&locale[..length as usize - 1]);
            return normalize_application_language(&locale);
        }
    }

    #[cfg(not(windows))]
    {
        for key in ["LC_ALL", "LC_MESSAGES", "LANGUAGE", "LANG"] {
            if let Ok(value) = std::env::var(key) {
                if let Some(language) = normalize_application_language(&value) {
                    return Some(language);
                }
            }
        }
    }

    None
}

fn default_application_language() -> String {
    system_application_language()
        .unwrap_or(FALLBACK_APPLICATION_LANGUAGE)
        .to_string()
}

fn normalized_application_language(value: &str) -> Result<String, String> {
    normalize_application_language(value)
        .map(str::to_string)
        .ok_or_else(|| format!("Unsupported application language: {value}"))
}

fn clamp_terminal_scrollback(value: u32) -> u32 {
    let clamped = value.clamp(500, 5000);
    ((clamped + 250) / 500) * 500
}

const AGENT_PROFILE_ID_MAX_CHARS: usize = 128;
const AGENT_PROFILE_DOMAIN_MAX_CHARS: usize = 160;
const AGENT_PROFILE_SCOPE_MAX_CHARS: usize = 1000;

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AgentProfileMetadata {
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub scope: String,
}

fn normalize_agent_profile_id(value: &str) -> Result<String, String> {
    if value.chars().any(char::is_control) {
        return Err("Agent profile agent id cannot contain control characters".to_string());
    }
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err("Agent profile requires a non-empty agent id".to_string());
    }
    if normalized.chars().count() > AGENT_PROFILE_ID_MAX_CHARS {
        return Err(format!(
            "Agent profile agent id exceeds {AGENT_PROFILE_ID_MAX_CHARS} characters"
        ));
    }
    Ok(normalized.to_string())
}

fn normalize_agent_profile_field(
    value: &str,
    field: &str,
    max_chars: usize,
) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.chars().count() > max_chars {
        return Err(format!(
            "Agent profile {field} exceeds {max_chars} characters"
        ));
    }
    if normalized.chars().any(|character| character == '\0') {
        return Err(format!(
            "Agent profile {field} cannot contain NUL characters"
        ));
    }
    Ok(normalized.to_string())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct AppSettings {
    #[serde(default = "default_application_language")]
    pub language: String,
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
    #[serde(default)]
    pub agent_profiles: BTreeMap<String, AgentProfileMetadata>,
    #[serde(default)]
    pub privacy_lock: PrivacyLockSettings,
    #[serde(default)]
    pub privacy_lock_session_armed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            language: default_application_language(),
            claude_path: String::new(),
            codex_path: String::new(),
            send_shortcut: default_send_shortcut(),
            terminal_shift_enter_newline: default_shift_enter_newline(),
            claude_force_default_tui: default_claude_force_default_tui(),
            terminal_scrollback: default_terminal_scrollback(),
            agent_profiles: BTreeMap::new(),
            privacy_lock: PrivacyLockSettings::default(),
            privacy_lock_session_armed: false,
        }
    }
}

fn settings_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn settings_path() -> PathBuf {
    crate::paths::app_config_dir().join("settings.json")
}

fn persist_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path();
    let dir = path
        .parent()
        .ok_or_else(|| "JunQi settings path has no parent directory".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    atomic_write(&path, &raw)
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
    let path = settings_path();

    if !path.exists() {
        // First run: detect paths and persist defaults.
        let settings = AppSettings {
            language: default_application_language(),
            claude_path: detect_path("claude"),
            codex_path: detect_path("codex"),
            send_shortcut: default_send_shortcut(),
            terminal_shift_enter_newline: default_shift_enter_newline(),
            claude_force_default_tui: default_claude_force_default_tui(),
            terminal_scrollback: default_terminal_scrollback(),
            agent_profiles: BTreeMap::new(),
            privacy_lock: PrivacyLockSettings::default(),
            privacy_lock_session_armed: false,
        };
        let _ = persist_settings(&settings);
        return settings;
    }

    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return AppSettings::default(),
    };
    let mut settings = serde_json::from_str::<AppSettings>(&raw).unwrap_or_default();
    settings.send_shortcut = normalize_send_shortcut(settings.send_shortcut);
    settings.privacy_lock = normalize_privacy_lock_settings(settings.privacy_lock);
    settings
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

pub fn privacy_lock_settings() -> PrivacyLockSettings {
    load_settings_unlocked().privacy_lock
}

pub fn privacy_lock_session_armed() -> bool {
    load_settings_unlocked().privacy_lock_session_armed
}

pub fn set_privacy_lock_session_armed(armed: bool) -> Result<(), String> {
    let _guard = settings_lock()
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    let mut settings = load_settings_unlocked();
    settings.privacy_lock_session_armed = armed;
    persist_settings(&settings)
}

pub fn save_privacy_lock_settings(
    settings: PrivacyLockSettings,
) -> Result<PrivacyLockSettings, String> {
    let _guard = settings_lock()
        .lock()
        .map_err(|_| "settings lock poisoned".to_string())?;
    let mut app_settings = load_settings_unlocked();
    let settings = normalize_privacy_lock_settings(settings);
    app_settings.privacy_lock = settings.clone();
    if !settings.enabled {
        app_settings.privacy_lock_session_armed = false;
    }
    persist_settings(&app_settings)?;
    Ok(settings)
}

pub fn application_language() -> String {
    let settings = load_settings_unlocked();
    normalize_application_language(&settings.language)
        .unwrap_or(FALLBACK_APPLICATION_LANGUAGE)
        .to_string()
}

#[tauri::command]
pub async fn load_app_settings() -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(load_settings_unlocked)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_agent_profiles() -> Result<BTreeMap<String, AgentProfileMetadata>, String> {
    tokio::task::spawn_blocking(|| {
        let _guard = settings_lock()
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        Ok::<BTreeMap<String, AgentProfileMetadata>, String>(
            load_settings_unlocked().agent_profiles,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_agent_profile(
    agent_id: String,
    domain: String,
    scope: String,
) -> Result<Option<AgentProfileMetadata>, String> {
    tokio::task::spawn_blocking(move || {
        let agent_id = normalize_agent_profile_id(&agent_id)?;
        let profile = AgentProfileMetadata {
            domain: normalize_agent_profile_field(
                &domain,
                "domain",
                AGENT_PROFILE_DOMAIN_MAX_CHARS,
            )?,
            scope: normalize_agent_profile_field(&scope, "scope", AGENT_PROFILE_SCOPE_MAX_CHARS)?,
        };
        let _guard = settings_lock()
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        let mut settings = load_settings_unlocked();
        let saved = if profile.domain.is_empty() && profile.scope.is_empty() {
            settings.agent_profiles.remove(&agent_id)
        } else {
            settings.agent_profiles.insert(agent_id, profile.clone());
            Some(profile)
        };
        persist_settings(&settings)?;
        Ok::<Option<AgentProfileMetadata>, String>(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_agent_profile(agent_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let agent_id = normalize_agent_profile_id(&agent_id)?;
        let _guard = settings_lock()
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        let mut settings = load_settings_unlocked();
        settings.agent_profiles.remove(&agent_id);
        persist_settings(&settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn save_app_settings(mut settings: AppSettings) -> Result<(), String> {
    let _guard = settings_lock().lock();
    // Agent profiles have their own command boundary. Preserve them when an
    // older settings writer sends an AppSettings payload without that field.
    let current = load_settings_unlocked();
    settings.agent_profiles = current.agent_profiles;
    settings.privacy_lock = current.privacy_lock;
    settings.language = normalize_application_language(&settings.language)
        .unwrap_or(FALLBACK_APPLICATION_LANGUAGE)
        .to_string();
    persist_settings(&settings)
}

#[tauri::command]
pub async fn set_application_language(
    app: tauri::AppHandle,
    language: String,
) -> Result<String, String> {
    let language = normalized_application_language(&language)?;
    let persisted_language = tokio::task::spawn_blocking({
        let language = language.clone();
        move || {
            let _guard = settings_lock().lock();
            let mut settings = load_settings_unlocked();
            settings.language = language;
            persist_settings(&settings)?;
            Ok::<String, String>(settings.language)
        }
    })
    .await
    .map_err(|e| e.to_string())??;

    crate::tray::menu::update_tray_language(&app, &persisted_language)
        .map_err(|e| e.to_string())?;
    Ok(persisted_language)
}

#[tauri::command]
pub async fn save_terminal_scrollback(scrollback: u32) -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = settings_lock().lock();
        let mut settings = load_settings_unlocked();
        settings.terminal_scrollback = clamp_terminal_scrollback(scrollback);
        persist_settings(&settings)?;
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
        persist_settings(&settings)?;
        Ok::<AppSettings, String>(settings)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn apply_terminal_settings_defaults(settings: &mut AppSettings) {
    settings.terminal_scrollback = default_terminal_scrollback();
    settings.terminal_shift_enter_newline = default_shift_enter_newline();
}

#[tauri::command]
pub async fn reset_terminal_settings() -> Result<AppSettings, String> {
    tokio::task::spawn_blocking(move || {
        let _guard = settings_lock()
            .lock()
            .map_err(|_| "settings lock poisoned".to_string())?;
        let mut settings = load_settings_unlocked();
        apply_terminal_settings_defaults(&mut settings);
        persist_settings(&settings)?;
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
        persist_settings(&settings)?;
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
    fn settings_are_stored_in_the_application_config_directory() {
        assert_eq!(
            settings_path(),
            crate::paths::app_config_dir().join("settings.json")
        );
    }

    #[test]
    fn terminal_scrollback_is_clamped_and_snapped() {
        assert_eq!(clamp_terminal_scrollback(0), 500);
        assert_eq!(clamp_terminal_scrollback(749), 500);
        assert_eq!(clamp_terminal_scrollback(750), 1000);
        assert_eq!(clamp_terminal_scrollback(3200), 3000);
        assert_eq!(clamp_terminal_scrollback(9999), 5000);
    }

    #[test]
    fn missing_scrollback_uses_the_current_default() {
        let settings: AppSettings = serde_json::from_str(r#"{"send_shortcut":"enter"}"#).unwrap();
        assert_eq!(settings.terminal_scrollback, 1000);
    }

    #[test]
    fn app_settings_keep_agent_profiles_backward_compatible() {
        let settings: AppSettings = serde_json::from_str(r#"{"send_shortcut":"enter"}"#).unwrap();
        assert!(settings.agent_profiles.is_empty());
    }

    #[test]
    fn enabled_privacy_lock_forces_startup_and_resume_fences() {
        let normalized = normalize_privacy_lock_settings(PrivacyLockSettings {
            enabled: true,
            lock_on_startup: false,
            lock_on_resume: false,
            ..PrivacyLockSettings::default()
        });
        assert!(normalized.lock_on_startup);
        assert!(normalized.lock_on_resume);
    }

    #[test]
    fn privacy_lock_settings_are_backward_compatible_and_camel_case() {
        let settings: AppSettings = serde_json::from_str(r#"{"send_shortcut":"enter"}"#).unwrap();
        assert!(!settings.privacy_lock.enabled);
        assert_eq!(settings.privacy_lock.auto_lock_seconds, 300);
        assert!(settings.privacy_lock.lock_on_resume);
        assert!(!settings.privacy_lock_session_armed);
        let encoded = serde_json::to_value(settings.privacy_lock).unwrap();
        assert_eq!(encoded["autoLockSeconds"], 300);
        assert!(encoded.get("auto_lock_seconds").is_none());
    }

    #[test]
    fn agent_profile_fields_are_trimmed_and_empty_profiles_are_valid_for_deletion() {
        let id = normalize_agent_profile_id("  research  ").unwrap();
        let domain =
            normalize_agent_profile_field("  research  ", "domain", AGENT_PROFILE_DOMAIN_MAX_CHARS)
                .unwrap();
        let scope = normalize_agent_profile_field(
            "  internal tools  ",
            "scope",
            AGENT_PROFILE_SCOPE_MAX_CHARS,
        )
        .unwrap();
        assert_eq!(id, "research");
        assert_eq!(domain, "research");
        assert_eq!(scope, "internal tools");
        assert!(
            normalize_agent_profile_field("   ", "domain", AGENT_PROFILE_DOMAIN_MAX_CHARS)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn agent_profile_limits_reject_oversized_or_controlled_values() {
        assert!(normalize_agent_profile_id(&"a".repeat(AGENT_PROFILE_ID_MAX_CHARS + 1)).is_err());
        assert!(normalize_agent_profile_field(
            &"a".repeat(AGENT_PROFILE_DOMAIN_MAX_CHARS + 1),
            "domain",
            AGENT_PROFILE_DOMAIN_MAX_CHARS,
        )
        .is_err());
        assert!(normalize_agent_profile_field(
            "scope\0value",
            "scope",
            AGENT_PROFILE_SCOPE_MAX_CHARS
        )
        .is_err());
    }

    #[test]
    fn application_language_accepts_supported_locale_tags() {
        assert_eq!(normalize_application_language("zh-CN"), Some("zh"));
        assert_eq!(normalize_application_language("zh-TW"), Some("zh-TW"));
        assert_eq!(normalize_application_language("en_US"), Some("en"));
        assert_eq!(normalize_application_language("ar-SA"), Some("ar"));
        assert_eq!(normalize_application_language("fr-FR"), None);
    }

    #[test]
    fn terminal_defaults_match_the_settings_ui() {
        let settings = AppSettings::default();
        assert_eq!(settings.terminal_scrollback, 1000);
        assert!(settings.terminal_shift_enter_newline);
    }

    #[test]
    fn terminal_reset_changes_both_native_preferences_as_one_settings_value() {
        let mut settings = AppSettings {
            terminal_scrollback: 5000,
            terminal_shift_enter_newline: false,
            ..AppSettings::default()
        };
        apply_terminal_settings_defaults(&mut settings);
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
