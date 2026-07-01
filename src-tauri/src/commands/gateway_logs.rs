//! Gateway log IPC commands (SPEC §2.4, M6).
//!
//! Frontend-facing surface for the 200-entry circular log buffer maintained
//! in `GatewayProcess::logs`. The buffer is filled by:
//!   - `start_gateway` / `restart_local_gateway` capturing child stdout/stderr
//!   - Docker log streaming when `start_docker_gateway` runs
//!   - Synthetic lifecycle events emitted on start/stop/restart transitions
//!
//! The buffer is process-local — restarting the desktop app clears it. The
//! on-disk `~/.openclaw/openclaw.log` (if enabled) remains the authoritative
//! long-term log; this buffer is the last-N-entries "what just happened" view.

use crate::state::gateway_process::{LogEntry, GatewayProcess};
use tauri::State;

/// Return up to `limit` most-recent log entries, newest last.
/// If `limit == 0` returns everything currently buffered.
#[tauri::command]
pub async fn get_gateway_logs(
    state: State<'_, GatewayProcess>,
    limit: usize,
) -> Result<Vec<LogEntry>, String> {
    let buf = state.logs.lock().map_err(|e| e.to_string())?;
    let take = if limit == 0 || limit >= buf.len() {
        buf.len()
    } else {
        limit
    };
    // Return the tail (most recent) `take` entries, preserving order
    // (oldest of the returned slice first, newest last).
    let start = buf.len() - take;
    Ok(buf.iter().skip(start).cloned().collect())
}

/// Clear the log buffer. Used by the Settings → Storage "Clear logs" button.
#[tauri::command]
pub async fn clear_gateway_logs(state: State<'_, GatewayProcess>) -> Result<(), String> {
    let mut buf = state.logs.lock().map_err(|e| e.to_string())?;
    buf.clear();
    Ok(())
}