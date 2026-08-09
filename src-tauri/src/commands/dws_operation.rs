use crate::commands::{dingtalk_plugin::validated_target, docker, system};
use crate::paths::{self, OpenClawRuntimeMode};
use crate::state::RuntimeIdentityState;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const OUTPUT_EVENT: &str = "dws-operation-output";
const FINISHED_EVENT: &str = "dws-operation-finished";
const DWS_PACKAGE: &str = "dingtalk-workspace-cli";
const OUTPUT_LINE_LIMIT: usize = 4_096;

static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DwsOperationKind {
    Install,
    Authorize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DwsOperationStarted {
    pub operation_id: String,
    pub kind: DwsOperationKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DwsOperationOutput {
    operation_id: String,
    stream: &'static str,
    line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DwsOperationFinished {
    operation_id: String,
    success: bool,
    cancelled: bool,
    message: String,
}

struct ActiveOperation {
    operation_id: String,
    child: Child,
    cancelled: bool,
}

pub struct DwsOperationState {
    active: Arc<Mutex<Option<ActiveOperation>>>,
}

impl Default for DwsOperationState {
    fn default() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
        }
    }
}

fn operation_id() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!(
        "dws-{timestamp}-{}",
        OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

fn redact_line(value: String) -> String {
    let line = value.chars().take(OUTPUT_LINE_LIMIT).collect::<String>();
    let lower = line.to_ascii_lowercase();
    if [
        "access_token",
        "accesstoken",
        "refresh_token",
        "refreshtoken",
        "client_secret",
        "clientsecret",
        "device_code",
        "devicecode",
        "authorization:",
        "authorization=",
    ]
    .iter()
    .any(|key| lower.contains(key))
    {
        "[已隐藏敏感输出]".to_string()
    } else {
        line
    }
}

fn native_command(kind: DwsOperationKind) -> Command {
    let mut command = match kind {
        DwsOperationKind::Install => {
            let mut command = Command::new("npm");
            command.args(["install", "-g", DWS_PACKAGE, "--no-fund", "--no-audit"]);
            command
        }
        DwsOperationKind::Authorize => {
            let mut command = Command::new("dws");
            command.args(["auth", "login", "--device"]);
            command
        }
    };
    command.env("PATH", system::openclaw_search_path());
    command
}

async fn selected_runtime_command(kind: DwsOperationKind) -> Result<Command, String> {
    if paths::active_runtime_mode() == OpenClawRuntimeMode::Native {
        return Ok(native_command(kind));
    }
    let docker_bin = docker::resolve_docker_bin().await?;
    let program = match kind {
        DwsOperationKind::Install => "npm",
        DwsOperationKind::Authorize => "dws",
    };
    let args: &[&str] = match kind {
        DwsOperationKind::Install => &["install", "-g", DWS_PACKAGE, "--no-fund", "--no-audit"],
        DwsOperationKind::Authorize => &["auth", "login", "--device"],
    };
    let mut command = Command::new(docker_bin);
    command
        .args(["exec", "-i", docker::OPENCLAW_CONTAINER_NAME, program])
        .args(args);
    Ok(command)
}

fn emit_output(app: &AppHandle, operation_id: &str, stream: &'static str, line: String) {
    let _ = app.emit(
        OUTPUT_EVENT,
        DwsOperationOutput {
            operation_id: operation_id.to_string(),
            stream,
            line: redact_line(line),
        },
    );
}

fn spawn_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    operation_id: String,
    stream: &'static str,
    reader: R,
) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => {
                    emit_output(&app, &operation_id, stream, line)
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
pub async fn start_dws_operation(
    app: AppHandle,
    state: State<'_, RuntimeIdentityState>,
    operations: State<'_, DwsOperationState>,
    target_fingerprint: String,
    expected_connection_id: String,
    kind: DwsOperationKind,
) -> Result<DwsOperationStarted, String> {
    validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let mut command = selected_runtime_command(kind).await?;
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut active = operations
        .active
        .lock()
        .map_err(|_| "DWS 操作状态不可用".to_string())?;
    if active.is_some() {
        return Err("已有 DWS 安装或授权正在运行".to_string());
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 DWS 官方流程：{error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "DWS 标准输出不可用".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "DWS 标准错误输出不可用".to_string())?;
    let operation_id = operation_id();
    *active = Some(ActiveOperation {
        operation_id: operation_id.clone(),
        child,
        cancelled: false,
    });
    drop(active);
    spawn_reader(app.clone(), operation_id.clone(), "stdout", stdout);
    spawn_reader(app.clone(), operation_id.clone(), "stderr", stderr);
    let state_ref = Arc::clone(&operations.active);
    let wait_operation_id = operation_id.clone();
    std::thread::spawn(move || loop {
        let outcome = {
            let mut active = match state_ref.lock() {
                Ok(active) => active,
                Err(_) => return,
            };
            let Some(current) = active.as_mut() else {
                return;
            };
            if current.operation_id != wait_operation_id {
                return;
            }
            match current.child.try_wait() {
                Ok(Some(status)) => {
                    let cancelled = current.cancelled;
                    active.take();
                    Some((
                        status.success() && !cancelled,
                        cancelled,
                        if cancelled {
                            "DWS 官方流程已取消".to_string()
                        } else if status.success() {
                            "DWS 官方流程已完成".to_string()
                        } else {
                            "DWS 官方流程未成功完成".to_string()
                        },
                    ))
                }
                Ok(None) => None,
                Err(error) => {
                    active.take();
                    Some((false, false, format!("无法等待 DWS 流程：{error}")))
                }
            }
        };
        if let Some((success, cancelled, message)) = outcome {
            let _ = app.emit(
                FINISHED_EVENT,
                DwsOperationFinished {
                    operation_id: wait_operation_id.clone(),
                    success,
                    cancelled,
                    message,
                },
            );
            return;
        }
        std::thread::sleep(Duration::from_millis(120));
    });
    Ok(DwsOperationStarted { operation_id, kind })
}

#[tauri::command]
pub fn cancel_dws_operation(
    state: State<'_, RuntimeIdentityState>,
    operations: State<'_, DwsOperationState>,
    target_fingerprint: String,
    expected_connection_id: String,
    operation_id: String,
) -> Result<(), String> {
    validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let mut active = operations
        .active
        .lock()
        .map_err(|_| "DWS 操作状态不可用".to_string())?;
    let Some(current) = active.as_mut() else {
        return Ok(());
    };
    if current.operation_id != operation_id {
        return Err("DWS 操作身份不匹配".to_string());
    }
    current.cancelled = true;
    current
        .child
        .kill()
        .map_err(|error| format!("无法取消 DWS 流程：{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::redact_line;
    #[test]
    fn dws_output_redacts_credential_material() {
        assert_eq!(
            redact_line("refresh_token=private".to_string()),
            "[已隐藏敏感输出]"
        );
    }
}
