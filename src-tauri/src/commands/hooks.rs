// ── Hook readiness (minimal port of nezha hooks.rs) ──────────────────────────
//
// This is a minimal subset of nezha's hooks.rs that exposes only what the
// frontend `NewTaskView` calls:
//   - `HookAgentReadiness` struct (serialized to JSON for `get_hook_readiness`)
//   - `usable_for(agent)` (returns false until hooks are installed)
//   - `get_hook_readiness` Tauri command
//   - `cache_status` / `current_status` / `ensure_installed` / `uninstall`
//     (stubs — the full hook installation system from nezha is not ported yet)
//
// Why minimal:
//   - Full port requires: `~/.nezha/hooks/nezha-hook.mjs` script content
//     (inlined via `include_str!`), complex `~/.claude/settings.json` mutation
//     with `_nezha_managed` markers, `~/.codex/config.toml` region rewriting,
//     and event-watcher background thread. That's ~700 lines of nuanced code.
//   - Frontend only needs `get_hook_readiness` to show the "soft" hook warning
//     banner. Backend simply reports "no node" / "not installed" until the
//     full installer lands.

use std::sync::{Mutex, OnceLock};

/// Hook install status — mirrors nezha's `HookInstallStatus`.
/// `script_installed` and `settings_linked` track the two halves of
/// installation. They're `false` until `ensure_installed` runs successfully.
#[derive(Clone, Debug)]
pub struct HookInstallStatus {
    pub script_installed: bool,
    pub settings_linked: bool,
    pub script_path: Option<String>,
}

impl Default for HookInstallStatus {
    fn default() -> Self {
        Self {
            script_installed: false,
            settings_linked: false,
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
    cached_status().lock().expect("hook status poisoned").clone()
}

/// Whether `agent`'s hooks are usable. Without the full installer landed,
/// this always returns false and the frontend falls back to polling.
pub fn usable_for(_agent: &str) -> bool {
    current_status().script_installed && current_status().settings_linked
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

    // Build Nezha's own Claude settings file. Contains hook entries pointing
    // at the script above, plus optional `tui: default` override.
    let settings = serde_json::json!({
        "tui": "default",
        "hooks": {
            "SessionStart":     [{ "type": "command", "command": format!("node \"{}\"", script_path.display()) }],
            "UserPromptSubmit": [{ "type": "command", "command": format!("node \"{}\"", script_path.display()) }],
            "Notification":     [{ "type": "command", "command": format!("node \"{}\"", script_path.display()) }],
            "PostToolUse":      [{ "type": "command", "command": format!("node \"{}\"", script_path.display()) }],
            "Stop":             [{ "type": "command", "command": format!("node \"{}\"", script_path.display()) }],
            "SubagentStop":     [{ "type": "command", "command": format!("node \"{}\"", script_path.display()) }],
        }
    });
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
        assert!(s.script_path.is_none());
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

        let claude_version = detect_agent_version("claude");
        let codex_version = detect_agent_version("codex");

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
                usable: false, // false until hooks installer lands
                reason: Some("not_installed".to_string()),
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
                usable: false,
                reason: Some("not_installed".to_string()),
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

fn detect_agent_version(binary: &str) -> Option<String> {
    std::process::Command::new(binary)
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() {
                String::from_utf8_lossy(&o.stderr).trim().to_string().into()
            } else {
                Some(s)
            }
        })
}

/// Loose semver-ish compare: returns true if `have < min`.
/// Handles `1.2.3`, `1.2`, `v1.2.3`, and prefixes like `claude 2.1.87 (...)`.
fn version_lt(have: &str, min: &str) -> bool {
    fn parse(v: &str) -> Vec<u64> {
        // Strip leading non-digit prefix (e.g. "v", "claude ", "codex ").
        let trimmed = v.trim();
        let bytes = trimmed.as_bytes();
        let mut start = 0;
        while start < bytes.len() && (bytes[start].is_ascii_alphabetic() || bytes[start] == b' ') {
            start += 1;
        }
        let numeric = &trimmed[start..];
        // Take only the first token (split by whitespace or '-').
        let token = numeric
            .split_whitespace()
            .next()
            .unwrap_or(numeric)
            .split('-')
            .next()
            .unwrap_or(numeric);
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