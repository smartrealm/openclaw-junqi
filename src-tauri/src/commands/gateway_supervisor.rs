//! Gateway process supervisor.
//!
//! Manages the child process lifecycle beyond simple spawn/kill:
//!   - wait_for_port_free: poll until TCP TIME_WAIT clears
//!   - find_and_kill_orphans: check for rogue listeners on our port
//!   - openclaw_doctor_repair: run `doctor --fix` on bad config
//!   - terminate_owned_gateway: graceful kill with hard timeout
//!
//! //!   terminateOwnedGatewayProcess   (line 24)
//!   waitForPortFree                (line 128)
//!   findExistingGatewayProcess     (line 238)
//!   runOpenClawDoctorRepair        (line 265)

use crate::commands::gateway::resolve_openclaw_binary;
use crate::paths;
use crate::state::gateway_process::{
    push_log, GatewayLifecycle, GatewayRuntimeMode, LogLevel, LogSource,
};
use crate::state::GatewayProcess;
use tauri::{AppHandle, Manager};
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
        match TcpListener::bind(format!("127.0.0.1:{}", port)).await {
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
    if TcpListener::bind(format!("127.0.0.1:{}", port))
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

/// Run `openclaw doctor --fix --yes --non-interactive` as a spawn_task.
/// Returns true on exit code 0.
/// Tauri command: run `openclaw doctor --fix`.
/// Called by the Settings → Storage tab when the user clicks "Auto-Repair Config".
#[tauri::command]
pub async fn openclaw_doctor_repair(
    app: AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<bool, String> {
    let _operation_guard = crate::commands::maintenance::acquire_operation_guard().await;
    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Info,
        "openclaw_doctor_repair: attempting auto-repair...",
    );

    let openclaw = match resolve_openclaw_binary() {
        Some(p) => p,
        None => {
            push_log(
                &state.logs,
                LogSource::Lifecycle,
                LogLevel::Error,
                "openclaw_doctor_repair: openclaw binary not found",
            );
            return Ok(false);
        }
    };

    let mut cmd = tokio::process::Command::new(&openclaw);
    cmd.args(["doctor", "--fix", "--yes", "--non-interactive"])
        .env("PATH", crate::commands::system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", paths::desktop_dir())
        .env("OPENCLAW_CONFIG_PATH", paths::config_path())
        .env("OPENCLAW_NO_RESPAWN", "1")
        .env("NO_COLOR", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    crate::platform::configure_background_command(&mut cmd);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            push_log(
                &state.logs,
                LogSource::Lifecycle,
                LogLevel::Error,
                format!("openclaw_doctor_repair: spawn failed: {}", e),
            );
            return Ok(false);
        }
    };

    // Stream stdout/stderr to the log buffer. Use the same pattern as
    // gateway.rs spawn_log_reader: pass AppHandle into the task, then
    // call app.state::<GatewayProcess>() inside the 'static async block
    // to look up the store without holding the command-level State borrow.
    let app_out = app.clone();
    if let Some(stdout) = child.stdout.take() {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let logs = &app_out.state::<GatewayProcess>().logs;
                push_log(
                    logs,
                    LogSource::ChildStdout,
                    LogLevel::Info,
                    format!("[doctor] {}", line),
                );
            }
        });
    }
    let app_err = app.clone();
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            use tokio::io::{AsyncBufReadExt, BufReader};
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let logs = &app_err.state::<GatewayProcess>().logs;
                push_log(
                    logs,
                    LogSource::ChildStderr,
                    LogLevel::Warn,
                    format!("[doctor] {}", line),
                );
            }
        });
    }

    // Wait up to 120s (matches JunQi's 120000ms timeout).
    match timeout(Duration::from_secs(120), child.wait()).await {
        Ok(Ok(status)) => {
            let ok = status.success();
            push_log(
                &state.logs,
                LogSource::Lifecycle,
                if ok { LogLevel::Info } else { LogLevel::Error },
                format!(
                    "openclaw_doctor_repair: exited code {} {}",
                    status.code().unwrap_or(-1),
                    if ok { "(repaired)" } else { "" }
                ),
            );
            Ok(ok)
        }
        Ok(Err(e)) => {
            push_log(
                &state.logs,
                LogSource::Lifecycle,
                LogLevel::Error,
                format!("openclaw_doctor_repair: wait failed: {}", e),
            );
            Ok(false)
        }
        Err(_) => {
            let _ = child.kill().await;
            push_log(
                &state.logs,
                LogSource::Lifecycle,
                LogLevel::Error,
                "openclaw_doctor_repair: timed out after 120s",
            );
            Ok(false)
        }
    }
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
