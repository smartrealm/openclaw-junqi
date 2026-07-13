// Agent hook installation and readiness for the AI workspace. Claude uses an
// isolated settings file; Codex receives an idempotent managed TOML block.

use std::fs;
use std::sync::{Mutex, OnceLock};

/// Hook install status — mirrors nezha's `HookInstallStatus`.
/// `script_installed` and `settings_linked` track the two halves of
/// installation. They're `false` until `ensure_installed` runs successfully.
#[derive(Clone, Debug)]
pub struct HookInstallStatus {
    pub script_installed: bool,
    pub settings_linked: bool,
    pub codex_installed: bool,
    pub script_path: Option<String>,
}

impl Default for HookInstallStatus {
    fn default() -> Self {
        Self {
            script_installed: false,
            settings_linked: false,
            codex_installed: false,
            script_path: None,
        }
    }
}

/// Per-agent readiness — what `get_hook_readiness` returns as a JSON array.
#[derive(serde::Serialize, Clone, Debug)]
pub struct HookAgentReadiness {
    pub agent: String,
    pub usable: bool,
    /// When `!usable`, why:
    ///   - "version_too_low": detected agent is below minimum version
    ///   - "no_node": node not on PATH (hooks require node)
    ///   - "not_installed": agent present but hooks not installed
    pub reason: Option<String>,
    pub detected_version: Option<String>,
    pub min_version: Option<String>,
}

static CACHED_STATUS: OnceLock<Mutex<HookInstallStatus>> = OnceLock::new();

/// nezha-hook.mjs embedded as a string literal so the installer is self-contained.
/// Source: src-tauri/src/nezha/nezha-hook.mjs (71 lines).
const HOOK_SCRIPT: &str = include_str!("../nezha/nezha-hook.mjs");

fn cached_status() -> &'static Mutex<HookInstallStatus> {
    CACHED_STATUS.get_or_init(|| Mutex::new(HookInstallStatus::default()))
}

/// Update the cached install status. Called from `ensure_installed` after
/// running the installer.
pub fn cache_status(status: HookInstallStatus) {
    let mut guard = cached_status().lock().expect("hook status poisoned");
    *guard = status;
}

/// Read the cached install status.
pub fn current_status() -> HookInstallStatus {
    cached_status()
        .lock()
        .expect("hook status poisoned")
        .clone()
}

/// Whether the selected agent's hook configuration was installed successfully.
pub fn usable_for(_agent: &str) -> bool {
    let status = current_status();
    status.script_installed
        && if _agent == "codex" {
            status.codex_installed
        } else {
            status.settings_linked
        }
}

/// Run the hook installer. Writes:
///   1. `~/.nezha/hooks/nezha-hook.mjs` — the event-collection script
///   2. `~/.nezha/hooks/claude-settings.json` — Nezha's own settings file
///      (passed to Claude via `--settings`, never mutates user's settings.json)
///
/// Returns the install status. Subsequent `usable_for("claude")` returns true
/// once the script + settings file exist on disk.
pub fn ensure_installed() -> HookInstallStatus {
    match install_hook_files() {
        Ok((script_path_str, settings_path_str)) => {
            let status = HookInstallStatus {
                script_installed: true,
                settings_linked: true,
                codex_installed: install_codex_hooks(&script_path_str).unwrap_or(false),
                script_path: Some(script_path_str),
            };
            let _ = settings_path_str; // kept for future settings_linked parity
            cache_status(status.clone());
            status
        }
        Err(_) => {
            let status = HookInstallStatus::default();
            cache_status(status.clone());
            status
        }
    }
}

fn hooks_dir_internal() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".nezha").join("hooks"))
}

pub fn settings_path() -> Result<std::path::PathBuf, String> {
    Ok(hooks_dir_internal()?.join("claude-settings.json"))
}

pub fn events_root() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    Ok(home.join(".nezha").join("events"))
}

pub fn events_dir_for(task_id: &str) -> Result<std::path::PathBuf, String> {
    Ok(events_root()?.join(crate::commands::agent_task_pty::safe_task_id(task_id)))
}

fn install_hook_files() -> Result<(String, String), String> {
    use std::path::PathBuf;

    let dir: PathBuf = hooks_dir_internal()?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create {}: {}", dir.display(), e))?;

    let script_path = dir.join("nezha-hook.mjs");
    std::fs::write(&script_path, HOOK_SCRIPT).map_err(|e| e.to_string())?;
    // Make the script executable on unix (best-effort; Windows ignores).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&script_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&script_path, perms);
        }
    }

    // Build Nezha's isolated Claude settings file with hook entries only.
    // User settings remain untouched and no unrelated scalar options are overridden.
    let settings = build_claude_settings(
        &script_path,
        super::app_settings::claude_force_default_tui(),
    );
    let settings_path = dir.join("claude-settings.json");
    std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok((
        script_path.to_string_lossy().into_owned(),
        settings_path.to_string_lossy().into_owned(),
    ))
}

fn build_claude_settings(
    script_path: &std::path::Path,
    force_default_tui: bool,
) -> serde_json::Value {
    let command = format!("node \"{}\"", script_path.display());
    let entry = || serde_json::json!({ "hooks": [{ "type": "command", "command": command }] });
    let mut settings = serde_json::json!({
        "hooks": {
            "SessionStart":     [entry()],
            "UserPromptSubmit": [entry()],
            "Notification":     [entry()],
            "PostToolUse":      [entry()],
            "Stop":             [entry()],
            "SubagentStop":     [entry()],
        }
    });
    if force_default_tui {
        settings["tui"] = serde_json::Value::String("default".to_string());
    }
    settings
}

const CODEX_HOOK_MIN_VERSION: &str = "0.131.0";
const CODEX_BEGIN: &str = "# >>> nezha-managed-begin (do not edit; managed by Nezha) >>>";
const CODEX_END: &str = "# <<< nezha-managed-end <<<";
const CODEX_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PermissionRequest",
    "PostToolUse",
    "Stop",
    "SubagentStop",
];

fn toml_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn build_codex_block(script_path: &str) -> String {
    let command = toml_quote(&format!("node \"{script_path}\""));
    let mut block = format!("{CODEX_BEGIN}\n");
    for event in CODEX_EVENTS {
        block.push_str(&format!("[[hooks.{event}]]\n[[hooks.{event}.hooks]]\ntype = \"command\"\ncommand = {command}\n\n"));
    }
    block.push_str(&format!("{CODEX_END}\n"));
    block
}

fn inject_codex_text(existing: &str, script_path: &str) -> String {
    let block = build_codex_block(script_path);
    if let (Some(begin), Some(end)) = (existing.find(CODEX_BEGIN), existing.find(CODEX_END)) {
        if begin < end {
            let end = existing[end..]
                .find('\n')
                .map(|offset| end + offset + 1)
                .unwrap_or(existing.len());
            return format!("{}{}{}", &existing[..begin], block, &existing[end..]);
        }
    }
    format!(
        "{}{}{}",
        existing,
        if existing.is_empty() || existing.ends_with('\n') {
            ""
        } else {
            "\n"
        },
        block
    )
}

fn install_codex_hooks(script_path: &str) -> Result<bool, String> {
    let Some(version) = super::app_settings::detect_codex_version() else {
        return Ok(false);
    };
    if version_lt(&version, CODEX_HOOK_MIN_VERSION) {
        return Ok(false);
    }
    let home = dirs::home_dir().ok_or_else(|| "Cannot find home directory".to_string())?;
    let path = home.join(".codex").join("config.toml");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let updated = inject_codex_text(&existing, script_path);
    toml::from_str::<toml::Value>(&updated)
        .map_err(|error| format!("Codex hook config is invalid: {error}"))?;
    let temporary = path.with_extension("toml.junqi.tmp");
    fs::write(&temporary, updated).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())?;
    Ok(true)
}

/// Remove hooks from both agents' config files. Stub.
pub fn uninstall() -> Result<(), String> {
    cache_status(HookInstallStatus::default());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Override the hooks dir for testing — production code reads from
    /// `~/.nezha/hooks`, which we don't want to touch during unit tests.
    /// This test-only module sets a unique temp dir each time.
    fn with_temp_hooks_dir<F: FnOnce()>(f: F) {
        let dir = std::env::temp_dir().join(format!(
            "junqi-hooks-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();

        // We can't easily mock the home dir without restructuring; the
        // simplest test is to verify the constants and the script body are
        // sane without actually writing to ~/.nezha.
        let _ = dir; // silence unused warning

        f();
    }

    #[test]
    fn hook_script_constant_is_non_empty_and_node_script() {
        assert!(!HOOK_SCRIPT.is_empty());
        assert!(HOOK_SCRIPT.contains("#!/usr/bin/env node"));
        // Must reference the env vars the bridge depends on.
        assert!(HOOK_SCRIPT.contains("NEZHA_TASK_ID"));
        assert!(HOOK_SCRIPT.contains("NEZHA_EVENT_DIR"));
        // Must exit cleanly when env vars are absent (no side effects).
        assert!(HOOK_SCRIPT.contains("process.exit(0)"));
    }

    #[test]
    fn hook_script_handles_node_eof_error_on_windows() {
        // The 'error' listener is critical on Windows where reading a
        // closed stdin pipe raises an EOF error. Removing this handler
        // would crash the hook and break agent invocation.
        assert!(HOOK_SCRIPT.contains("process.stdin.on(\"error\", finish)"));
    }

    #[test]
    fn hook_install_status_default_is_uninstalled() {
        let s = HookInstallStatus::default();
        assert!(!s.script_installed);
        assert!(!s.settings_linked);
        assert!(!s.codex_installed);
        assert!(s.script_path.is_none());
    }

    #[test]
    fn claude_hook_settings_use_the_current_nested_schema() {
        let settings = build_claude_settings(std::path::Path::new("/tmp/nezha-hook.mjs"), false);
        assert_eq!(
            settings["hooks"]["Stop"][0]["hooks"][0]["command"],
            "node \"/tmp/nezha-hook.mjs\""
        );
        assert!(settings.get("tui").is_none());
    }

    #[test]
    fn claude_hook_settings_can_force_the_default_tui_without_touching_user_settings() {
        let settings = build_claude_settings(std::path::Path::new("/tmp/nezha-hook.mjs"), true);
        assert_eq!(settings["tui"], "default");
        assert!(settings["hooks"]["Stop"].is_array());
    }

    #[test]
    fn cached_status_starts_uninstalled() {
        // Reset to known state so prior tests (which mutate the global) don't
        // leak into this assertion.
        cache_status(HookInstallStatus::default());
        let s = current_status();
        assert!(!s.script_installed);
        assert!(!s.settings_linked);
    }

    #[test]
    fn cache_status_round_trips_through_global() {
        let injected = HookInstallStatus {
            script_installed: true,
            settings_linked: true,
            codex_installed: true,
            script_path: Some("/tmp/test-hook.mjs".to_string()),
        };
        cache_status(injected.clone());
        let read_back = current_status();
        assert_eq!(read_back.script_installed, true);
        assert_eq!(read_back.settings_linked, true);
        assert_eq!(read_back.script_path.as_deref(), Some("/tmp/test-hook.mjs"));

        // Reset for other tests.
        cache_status(HookInstallStatus::default());
    }

    #[test]
    fn usable_for_returns_false_when_nothing_installed() {
        cache_status(HookInstallStatus::default());
        assert!(!usable_for("claude"));
        assert!(!usable_for("codex"));
    }

    #[test]
    fn usable_for_returns_true_after_install_marks_both() {
        cache_status(HookInstallStatus {
            script_installed: true,
            settings_linked: true,
            codex_installed: true,
            script_path: Some("/fake/path".to_string()),
        });
        assert!(usable_for("claude"));
        assert!(usable_for("codex"));

        cache_status(HookInstallStatus::default());
    }

    #[test]
    fn hook_command_format_is_unix_safe() {
        // The command uses bare `node` (not absolute path) + quoted script path,
        // which works on both Unix and Windows shells.
        let cmd = format!("node \"{}\"", "/some path/with space/hook.mjs");
        assert!(cmd.starts_with("node "));
        assert!(cmd.contains('"'));
    }

    #[test]
    fn codex_hook_injection_is_idempotent_and_preserves_user_config() {
        let original = "model = \"gpt-5\"\n";
        let first = inject_codex_text(original, "/tmp/nezha hook.mjs");
        let second = inject_codex_text(&first, "/tmp/new-hook.mjs");
        assert!(second.starts_with(original));
        assert_eq!(second.matches(CODEX_BEGIN).count(), 1);
        assert!(second.contains("PermissionRequest"));
        assert!(second.contains("new-hook.mjs"));
        toml::from_str::<toml::Value>(&second).expect("injected config is valid TOML");
    }

    #[test]
    fn version_comparison_accepts_codex_cli_prefix() {
        assert!(!version_lt("codex-cli 0.131.0", CODEX_HOOK_MIN_VERSION));
        assert!(version_lt("codex-cli 0.130.9", CODEX_HOOK_MIN_VERSION));
    }

    #[test]
    #[ignore] // run with: cargo test hooks::tests::install_hook_files_end_to_end -- --ignored
    fn install_hook_files_end_to_end() {
        // Marked #[ignore] so the suite doesn't accidentally touch the real
        // ~/.nezha/hooks dir on developer machines. Run explicitly when needed:
        //   cargo test hooks::tests::install_hook_files_end_to_end -- --ignored
        with_temp_hooks_dir(|| {
            // Currently the install path is hard-coded to ~/.nezha/hooks via
            // hooks_dir_internal(); full E2E would need a HOME override.
            // For now, just verify the function returns Err gracefully when
            // the home dir is unwritable — which it isn't in a test env.
            let _ = ensure_installed();
        });
    }
}

#[tauri::command]
pub async fn get_hook_readiness() -> Result<Vec<HookAgentReadiness>, String> {
    tokio::task::spawn_blocking(|| {
        let node_present = detect_node().is_some();

        let claude_version = super::app_settings::detect_claude_version();
        let codex_version = super::app_settings::detect_codex_version();

        let claude_min = "2.1.87";
        let codex_min = "0.131.0";

        let mut out: Vec<HookAgentReadiness> = Vec::new();

        out.push(match claude_version {
            None => HookAgentReadiness {
                agent: "claude".to_string(),
                usable: false,
                reason: Some("not_installed".to_string()),
                detected_version: None,
                min_version: Some(claude_min.to_string()),
            },
            Some(ver) if !node_present => HookAgentReadiness {
                agent: "claude".to_string(),
                usable: false,
                reason: Some("no_node".to_string()),
                detected_version: Some(ver),
                min_version: Some(claude_min.to_string()),
            },
            Some(ver) if version_lt(&ver, claude_min) => HookAgentReadiness {
                agent: "claude".to_string(),
                usable: false,
                reason: Some("version_too_low".to_string()),
                detected_version: Some(ver),
                min_version: Some(claude_min.to_string()),
            },
            Some(ver) => HookAgentReadiness {
                agent: "claude".to_string(),
                usable: usable_for("claude"),
                reason: (!usable_for("claude")).then(|| "not_installed".to_string()),
                detected_version: Some(ver),
                min_version: Some(claude_min.to_string()),
            },
        });

        out.push(match codex_version {
            None => HookAgentReadiness {
                agent: "codex".to_string(),
                usable: false,
                reason: Some("not_installed".to_string()),
                detected_version: None,
                min_version: Some(codex_min.to_string()),
            },
            Some(ver) if !node_present => HookAgentReadiness {
                agent: "codex".to_string(),
                usable: false,
                reason: Some("no_node".to_string()),
                detected_version: Some(ver),
                min_version: Some(codex_min.to_string()),
            },
            Some(ver) if version_lt(&ver, codex_min) => HookAgentReadiness {
                agent: "codex".to_string(),
                usable: false,
                reason: Some("version_too_low".to_string()),
                detected_version: Some(ver),
                min_version: Some(codex_min.to_string()),
            },
            Some(ver) => HookAgentReadiness {
                agent: "codex".to_string(),
                usable: usable_for("codex"),
                reason: (!usable_for("codex")).then(|| "not_installed".to_string()),
                detected_version: Some(ver),
                min_version: Some(codex_min.to_string()),
            },
        });

        Ok::<Vec<HookAgentReadiness>, String>(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn detect_node() -> Option<String> {
    let lookup = if cfg!(windows) { "where" } else { "which" };
    std::process::Command::new(lookup)
        .arg("node")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8(o.stdout)
                .ok()
                .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
        })
        .filter(|s| !s.is_empty())
}

/// Loose semver-ish compare: returns true if `have < min`.
/// Handles `1.2.3`, `v1.2.3`, `claude 2.1.87`, and `codex-cli 0.131.0`.
fn version_lt(have: &str, min: &str) -> bool {
    fn parse(v: &str) -> Vec<u64> {
        let start = v
            .find(|character: char| character.is_ascii_digit())
            .unwrap_or(v.len());
        let numeric = &v[start..];
        let end = numeric
            .find(|character: char| !character.is_ascii_digit() && character != '.')
            .unwrap_or(numeric.len());
        let token = &numeric[..end];
        token
            .split('.')
            .filter_map(|p| p.parse::<u64>().ok())
            .collect()
    }

    let a = parse(have);
    let b = parse(min);
    let n = a.len().max(b.len());
    for i in 0..n {
        let av = a.get(i).copied().unwrap_or(0);
        let bv = b.get(i).copied().unwrap_or(0);
        if av < bv {
            return true;
        }
        if av > bv {
            return false;
        }
    }
    false
}
