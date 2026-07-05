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

const TRANSIENT_START_ERROR_PATTERNS: &[&str] = &[
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

/// Returns true when every stderr line matches a known transient cause.
/// Transient errors should be retried with backoff; they are NOT the user's
/// fault (port contention, network blip, process still warming up).
pub fn is_transient_start_failure(stderr_lines: &[String]) -> bool {
    if stderr_lines.is_empty() {
        return false; // Exit with no output → assume non-transient.
    }
    for line in stderr_lines {
        let normalized = line.trim().to_lowercase();
        let matched = TRANSIENT_START_ERROR_PATTERNS.iter().any(|pat| normalized.contains(&pat.to_lowercase()));
        if !matched {
            return false; // One unrecognized line → treat as non-transient.
        }
    }
    true
}

/// Suggested recovery action to surface to the user.
#[derive(Debug)]
pub enum RecoveryAction {
    /// Config validation failure — likely bad provider key or schema.
    FixConfig,
    /// Transient error — backoff and retry automatically.
    Retry,
    /// Unknown — recommend running `openclaw doctor`.
    RunDoctor,
    /// No issue — startup succeeded.
    None,
}

/// Returns the recommended action from a set of diagnostic inputs.
pub fn diagnose_startup_failure(
    stderr_lines: &[String],
    already_attempted_config_repair: bool,
) -> RecoveryAction {
    if stderr_lines.is_empty() {
        return RecoveryAction::RunDoctor;
    }
    if has_invalid_config_signal(stderr_lines) && !already_attempted_config_repair {
        return RecoveryAction::FixConfig;
    }
    if is_transient_start_failure(stderr_lines) {
        return RecoveryAction::Retry;
    }
    RecoveryAction::RunDoctor
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_invalid_config() {
        assert!(has_invalid_config_signal(&["Error: invalid config key 'foo'".into()]));
    }

    #[test]
    fn detects_transient() {
        assert!(is_transient_start_failure(&["ECONNREFUSED 127.0.0.1:18789".into()]));
    }

    #[test]
    fn mixed_lines_not_transient() {
        assert!(!is_transient_start_failure(&[
            "running...".into(),
            "unknown error".into(),
        ]));
    }

    #[test]
    fn empty_lines_is_not_transient() {
        assert!(!is_transient_start_failure(&[]));
    }

    #[test]
    fn port_occupied_is_transient() {
        assert!(is_transient_start_failure(&["Port 18789 still occupied after 500ms".into()]));
    }

    #[test]
    fn diagnosis_recommends_retry_for_transient() {
        let action = diagnose_startup_failure(
            &["ECONNREFUSED".into()],
            false,
        );
        assert!(matches!(action, RecoveryAction::Retry));
    }

    #[test]
    fn diagnosis_recommends_fix_config_when_not_yet_attempted() {
        let action = diagnose_startup_failure(
            &["invalid config: missing provider".into()],
            false,
        );
        assert!(matches!(action, RecoveryAction::FixConfig));
    }

    #[test]
    fn diagnosis_recommends_doctor_after_config_repair_attempted() {
        let action = diagnose_startup_failure(
            &["invalid config".into()],
            true, // already tried fix
        );
        assert!(matches!(action, RecoveryAction::RunDoctor));
    }
}
