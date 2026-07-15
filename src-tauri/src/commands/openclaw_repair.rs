use crate::commands::diagnostic_output::sanitize_diagnostic_line;
use crate::commands::process_control::terminate_process_tree;
use crate::commands::setup_progress::emit;
use crate::state::gateway_process::{push_log, LogLevel, LogSource};
use crate::state::GatewayProcess;
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};

const REPAIR_TIMEOUT: Duration = Duration::from_secs(360);
const REPAIR_TAIL_CAPACITY: usize = 40;
const REPAIR_ARGS: &[&str] = &[
    "update",
    "repair",
    "--yes",
    "--timeout",
    "300",
    "--no-restart",
];

fn append_tail(tail: &Mutex<VecDeque<String>>, line: String) {
    if let Ok(mut tail) = tail.lock() {
        if tail.len() >= REPAIR_TAIL_CAPACITY {
            tail.pop_front();
        }
        tail.push_back(line);
    }
}

async fn stream_repair_output<R>(
    reader: R,
    app: AppHandle,
    tail: Arc<Mutex<VecDeque<String>>>,
    source: LogSource,
    level: LogLevel,
) where
    R: AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = sanitize_diagnostic_line(&line);
        if line.is_empty() {
            continue;
        }
        append_tail(&tail, line.clone());
        push_log(
            &app.state::<GatewayProcess>().logs,
            source,
            level,
            format!("[repair] {line}"),
        );
        emit(&app, "gateway", &format!("[repair] {line}"), 0.5);
    }
}

pub async fn run_openclaw_repair(app: AppHandle, state: &GatewayProcess) -> Result<(), String> {
    let gateway_gate = state.operation_gate.clone();
    let _gateway_guard = gateway_gate
        .try_lock_owned()
        .map_err(|_| "Gateway 正在执行其他操作，请稍后再试".to_string())?;
    let _maintenance_guard = crate::commands::maintenance::acquire_operation_guard().await;

    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Info,
        "OpenClaw official repair started",
    );
    emit(
        &app,
        "gateway",
        "Starting OpenClaw official repair...",
        0.08,
    );

    let binary = crate::commands::gateway::resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw binary not found; cannot run repair".to_string())?;
    let mut command = crate::commands::system::openclaw_command(&binary);
    command
        .args(REPAIR_ARGS)
        .env("PATH", crate::commands::system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", crate::paths::desktop_dir())
        .env("OPENCLAW_CONFIG_PATH", crate::paths::config_path())
        .env("OPENCLAW_NO_RESPAWN", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::platform::configure_background_command(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start OpenClaw repair: {error}"))?;
    let pid = child.id();
    let tail = Arc::new(Mutex::new(VecDeque::with_capacity(REPAIR_TAIL_CAPACITY)));
    let stdout_task = child.stdout.take().map(|stdout| {
        tokio::spawn(stream_repair_output(
            stdout,
            app.clone(),
            tail.clone(),
            LogSource::ChildStdout,
            LogLevel::Info,
        ))
    });
    let stderr_task = child.stderr.take().map(|stderr| {
        tokio::spawn(stream_repair_output(
            stderr,
            app.clone(),
            tail.clone(),
            LogSource::ChildStderr,
            LogLevel::Warn,
        ))
    });

    let status = match tokio::time::timeout(REPAIR_TIMEOUT, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            terminate_process_tree(&mut child, pid).await;
            return Err(format!("Failed while waiting for OpenClaw repair: {error}"));
        }
        Err(_) => {
            terminate_process_tree(&mut child, pid).await;
            return Err("OpenClaw repair timed out after 360 seconds".to_string());
        }
    };
    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    if !status.success() {
        let diagnostic = tail
            .lock()
            .map(|tail| tail.iter().rev().take(8).cloned().collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(if diagnostic.is_empty() {
            format!("OpenClaw repair exited with {status}")
        } else {
            format!("OpenClaw repair exited with {status}\n{diagnostic}")
        });
    }

    push_log(
        &state.logs,
        LogSource::Lifecycle,
        LogLevel::Info,
        "OpenClaw official repair completed",
    );
    emit(&app, "gateway", "OpenClaw repair completed", 1.0);
    Ok(())
}

#[tauri::command]
pub async fn repair_openclaw(
    app: AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<bool, String> {
    run_openclaw_repair(app, &state).await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_repair_includes_plugin_convergence_and_no_restart() {
        assert_eq!(REPAIR_ARGS[0..2], ["update", "repair"]);
        assert!(REPAIR_ARGS.contains(&"--no-restart"));
        assert!(REPAIR_ARGS.contains(&"300"));
    }

    #[test]
    fn diagnostic_tail_is_bounded() {
        let tail = Mutex::new(VecDeque::new());
        for index in 0..100 {
            append_tail(&tail, index.to_string());
        }
        let tail = tail.lock().unwrap();
        assert_eq!(tail.len(), REPAIR_TAIL_CAPACITY);
        assert_eq!(tail.front().map(String::as_str), Some("60"));
    }
}
