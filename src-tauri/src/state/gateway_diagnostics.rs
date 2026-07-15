//! Gateway startup failure diagnostics.
//!
//! When the child process exits before the first gateway readiness probe, we classify
//! its stderr lines to distinguish between "fix your config" (actionable) and
//! "transient error, retry with backoff" (not the user's fault).
//!
//!
const INVALID_CONFIG_PATTERNS: &[&str] = &[
    "invalid config",
    "config invalid",
    "unrecognized key",
    "run: openclaw doctor --fix",
];

const REPAIR_PATTERNS: &[&str] = &[
    "failed post-core payload smoke check",
    "missing-main-entry",
    "startup migrations did not complete",
    "openclaw update repair",
    "plugin payload",
];

const TRANSIENT_START_ERROR_PATTERNS: &[&str] = &[
    "startup migrations are already running",
    "WebSocket closed before handshake",
    "ECONNREFUSED",
    "Gateway process exited before becoming ready",
    "Timed out waiting for connect.challenge",
    "Connect handshake timeout",
    "gateway starting",
    "Port ",
];

/// Returns true when any stderr line looks like an OpenClaw config validation
/// failure — actionable by the user (fix the JSON, provider key, etc.).
pub fn has_invalid_config_signal(stderr_lines: &[String]) -> bool {
    for line in stderr_lines {
        let normalized = line.trim().to_lowercase();
        for pat in INVALID_CONFIG_PATTERNS {
            if normalized.contains(&pat.to_lowercase()) {
                return true;
            }
        }
    }
    false
}

/// Returns true when the diagnostic contains a known transient cause.
/// Transient errors should be retried with backoff; they are NOT the user's
/// fault (port contention, network blip, process still warming up).
pub fn is_transient_start_failure(stderr_lines: &[String]) -> bool {
    if stderr_lines.is_empty() {
        return false; // Exit with no output → assume non-transient.
    }
    stderr_lines.iter().any(|line| {
        let normalized = line.trim().to_lowercase();
        TRANSIENT_START_ERROR_PATTERNS
            .iter()
            .any(|pat| normalized.contains(&pat.to_lowercase()))
    })
}

/// Suggested recovery action to surface to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    InspectConfig,
    Retry,
    Repair,
}

/// Returns the recommended action from a set of diagnostic inputs.
pub fn diagnose_startup_failure(
    stderr_lines: &[String],
    _already_attempted_config_repair: bool,
) -> RecoveryAction {
    if has_invalid_config_signal(stderr_lines) {
        return RecoveryAction::InspectConfig;
    }
    if stderr_lines.iter().any(|line| {
        let normalized = line.to_ascii_lowercase();
        REPAIR_PATTERNS
            .iter()
            .any(|pattern| normalized.contains(pattern))
    }) {
        return RecoveryAction::Repair;
    }
    if is_transient_start_failure(stderr_lines) {
        return RecoveryAction::Retry;
    }
    RecoveryAction::Repair
}

#[tauri::command]
pub fn diagnose_gateway_recovery(error: String) -> RecoveryAction {
    diagnose_startup_failure(
        &error.lines().map(str::to_string).collect::<Vec<_>>(),
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_invalid_config() {
        assert!(has_invalid_config_signal(&[
            "Error: invalid config key 'foo'".into()
        ]));
    }

    #[test]
    fn detects_transient() {
        assert!(is_transient_start_failure(&[
            "ECONNREFUSED 127.0.0.1:18789".into()
        ]));
    }

    #[test]
    fn migration_lock_contention_retries_instead_of_repairing_plugins() {
        let error = "OpenClaw startup migrations are already running for this state directory; retry after the other gateway finishes or after 2026-07-15T04:50:45.044Z.";
        assert!(is_transient_start_failure(&[error.into()]));
        assert_eq!(
            diagnose_startup_failure(&[error.into()], false),
            RecoveryAction::Retry
        );
    }

    #[test]
    fn mixed_lines_with_transient_signal_are_transient() {
        assert!(is_transient_start_failure(&[
            "ECONNREFUSED 127.0.0.1:18789".into(),
            "unknown error".into(),
        ]));
    }

    #[test]
    fn empty_lines_is_not_transient() {
        assert!(!is_transient_start_failure(&[]));
    }

    #[test]
    fn port_occupied_is_transient() {
        assert!(is_transient_start_failure(&[
            "Port 18789 still occupied after 500ms".into()
        ]));
    }

    #[test]
    fn diagnosis_recommends_retry_for_transient() {
        let action = diagnose_startup_failure(&["ECONNREFUSED".into()], false);
        assert!(matches!(action, RecoveryAction::Retry));
    }

    #[test]
    fn diagnosis_recommends_fix_config_when_not_yet_attempted() {
        let action = diagnose_startup_failure(&["invalid config: missing provider".into()], false);
        assert!(matches!(action, RecoveryAction::InspectConfig));
    }

    #[test]
    fn diagnosis_recommends_doctor_after_config_repair_attempted() {
        let action = diagnose_startup_failure(
            &["invalid config".into()],
            true, // already tried fix
        );
        assert!(matches!(action, RecoveryAction::InspectConfig));
    }

    #[test]
    fn diagnosis_recommends_repair_for_missing_plugin_entry() {
        let action = diagnose_startup_failure(&["openclaw-lark missing-main-entry".into()], false);
        assert_eq!(action, RecoveryAction::Repair);
    }
}
