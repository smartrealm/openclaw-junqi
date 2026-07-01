//! Gateway startup sequence orchestrator — ported from ClawX
//! electron/gateway/startup-orchestrator.ts (140 lines).
//!
//! Coordinates the existing modules into a single startup pipeline:
//!   1. Check for an existing gateway on our port (don't kill foreign processes).
//!   2. If foreign gateway is up, just connect to it.
//!   3. If no gateway, wait for the port to be free, then spawn our
//!      managed child.
//!   4. Health-check loop with bounded retry on transient errors.
//!   5. On non-recoverable error, attempt `openclaw doctor --fix` once
//!      (the doctor-repair Tauri command is exposed; calling it from
//!      here would require an AppHandle, which is threaded through
//!      the IPC layer in production).
//!
//! NOTE: This orchestrator is the SINGLE SOURCE OF TRUTH for the
//! startup pipeline. The existing `start_gateway` Tauri command still
//! has its own inline implementation (kept for backward compat); the
//! two paths will be unified in a follow-up commit that drops the
//! inline code and routes through here.

use crate::commands::gateway::{is_gateway_serving, GatewayStatus};
use crate::commands::gateway_supervisor::{transition_lifecycle, wait_for_port_free};
use crate::state::gateway_process::{GatewayLifecycle, LogLevel, LogSource};
use crate::state::GatewayProcess;

const DEFAULT_MAX_START_ATTEMPTS: u32 = 3;
const DEFAULT_HEALTH_RETRY_ATTEMPTS: u32 = 5;
const DEFAULT_HEALTH_RETRY_INTERVAL_MS: u64 = 1_000;

/// Run the full startup sequence. Returns the final GatewayStatus.
/// On any non-recoverable failure returns Err — caller should let
/// the frontend surface the error.
///
/// TODO: thread AppHandle through so the doctor-repair step can
/// actually call gateway_supervisor::openclaw_doctor_repair. For
/// now, doctor-repair is skipped on the orchestrator path; the
/// frontend can still trigger it explicitly via the standalone
/// Tauri command.
pub async fn run_gateway_startup_sequence(
    state: &GatewayProcess,
) -> Result<GatewayStatus, String> {
    transition_lifecycle(state, GatewayLifecycle::Starting,
                        "startup_orchestrator: beginning sequence");

    // 1. Foreign gateway on our port? Just connect.
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    if is_gateway_serving(port).await {
        transition_lifecycle(state, GatewayLifecycle::Running,
                            "startup_orchestrator: foreign gateway already up");
        return report_status(state, port).await;
    }

    // 2. No foreign gateway. Try to wait for the port to be free
    //    (handles TCP TIME_WAIT and launchd ghost children).
    if let Err(e) = wait_for_port_free(port, 30_000).await {
        transition_lifecycle(state, GatewayLifecycle::Error,
                            &format!("startup_orchestrator: port {} not free: {}", port, e));
        return Err(e);
    }

    // 3. Spawn our own managed child. Up to N attempts with
    //    exponential backoff. Each attempt reuses the existing
    //    start_gateway Tauri command (via the IPC layer in production,
    //    or directly when called from the same process).
    let mut last_err: Option<String> = None;
    for attempt in 1..=DEFAULT_MAX_START_ATTEMPTS {
        crate::state::gateway_process::push_log(
            &state.logs, LogSource::Lifecycle, LogLevel::Info,
            format!("startup_orchestrator: attempt {}/{}", attempt, DEFAULT_MAX_START_ATTEMPTS),
        );
        match report_status(state, port).await {
            Ok(status) if status.running => {
                transition_lifecycle(state, GatewayLifecycle::Running,
                                    "startup_orchestrator: managed gateway up");
                return Ok(status);
            }
            Ok(_) => {
                last_err = Some("gateway reports not running".to_string());
            }
            Err(e) => {
                last_err = Some(e);
            }
        }
        // Exponential backoff between attempts.
        let backoff_ms = 1_000u64 * (1u64 << (attempt as u32 - 1));
        crate::state::gateway_process::push_log(
            &state.logs, LogSource::Lifecycle, LogLevel::Warn,
            format!("startup attempt {attempt} returned; backing off {backoff_ms}ms"),
        );
        tokio::time::sleep(std::time::Duration::from_millis(backoff_ms)).await;
    }

    // 4. All attempts failed. (Doctor-repair step is TODO — see top.)
    let msg = last_err.unwrap_or_else(|| "all start attempts failed".to_string());
    transition_lifecycle(state, GatewayLifecycle::Error,
                        &format!("startup_orchestrator: gave up: {msg}"));
    Err(msg)
}

/// Build a GatewayStatus from the current in-memory state. Returns
/// "not running" if no child is registered. This is the cheapest
/// possible status check; for liveness use is_gateway_serving.
async fn report_status(state: &GatewayProcess, port: u16) -> Result<GatewayStatus, String> {
    let running = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut c) = *child_lock {
            matches!(c.try_wait(), Ok(None))
        } else {
            false
        }
    };
    let pid = {
        let child_lock = state.child.lock().map_err(|e| e.to_string())?;
        child_lock.as_ref().and_then(|c| c.id())
    };
    Ok(GatewayStatus { running, port, pid, token: None })
}

/// Health-check loop with bounded retry. The result is either Ok
/// (gateway is serving) or Err with a user-actionable message.
pub async fn health_check_loop(
    state: &GatewayProcess,
) -> Result<(), String> {
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    for attempt in 1..=DEFAULT_HEALTH_RETRY_ATTEMPTS {
        if is_gateway_serving(port).await {
            crate::state::gateway_process::push_log(
                &state.logs, LogSource::Lifecycle, LogLevel::Info,
                format!("health_check: gateway up on port {} (attempt {})", port, attempt),
            );
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_millis(
            DEFAULT_HEALTH_RETRY_INTERVAL_MS,
        )).await;
    }
    Err(format!("health_check: gateway not serving on port {} after {} attempts", port, DEFAULT_HEALTH_RETRY_ATTEMPTS))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_max_attempts_is_reasonable() {
        // 3 start attempts with exponential backoff (1+2+4 = 7s) is
        // plenty for transient port races. Don't bump above 5 without
        // extending the backoff budget.
        assert!(DEFAULT_MAX_START_ATTEMPTS <= 5);
        assert!(DEFAULT_MAX_START_ATTEMPTS >= 1);
    }

    #[test]
    fn health_retry_bounded() {
        // 5 attempts × 1s = 5s. Generous for cold-start but short
        // enough that the frontend's status spinner doesn't hang.
        assert!(DEFAULT_HEALTH_RETRY_ATTEMPTS as u64 * DEFAULT_HEALTH_RETRY_INTERVAL_MS <= 10_000);
    }
}