use crate::commands::{dingtalk_plugin::validated_target, docker, system};
use crate::paths::{self, OpenClawRuntimeMode};
use crate::state::RuntimeIdentityState;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
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
    kind: DwsOperationKind,
    success: bool,
    cancelled: bool,
    message: String,
    dws_path: Option<String>,
}

#[derive(Clone)]
enum DwsValidationTarget {
    Native { node: PathBuf, entry: PathBuf },
    Docker(PathBuf),
}

struct SelectedDwsCommand {
    command: Command,
    validation_target: DwsValidationTarget,
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

fn dws_package_entry_for_prefix(prefix: &Path) -> PathBuf {
    let modules = if cfg!(windows) {
        prefix.join("node_modules")
    } else {
        prefix.join("lib").join("node_modules")
    };
    modules.join(DWS_PACKAGE).join("bin").join("dws.js")
}

async fn native_runtime_paths() -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let requirement = system::installed_openclaw_node_requirement().await?;
    let runtime = system::NodeRuntimeContract::resolve(&requirement).await?;
    if !runtime.node().available || !runtime.npm().available {
        return Err("当前 OpenClaw Native 运行时没有可核验的 Node.js 与 npm 组合".to_string());
    }
    let node = runtime
        .node()
        .path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "当前 OpenClaw Native 运行时没有返回 Node.js 可执行路径".to_string())?;
    let npm = system::NpmExecutionContext::for_node(&node)?;
    let prefix = match paths::configured_npm_prefix() {
        Some(prefix) => prefix,
        None => system::npm_global_prefix_for_node(runtime.node())
            .await
            .ok_or_else(|| "当前 OpenClaw Native 运行时没有返回绝对 npm 全局前缀".to_string())?,
    };
    Ok((node, npm.npm_cli().to_path_buf(), prefix))
}

async fn native_command(kind: DwsOperationKind) -> Result<SelectedDwsCommand, String> {
    let (node, npm_cli, prefix) = native_runtime_paths().await?;
    let entry = dws_package_entry_for_prefix(&prefix);
    let search_path =
        system::search_path_with_executable_parent(&node, &system::openclaw_search_path());
    let mut command = match kind {
        DwsOperationKind::Install => {
            let mut command = Command::new(&node);
            command
                .arg(&npm_cli)
                .args(["install", "-g", DWS_PACKAGE, "--no-fund", "--no-audit"])
                .env("npm_config_prefix", &prefix);
            command
        }
        DwsOperationKind::Authorize => {
            if !entry.is_file() {
                return Err(format!(
                    "当前 OpenClaw Native 运行时没有 DWS 包入口：{}",
                    entry.display()
                ));
            }
            let mut command = Command::new(&node);
            command
                .arg(&entry)
                .args(["auth", "login", "--format", "json"]);
            command
        }
    };
    command.env("PATH", search_path);
    Ok(SelectedDwsCommand {
        command,
        validation_target: DwsValidationTarget::Native { node, entry },
    })
}

async fn selected_runtime_command(kind: DwsOperationKind) -> Result<SelectedDwsCommand, String> {
    if paths::active_runtime_mode() == OpenClawRuntimeMode::Native {
        return native_command(kind).await;
    }
    let docker_bin = docker::resolve_docker_bin().await?;
    let program = match kind {
        DwsOperationKind::Install => "npm",
        DwsOperationKind::Authorize => "dws",
    };
    let args: &[&str] = match kind {
        DwsOperationKind::Install => &["install", "-g", DWS_PACKAGE, "--no-fund", "--no-audit"],
        DwsOperationKind::Authorize => &["auth", "login", "--device", "--format", "json"],
    };
    let mut command = Command::new(&docker_bin);
    command
        .args(["exec", "-i", docker::OPENCLAW_CONTAINER_NAME, program])
        .args(args);
    Ok(SelectedDwsCommand {
        command,
        validation_target: DwsValidationTarget::Docker(docker_bin.into()),
    })
}

fn validation_command(target: &DwsValidationTarget, kind: DwsOperationKind) -> Command {
    let args: &[&str] = match kind {
        DwsOperationKind::Install => &["version", "--format", "json"],
        DwsOperationKind::Authorize => &["auth", "status", "--format", "json"],
    };
    match target {
        DwsValidationTarget::Native { node, entry } => {
            let mut command = Command::new(node);
            command
                .arg(entry)
                .args(args)
                .env("PATH", system::openclaw_search_path());
            command
        }
        DwsValidationTarget::Docker(docker_bin) => {
            let mut command = Command::new(docker_bin);
            command
                .args(["exec", "-i", docker::OPENCLAW_CONTAINER_NAME, "dws"])
                .args(args);
            command
        }
    }
}

fn validate_dws_runtime(
    target: &DwsValidationTarget,
    kind: DwsOperationKind,
) -> Result<Option<String>, String> {
    if let DwsValidationTarget::Native { entry, .. } = target {
        if !entry.is_file() {
            return Err(format!(
                "DWS 安装命令已结束，但当前运行时没有生成包入口：{}",
                entry.display()
            ));
        }
    }
    let output = validation_command(target, kind)
        .output()
        .map_err(|error| format!("无法执行 DWS 结构化核验：{error}"))?;
    if !output.status.success() {
        return Err("DWS 命令已结束，但当前运行时的结构化核验未通过".to_string());
    }
    if output.stdout.len() > OUTPUT_LINE_LIMIT {
        return Err("DWS 结构化核验输出超过安全上限".to_string());
    }
    validate_dws_json_output(&output.stdout)?;
    Ok(match target {
        DwsValidationTarget::Native { entry, .. } => Some(entry.to_string_lossy().into_owned()),
        DwsValidationTarget::Docker(_) => None,
    })
}

fn validate_dws_json_output(output: &[u8]) -> Result<(), String> {
    let payload: serde_json::Value = serde_json::from_slice(output)
        .map_err(|_| "DWS 结构化核验没有返回有效 JSON".to_string())?;
    if !payload.is_object()
        || payload.get("success").and_then(serde_json::Value::as_bool) == Some(false)
    {
        return Err("DWS 结构化核验返回失败状态".to_string());
    }
    Ok(())
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
    let selected = selected_runtime_command(kind).await?;
    let validation_target = selected.validation_target;
    let mut command = selected.command;
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
                    Some((status.success() && !cancelled, cancelled))
                }
                Ok(None) => None,
                Err(error) => {
                    active.take();
                    let _ = app.emit(
                        FINISHED_EVENT,
                        DwsOperationFinished {
                            operation_id: wait_operation_id.clone(),
                            kind,
                            success: false,
                            cancelled: false,
                            message: format!("无法等待 DWS 流程：{error}"),
                            dws_path: None,
                        },
                    );
                    return;
                }
            }
        };
        if let Some((command_succeeded, cancelled)) = outcome {
            let verification = if command_succeeded {
                validate_dws_runtime(&validation_target, kind)
            } else {
                Err(if cancelled {
                    "DWS 官方流程已取消".to_string()
                } else {
                    "DWS 官方流程未成功完成".to_string()
                })
            };
            let (success, message, dws_path) = match verification {
                Ok(dws_path) => (
                    true,
                    match kind {
                        DwsOperationKind::Install => "DWS 已安装并通过当前运行时核验".to_string(),
                        DwsOperationKind::Authorize => "DWS 授权已通过结构化状态核验".to_string(),
                    },
                    dws_path,
                ),
                Err(message) => (false, message, None),
            };
            let _ = app.emit(
                FINISHED_EVENT,
                DwsOperationFinished {
                    operation_id: wait_operation_id.clone(),
                    kind,
                    success,
                    cancelled,
                    message,
                    dws_path,
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
    use super::{dws_package_entry_for_prefix, redact_line, validate_dws_json_output, DWS_PACKAGE};

    #[test]
    fn dws_output_redacts_credential_material() {
        assert_eq!(
            redact_line("refresh_token=private".to_string()),
            "[已隐藏敏感输出]"
        );
    }

    #[test]
    fn native_dws_entry_uses_the_selected_npm_prefix() {
        let prefix = std::path::Path::new("selected-prefix");
        let expected = if cfg!(windows) {
            prefix
                .join("node_modules")
                .join(DWS_PACKAGE)
                .join("bin")
                .join("dws.js")
        } else {
            prefix
                .join("lib")
                .join("node_modules")
                .join(DWS_PACKAGE)
                .join("bin")
                .join("dws.js")
        };
        assert_eq!(dws_package_entry_for_prefix(prefix), expected);
    }

    #[test]
    fn dws_verification_requires_json_without_a_failure_status() {
        assert!(validate_dws_json_output(br#"{"success":true,"body":{}}"#).is_ok());
        assert!(validate_dws_json_output(br#"{"success":false}"#).is_err());
        assert!(validate_dws_json_output(b"not-json").is_err());
        assert!(validate_dws_json_output(br#"[]"#).is_err());
    }
}
