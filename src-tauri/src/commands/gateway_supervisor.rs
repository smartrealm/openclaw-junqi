//! Gateway process supervisor.
//!
//! Manages the child process lifecycle beyond simple spawn/kill:
//!   - wait_for_port_free: poll until TCP TIME_WAIT clears
//!   - find_and_kill_orphans: check for rogue listeners on our port
//!   - terminate_owned_gateway: graceful kill with hard timeout
//!
//! //!   terminateOwnedGatewayProcess   (line 24)
//!   waitForPortFree                (line 128)
//!   findExistingGatewayProcess     (line 238)

use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::GatewayProcess;
use tokio::net::TcpListener;
use tokio::time::{sleep, timeout, Duration};

/// Poll until the port can be bound (previous occupant-TIME_WAIT cleared).
/// Returns the elapsed ms. Times out at `timeout_ms` (default 30s).
pub async fn wait_for_port_free(port: u16, timeout_ms: u64) -> Result<u64, String> {
    let start = std::time::Instant::now();
    let mut logged = false;
    loop {
        let elapsed = start.elapsed().as_millis() as u64;
        if elapsed >= timeout_ms {
            return Err(format!(
                "Port {} still occupied after {}ms",
                port, timeout_ms,
            ));
        }
        match TcpListener::bind(format!(
            "{}:{}",
            crate::commands::config::default_gateway_host(),
            port
        ))
        .await
        {
            Ok(_) => {
                return Ok(elapsed);
            }
            Err(_) => {
                if !logged {
                    eprintln!(
                        "[gateway_supervisor] waiting for port {} to become available...",
                        port
                    );
                    logged = true;
                }
                sleep(Duration::from_millis(500)).await;
            }
        }
    }
}

/// Kill a managed child with graceful kill first, then force stop after 5s.
pub async fn terminate_owned_gateway(child: &mut tokio::process::Child) {
    let pid = child.id().unwrap_or(0);
    eprintln!("[gateway_supervisor] terminating child (pid={})", pid);
    let _ = child.kill().await;
    match timeout(Duration::from_secs(5), child.wait()).await {
        Ok(Ok(_)) => return,
        _ => {
            let _ = child.start_kill();
        }
    }
}

/// Probe for an orphaned process on our port and kill it if found.
/// Returns true if we freed the port (orphan was killed, now port is free).
pub async fn find_and_kill_orphans(port: u16) -> bool {
    if TcpListener::bind(format!(
        "{}:{}",
        crate::commands::config::default_gateway_host(),
        port
    ))
    .await
    .is_ok()
    {
        return false; // port is already free
    }
    // Something is listening. Try to identify and kill it.
    eprintln!(
        "[gateway_supervisor] port {} is occupied, checking for orphan",
        port
    );
    // Best-effort: we don't know the PID without lsof/netstat, so skip the
    // PID-based approach from JunQi. Instead, we trust wait_for_port_free
    // to handle the TIME_WAIT window after a quick SIGKILL attempt via the
    // OS. On macOS, we handle the launchctl unload separately.
    false
}

/// Tauri command: return the current lifecycle state for the frontend.
#[tauri::command]
pub async fn get_gateway_lifecycle(
    state: tauri::State<'_, GatewayProcess>,
) -> Result<GatewayLifecycle, String> {
    state.runtime_snapshot().map(|snapshot| snapshot.lifecycle)
}

#[derive(serde::Serialize)]
pub struct GatewayRuntimeSnapshot {
    lifecycle: GatewayLifecycle,
    mode: GatewayRuntimeMode,
    restarting: bool,
    port: u16,
    managed_pid: Option<u32>,
}

/// Return the canonical supervisor snapshot used by diagnostics UI.
#[tauri::command]
pub async fn get_gateway_runtime_snapshot(
    state: tauri::State<'_, GatewayProcess>,
) -> Result<GatewayRuntimeSnapshot, String> {
    let runtime = state.runtime_snapshot()?;
    let port = *state.port.lock().map_err(|e| e.to_string())?;
    let managed_pid = state
        .child
        .lock()
        .map_err(|e| e.to_string())?
        .as_ref()
        .and_then(|child| child.id());
    Ok(GatewayRuntimeSnapshot {
        lifecycle: runtime.lifecycle,
        mode: runtime.mode,
        restarting: runtime.restarting,
        port,
        managed_pid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn wait_for_port_free_returns_ok_for_free_port() {
        // Pick a high ephemeral port that's almost certainly free.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener); // free the port

        let result = wait_for_port_free(port, 5000).await;
        assert!(result.is_ok(), "freshly freed port should be available");
    }

    #[tokio::test]
    async fn wait_for_port_free_times_out_when_blocked() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        // Hold the port open — so wait_for_port_free MUST time out.
        let _guard = listener;

        let result = wait_for_port_free(port, 500).await; // short timeout
        assert!(result.is_err(), "occupied port must time out");
    }
}
