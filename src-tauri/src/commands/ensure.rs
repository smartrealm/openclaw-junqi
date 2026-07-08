//! Boot-time gateway orchestrator (SPEC §4.2, M7).
//!
//! Try managed child → check local gateway port → if failed, try docker container →
//! if no docker, try native spawn as last resort. Debounced so the UI
//! cannot trigger more than one fallback attempt per minute.
//!
//! This is the single entry point the frontend calls when it wants to
//! "guarantee the gateway is running". It is intentionally NOT a hot-path
//! function — callers should invoke it on boot, on user-triggered
//! reconnect, or after observing N consecutive gateway reachability failures.

use crate::commands::docker::{check_docker, docker_gateway_status, start_docker_gateway};
use crate::state::gateway_process::{push_log, LogLevel, LogSource};
use crate::state::GatewayProcess;
use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// Which deployment mode the orchestrator landed on.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GatewayMode {
    /// Our managed native child (or an existing user-owned native gateway).
    Native,
    /// Docker container (`maxauto-openclaw`).
    Docker,
    /// Nothing reachable.
    Unavailable,
}

/// Result of an `ensure_gateway_running` invocation.
#[derive(Debug, Serialize)]
pub struct EnsureResult {
    pub mode: GatewayMode,
    pub healthy: bool,
    pub port: u16,
    pub token: Option<String>,
    /// True if the orchestrator had to escalate (Native → Docker or vice
    /// versa) on this call. False on a clean success or a clean "still
    /// unavailable" outcome. UI uses this to decide whether to show a toast.
    pub attempted_fallback: bool,
    pub error: Option<String>,
}

/// Last-attempt timestamp for debouncing. 60s window — a misbehaving caller
/// cannot trigger more than one fallback per minute (SPEC invariant #5).
static LAST_ENSURE: Mutex<Option<Instant>> = Mutex::new(None);
const DEBOUNCE_WINDOW: Duration = Duration::from_secs(60);

/// Confirm a gateway endpoint on `port` is reachable.
async fn probe_gateway_port(port: u16) -> bool {
    crate::commands::gateway::is_gateway_serving(port).await
}

/// Read the gateway auth token from the configured config file.
fn read_gateway_token() -> Option<String> {
    use crate::paths;
    let raw = std::fs::read_to_string(&paths::config_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .map(|s| s.to_string())
}

/// Read the auth token used by the managed Docker gateway config.
fn read_docker_gateway_token() -> Option<String> {
    use crate::paths;
    let path = paths::desktop_dir().join("docker").join("openclaw.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .map(|s| s.to_string())
}

/// Read the configured gateway port from openclaw.json.
/// Defaults to 18789, matching OpenClaw's local gateway default.
fn read_gateway_port() -> u16 {
    use crate::paths;
    let raw = match std::fs::read_to_string(&paths::config_path()) {
        Ok(raw) => raw,
        Err(_) => return 18789,
    };
    let v: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return 18789,
    };
    v.get("gateway")
        .and_then(|g| g.get("port"))
        .and_then(|p| p.as_u64())
        .filter(|p| *p > 0 && *p < 65536)
        .map(|p| p as u16)
        .unwrap_or(18789)
}

/// Boot-time / on-demand orchestrator.
///
/// Algorithm (SPEC §4.2):
///   1. If the configured local gateway port is reachable → Native/healthy.
///   2. Else, check Docker: if container "maxauto-openclaw" exists, try to
///      start it and probe the gateway port for up to 30s.
///   3. Else, if Docker daemon is running AND the openclaw image is
///      available, spawn a container (delegates to `start_docker_gateway`).
///   4. Else, return Unavailable with a descriptive error.
///
/// Debounce: if called again within 60s, returns the cached previous result
/// without doing new work.
#[tauri::command]
pub async fn ensure_gateway_running(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<EnsureResult, String> {
    // Debounce: skip the heavy lifting if a recent attempt succeeded or
    // marked the system unavailable. The UI polls status every few seconds
    // and would otherwise spam this command.
    let debounced = {
        let last = LAST_ENSURE.lock().map_err(|e| e.to_string())?;
        last.map(|t| t.elapsed() < DEBOUNCE_WINDOW).unwrap_or(false)
    };
    if debounced {
        // Return a quick "still trying" without re-running the escalation
        // chain. Still do a cheap local health probe first.
        let configured_port = read_gateway_port();
        let state_port = *state.port.lock().map_err(|e| e.to_string())?;
        let port = if configured_port > 0 {
            configured_port
        } else {
            state_port
        };
        if probe_gateway_port(port).await {
            let token = read_gateway_token();
            return Ok(EnsureResult {
                mode: GatewayMode::Native,
                healthy: true,
                port,
                token,
                attempted_fallback: false,
                error: None,
            });
        }
        return Ok(EnsureResult {
            mode: GatewayMode::Unavailable,
            healthy: false,
            port,
            token: None,
            attempted_fallback: false,
            error: Some("debounced: recent ensure attempt in progress".to_string()),
        });
    }

    let port = read_gateway_port();
    *state.port.lock().map_err(|e| e.to_string())? = port;

    // 1. Is JunQi's configured native/local gateway already healthy?
    if probe_gateway_port(port).await {
        let token = read_gateway_token();
        *LAST_ENSURE.lock().map_err(|e| e.to_string())? = Some(Instant::now());
        push_log(
            &state.logs,
            LogSource::Lifecycle,
            LogLevel::Info,
            format!("ensure_gateway_running: native healthy on port {}", port),
        );
        return Ok(EnsureResult {
            mode: GatewayMode::Native,
            healthy: true,
            port,
            token,
            attempted_fallback: false,
            error: None,
        });
    }

    // 2. Is our managed child alive but not healthy yet?
    let managed_alive = {
        let mut child_lock = state.child.lock().map_err(|e| e.to_string())?;
        if let Some(ref mut child) = *child_lock {
            matches!(child.try_wait(), Ok(None))
        } else {
            false
        }
    };
    if managed_alive {
        push_log(&state.logs, LogSource::Lifecycle, LogLevel::Warn,
                 format!("ensure_gateway_running: managed native child alive but gateway port was not reachable on {}", port));
    }

    // 3/4. Docker fallback.
    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Warn,
        "ensure_gateway_running: native unhealthy, attempting Docker fallback",
    );
    match check_docker().await {
        Ok(ds) if ds.daemon_running => {
            // Container present? Try to start it.
            let present = docker_gateway_status(Some(port))
                .await
                .map(|s| s.running)
                .unwrap_or(false);
            let mut docker_token = read_docker_gateway_token();
            if !present {
                // Try to start the container from the official image.
                match start_docker_gateway(app.clone(), Some(port), None).await {
                    Ok(status) => {
                        docker_token = status.token.or_else(read_docker_gateway_token);
                    }
                    Err(e) => {
                        let err = format!("docker fallback failed: {}", e);
                        push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
                        *LAST_ENSURE.lock().map_err(|e| e.to_string())? = Some(Instant::now());
                        return Ok(EnsureResult {
                            mode: GatewayMode::Unavailable,
                            healthy: false,
                            port,
                            token: None,
                            attempted_fallback: true,
                            error: Some(err),
                        });
                    }
                }
            }
            // Wait for the gateway inside the container to come up.
            for _ in 0..30 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                if probe_gateway_port(port).await {
                    let token = docker_token.or_else(read_docker_gateway_token);
                    *LAST_ENSURE.lock().map_err(|e| e.to_string())? = Some(Instant::now());
                    push_log(
                        &state.logs,
                        LogSource::Lifecycle,
                        LogLevel::Info,
                        "ensure_gateway_running: docker fallback succeeded",
                    );
                    return Ok(EnsureResult {
                        mode: GatewayMode::Docker,
                        healthy: true,
                        port,
                        token,
                        attempted_fallback: true,
                        error: None,
                    });
                }
            }
            let err = "Docker container up but gateway port never became reachable within 30s"
                .to_string();
            push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
            *LAST_ENSURE.lock().map_err(|e| e.to_string())? = Some(Instant::now());
            return Ok(EnsureResult {
                mode: GatewayMode::Unavailable,
                healthy: false,
                port,
                token: None,
                attempted_fallback: true,
                error: Some(err),
            });
        }
        Ok(_) => {
            // Docker daemon not running or CLI missing.
            let err =
                "Docker unavailable — install Docker Desktop or run openclaw natively".to_string();
            push_log(&state.logs, LogSource::Lifecycle, LogLevel::Warn, &err);
            *LAST_ENSURE.lock().map_err(|e| e.to_string())? = Some(Instant::now());
            Ok(EnsureResult {
                mode: GatewayMode::Unavailable,
                healthy: false,
                port,
                token: None,
                attempted_fallback: false,
                error: Some(err),
            })
        }
        Err(e) => {
            let err = format!("Docker check failed: {}", e);
            push_log(&state.logs, LogSource::Lifecycle, LogLevel::Error, &err);
            *LAST_ENSURE.lock().map_err(|e| e.to_string())? = Some(Instant::now());
            Ok(EnsureResult {
                mode: GatewayMode::Unavailable,
                healthy: false,
                port,
                token: None,
                attempted_fallback: false,
                error: Some(err),
            })
        }
    }
}

// Pull `app` into the manager trait surface so `app.state::<GatewayProcess>()`
// can be called from any helper above that needs to look up state.
#[allow(dead_code)]
fn _state_lookup_helper(app: &AppHandle) -> State<'_, GatewayProcess> {
    app.state::<GatewayProcess>()
}
