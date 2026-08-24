use crate::commands::{dingtalk_plugin::validated_target, docker, system};
use crate::paths::{self, OpenClawRuntimeMode};
use crate::state::RuntimeIdentityState;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

const OUTPUT_EVENT: &str = "dws-operation-output";
const FINISHED_EVENT: &str = "dws-operation-finished";
const DWS_PACKAGE: &str = "dingtalk-workspace-cli";
const OUTPUT_LINE_LIMIT: usize = 4_096;
const WAIT_STATUS_INTERVAL: Duration = Duration::from_secs(15);

static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DwsOperationKind {
    Install,
    Authorize,
    ResetAuth,
    SwitchProfile,
    LogoutProfile,
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

fn dws_operation_args(
    kind: DwsOperationKind,
    device_authorization: bool,
) -> Result<Vec<String>, String> {
    match kind {
        DwsOperationKind::Install => Err("DWS 安装不使用 DWS 命令参数".to_string()),
        DwsOperationKind::Authorize if device_authorization => {
            Ok(["auth", "login", "--device", "--format", "json"]
                .into_iter()
                .map(str::to_string)
                .collect())
        }
        DwsOperationKind::Authorize => Ok(["auth", "login", "--format", "json"]
            .into_iter()
            .map(str::to_string)
            .collect()),
        DwsOperationKind::ResetAuth => Ok(["auth", "reset", "--format", "json", "--yes"]
            .into_iter()
            .map(str::to_string)
            .collect()),
        DwsOperationKind::SwitchProfile | DwsOperationKind::LogoutProfile => {
            Err("DWS Profile 操作缺少精确身份".to_string())
        }
    }
}

fn dws_profile_operation_args(
    kind: DwsOperationKind,
    profile: &str,
) -> Result<Vec<String>, String> {
    match kind {
        DwsOperationKind::SwitchProfile => Ok(vec![
            "profile".to_string(),
            "switch".to_string(),
            profile.to_string(),
            "--format".to_string(),
            "json".to_string(),
        ]),
        DwsOperationKind::LogoutProfile => Ok(vec![
            "auth".to_string(),
            "logout".to_string(),
            "--profile".to_string(),
            profile.to_string(),
        ]),
        _ => Err("当前 DWS 操作不接受 Profile 参数".to_string()),
    }
}

fn normalize_operation_profile(
    kind: DwsOperationKind,
    profile: Option<String>,
) -> Result<Option<String>, String> {
    let normalized = profile.map(|value| value.trim().to_string());
    if matches!(
        kind,
        DwsOperationKind::SwitchProfile | DwsOperationKind::LogoutProfile
    ) {
        let value = normalized
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "DWS Profile 操作需要精确的 corpId:userId 身份".to_string())?;
        let parts = value.split(':').collect::<Vec<_>>();
        if parts.len() != 2
            || parts
                .iter()
                .any(|part| part.is_empty() || part.chars().any(char::is_whitespace))
        {
            return Err("DWS Profile 必须使用精确的 corpId:userId 格式".to_string());
        }
        return Ok(Some(value));
    }
    if normalized.as_deref().is_some_and(|value| !value.is_empty()) {
        return Err("当前 DWS 操作不接受 Profile 参数".to_string());
    }
    Ok(None)
}

fn operation_requires_validation(kind: DwsOperationKind) -> bool {
    !matches!(kind, DwsOperationKind::ResetAuth)
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

async fn native_command(
    kind: DwsOperationKind,
    profile: Option<&str>,
) -> Result<SelectedDwsCommand, String> {
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
        DwsOperationKind::Authorize
        | DwsOperationKind::ResetAuth
        | DwsOperationKind::SwitchProfile
        | DwsOperationKind::LogoutProfile => {
            if !entry.is_file() {
                return Err(format!(
                    "当前 OpenClaw Native 运行时没有 DWS 包入口：{}",
                    entry.display()
                ));
            }
            let mut command = Command::new(&node);
            let args = if let Some(profile) = profile {
                dws_profile_operation_args(kind, profile)?
            } else {
                dws_operation_args(kind, false)?
            };
            command.arg(&entry).args(args);
            command
        }
    };
    command.env("PATH", search_path);
    Ok(SelectedDwsCommand {
        command,
        validation_target: DwsValidationTarget::Native { node, entry },
    })
}

async fn selected_runtime_command(
    kind: DwsOperationKind,
    profile: Option<&str>,
) -> Result<SelectedDwsCommand, String> {
    if paths::active_runtime_mode() == OpenClawRuntimeMode::Native {
        return native_command(kind, profile).await;
    }
    let docker_bin = docker::resolve_docker_bin().await?;
    let program = match kind {
        DwsOperationKind::Install => "npm",
        DwsOperationKind::Authorize
        | DwsOperationKind::ResetAuth
        | DwsOperationKind::SwitchProfile
        | DwsOperationKind::LogoutProfile => "dws",
    };
    let args = match kind {
        DwsOperationKind::Install => ["install", "-g", DWS_PACKAGE, "--no-fund", "--no-audit"]
            .into_iter()
            .map(str::to_string)
            .collect(),
        DwsOperationKind::Authorize | DwsOperationKind::ResetAuth => {
            dws_operation_args(kind, true)?
        }
        DwsOperationKind::SwitchProfile | DwsOperationKind::LogoutProfile => {
            dws_profile_operation_args(
                kind,
                profile.ok_or_else(|| "DWS Profile 操作缺少精确身份".to_string())?,
            )?
        }
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

fn validation_command(
    target: &DwsValidationTarget,
    kind: DwsOperationKind,
) -> Result<Command, String> {
    let args: &[&str] = match kind {
        DwsOperationKind::Install => &["version", "--format", "json"],
        DwsOperationKind::Authorize => &["auth", "status", "--format", "json"],
        DwsOperationKind::SwitchProfile | DwsOperationKind::LogoutProfile => {
            &["profile", "list", "--format", "json"]
        }
        DwsOperationKind::ResetAuth => {
            return Err("DWS 登录态重置没有登录状态核验命令".to_string());
        }
    };
    Ok(match target {
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
    })
}

fn validate_dws_runtime(
    target: &DwsValidationTarget,
    kind: DwsOperationKind,
    profile: Option<&str>,
) -> Result<Option<String>, String> {
    if !operation_requires_validation(kind) {
        return Err("DWS 登录态重置不能使用登录状态核验".to_string());
    }
    if let DwsValidationTarget::Native { entry, .. } = target {
        if !entry.is_file() {
            return Err(format!(
                "DWS 安装命令已结束，但当前运行时没有生成包入口：{}",
                entry.display()
            ));
        }
    }
    let output = validation_command(target, kind)?
        .output()
        .map_err(|error| format!("无法执行 DWS 结构化核验：{error}"))?;
    if !output.status.success() {
        return Err("DWS 命令已结束，但当前运行时的结构化核验未通过".to_string());
    }
    if output.stdout.len() > OUTPUT_LINE_LIMIT {
        return Err("DWS 结构化核验输出超过安全上限".to_string());
    }
    validate_dws_json_output(&output.stdout, kind, profile)?;
    Ok(match (kind, target) {
        (DwsOperationKind::Install, DwsValidationTarget::Native { entry, .. }) => {
            Some(entry.to_string_lossy().into_owned())
        }
        _ => None,
    })
}

fn validate_dws_json_output(
    output: &[u8],
    kind: DwsOperationKind,
    profile: Option<&str>,
) -> Result<(), String> {
    let payload: serde_json::Value = serde_json::from_slice(output)
        .map_err(|_| "DWS 结构化核验没有返回有效 JSON".to_string())?;
    if !payload.is_object() {
        return Err("DWS 结构化核验没有返回对象".to_string());
    }
    if matches!(kind, DwsOperationKind::Install) {
        let version = payload
            .get("version")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if version.is_none() {
            return Err("DWS 版本核验没有返回有效版本".to_string());
        }
        return Ok(());
    }
    if payload.get("success").and_then(serde_json::Value::as_bool) != Some(true) {
        return Err("DWS 结构化核验返回失败状态".to_string());
    }
    match kind {
        DwsOperationKind::Authorize => {
            if payload
                .get("authenticated")
                .and_then(serde_json::Value::as_bool)
                != Some(true)
            {
                return Err("DWS 授权核验未确认当前 Profile 已登录".to_string());
            }
        }
        DwsOperationKind::SwitchProfile => {
            let expected = profile.ok_or_else(|| "DWS Profile 切换核验缺少精确身份".to_string())?;
            if payload
                .get("currentProfile")
                .and_then(serde_json::Value::as_str)
                != Some(expected)
            {
                return Err("DWS Profile 切换后未返回目标当前身份".to_string());
            }
        }
        DwsOperationKind::LogoutProfile => {
            let expected = profile.ok_or_else(|| "DWS Profile 退出核验缺少精确身份".to_string())?;
            let profiles = payload
                .get("profiles")
                .and_then(serde_json::Value::as_array)
                .ok_or_else(|| "DWS Profile 退出核验缺少账号列表".to_string())?;
            if profiles.iter().any(|item| {
                item.get("profile").and_then(serde_json::Value::as_str) == Some(expected)
            }) {
                return Err("DWS Profile 退出后目标账号仍存在".to_string());
            }
        }
        DwsOperationKind::Install | DwsOperationKind::ResetAuth => {}
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

fn operation_started_message(kind: DwsOperationKind) -> &'static str {
    match kind {
        DwsOperationKind::Install => "DWS 安装命令已启动，正在等待 npm 完成。",
        DwsOperationKind::Authorize => "DWS 授权命令已启动，正在等待官方授权流程输出。",
        DwsOperationKind::ResetAuth => "DWS 登录态重置命令已启动，正在等待官方流程完成。",
        DwsOperationKind::SwitchProfile => "DWS Profile 切换命令已启动，正在等待官方流程完成。",
        DwsOperationKind::LogoutProfile => "DWS 单账号退出命令已启动，正在等待官方流程完成。",
    }
}

fn operation_waiting_message(kind: DwsOperationKind, elapsed: Duration) -> String {
    let seconds = elapsed.as_secs();
    match kind {
        DwsOperationKind::Install => {
            format!("DWS 安装仍在运行，正在等待 npm 完成（已等待 {seconds} 秒）。")
        }
        DwsOperationKind::Authorize => {
            format!("DWS 授权仍在运行，正在等待官方授权流程完成（已等待 {seconds} 秒）。")
        }
        DwsOperationKind::ResetAuth => {
            format!("DWS 登录态重置仍在运行，正在等待官方流程完成（已等待 {seconds} 秒）。")
        }
        DwsOperationKind::SwitchProfile => {
            format!("DWS Profile 切换仍在运行，正在等待官方流程完成（已等待 {seconds} 秒）。")
        }
        DwsOperationKind::LogoutProfile => {
            format!("DWS 单账号退出仍在运行，正在等待官方流程完成（已等待 {seconds} 秒）。")
        }
    }
}

fn spawn_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    operation_id: String,
    stream: &'static str,
    reader: R,
) -> std::thread::JoinHandle<()> {
    spawn_line_reader(reader, move |line| {
        emit_output(&app, &operation_id, stream, line);
    })
}

fn spawn_line_reader<R, F>(reader: R, mut on_line: F) -> std::thread::JoinHandle<()>
where
    R: std::io::Read + Send + 'static,
    F: FnMut(String) + Send + 'static,
{
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => on_line(line),
                Ok(_) => {}
                Err(_) => break,
            }
        }
    })
}

fn join_output_readers(readers: Vec<std::thread::JoinHandle<()>>) -> Result<(), String> {
    for reader in readers {
        reader
            .join()
            .map_err(|_| "DWS 输出读取线程异常结束".to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn start_dws_operation(
    app: AppHandle,
    state: State<'_, RuntimeIdentityState>,
    operations: State<'_, DwsOperationState>,
    target_fingerprint: String,
    expected_connection_id: String,
    kind: DwsOperationKind,
    profile: Option<String>,
) -> Result<DwsOperationStarted, String> {
    validated_target(&state, &target_fingerprint, &expected_connection_id)?;
    let profile = normalize_operation_profile(kind, profile)?;
    let selected = selected_runtime_command(kind, profile.as_deref()).await?;
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
        return Err("已有 DWS 操作正在运行".to_string());
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
    emit_output(
        &app,
        &operation_id,
        "status",
        operation_started_message(kind).to_string(),
    );
    let stdout_reader = spawn_reader(app.clone(), operation_id.clone(), "stdout", stdout);
    let stderr_reader = spawn_reader(app.clone(), operation_id.clone(), "stderr", stderr);
    let state_ref = Arc::clone(&operations.active);
    let wait_operation_id = operation_id.clone();
    let operation_started_at = Instant::now();
    std::thread::spawn(move || {
        let mut output_readers = Some(vec![stdout_reader, stderr_reader]);
        let mut last_wait_status_at = Duration::ZERO;
        loop {
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
                        Some((status.success() && !cancelled, cancelled, None))
                    }
                    Ok(None) => None,
                    Err(error) => {
                        let _ = current.child.kill();
                        active.take();
                        Some((false, false, Some(format!("无法等待 DWS 流程：{error}"))))
                    }
                }
            };
            if let Some((command_succeeded, cancelled, wait_error)) = outcome {
                if let Err(message) = join_output_readers(output_readers.take().unwrap_or_default())
                {
                    let _ = app.emit(
                        FINISHED_EVENT,
                        DwsOperationFinished {
                            operation_id: wait_operation_id.clone(),
                            kind,
                            success: false,
                            cancelled,
                            message,
                            dws_path: None,
                        },
                    );
                    return;
                }
                if let Some(message) = wait_error {
                    let _ = app.emit(
                        FINISHED_EVENT,
                        DwsOperationFinished {
                            operation_id: wait_operation_id.clone(),
                            kind,
                            success: false,
                            cancelled: false,
                            message,
                            dws_path: None,
                        },
                    );
                    return;
                }
                if command_succeeded {
                    let status = if operation_requires_validation(kind) {
                        "DWS 命令已结束，正在核验当前运行时。"
                    } else {
                        "DWS 官方登录态重置命令已结束。"
                    };
                    emit_output(&app, &wait_operation_id, "status", status.to_string());
                }
                let verification = if command_succeeded {
                    if operation_requires_validation(kind) {
                        validate_dws_runtime(&validation_target, kind, profile.as_deref())
                    } else {
                        Ok(None)
                    }
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
                            DwsOperationKind::Install => {
                                "DWS 已安装并通过当前运行时核验".to_string()
                            }
                            DwsOperationKind::Authorize => {
                                "DWS 授权已通过结构化状态核验".to_string()
                            }
                            DwsOperationKind::ResetAuth => {
                                "DWS 官方登录态重置命令已完成".to_string()
                            }
                            DwsOperationKind::SwitchProfile => {
                                "DWS 当前 Profile 已切换并通过结构化核验".to_string()
                            }
                            DwsOperationKind::LogoutProfile => {
                                "DWS 目标 Profile 已退出并通过结构化核验".to_string()
                            }
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
            let elapsed = operation_started_at.elapsed();
            if elapsed >= WAIT_STATUS_INTERVAL
                && elapsed.saturating_sub(last_wait_status_at) >= WAIT_STATUS_INTERVAL
            {
                emit_output(
                    &app,
                    &wait_operation_id,
                    "status",
                    operation_waiting_message(kind, elapsed),
                );
                last_wait_status_at = elapsed;
            }
            std::thread::sleep(Duration::from_millis(120));
        }
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
    use super::{
        dws_operation_args, dws_package_entry_for_prefix, dws_profile_operation_args,
        join_output_readers, normalize_operation_profile, operation_requires_validation,
        operation_started_message, operation_waiting_message, redact_line, spawn_line_reader,
        validate_dws_json_output, DwsOperationKind, DWS_PACKAGE,
    };
    use std::io::Cursor;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

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
    fn dws_version_verification_uses_the_official_version_payload() {
        assert!(validate_dws_json_output(
            br#"{"version":"0.1.0","edition":"open","architecture":"MCP Static Endpoint Mode","go":"1.24+"}"#,
            DwsOperationKind::Install,
            None
        )
        .is_ok());
        assert!(validate_dws_json_output(
            br#"{"success":true,"body":{}}"#,
            DwsOperationKind::Install,
            None
        )
        .is_err());
        assert!(validate_dws_json_output(br#"{}"#, DwsOperationKind::Install, None).is_err());
        assert!(validate_dws_json_output(b"not-json", DwsOperationKind::Install, None).is_err());
        assert!(validate_dws_json_output(br#"[]"#, DwsOperationKind::Install, None).is_err());
    }

    #[test]
    fn dws_operation_reports_started_and_waiting_states_without_npm_output() {
        assert!(operation_started_message(DwsOperationKind::Install).contains("npm"));
        assert!(
            operation_waiting_message(DwsOperationKind::Install, Duration::from_secs(15))
                .contains("15")
        );
        assert!(operation_started_message(DwsOperationKind::Authorize).contains("授权"));
        assert!(operation_started_message(DwsOperationKind::ResetAuth).contains("重置"));
        assert!(
            operation_waiting_message(DwsOperationKind::ResetAuth, Duration::from_secs(15))
                .contains("15")
        );
    }

    #[test]
    fn dws_output_readers_are_drained_before_terminal_processing() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let stdout_lines = Arc::clone(&lines);
        let stderr_lines = Arc::clone(&lines);
        let stdout = spawn_line_reader(Cursor::new("stdout-final\n"), move |line| {
            stdout_lines.lock().unwrap().push(line);
        });
        let stderr = spawn_line_reader(Cursor::new("stderr-final\n"), move |line| {
            stderr_lines.lock().unwrap().push(line);
        });

        join_output_readers(vec![stdout, stderr]).unwrap();

        let mut captured = lines.lock().unwrap().clone();
        captured.sort();
        assert_eq!(captured, ["stderr-final", "stdout-final"]);
    }

    #[test]
    fn dws_auth_reset_uses_the_official_destructive_command_without_login_validation() {
        assert_eq!(
            dws_operation_args(DwsOperationKind::ResetAuth, false).unwrap(),
            ["auth", "reset", "--format", "json", "--yes"]
        );
        assert!(!operation_requires_validation(DwsOperationKind::ResetAuth));
    }

    #[test]
    fn dws_authorization_requires_an_authenticated_status() {
        assert!(validate_dws_json_output(
            br#"{"success":true,"authenticated":true}"#,
            DwsOperationKind::Authorize,
            None
        )
        .is_ok());
        assert!(validate_dws_json_output(
            br#"{"success":true,"authenticated":false}"#,
            DwsOperationKind::Authorize,
            None
        )
        .is_err());
    }

    #[test]
    fn dws_profile_operations_use_exact_identity_and_verify_terminal_state() {
        assert_eq!(
            normalize_operation_profile(
                DwsOperationKind::SwitchProfile,
                Some("corp-a:user-a".to_string())
            )
            .unwrap(),
            Some("corp-a:user-a".to_string())
        );
        assert!(normalize_operation_profile(
            DwsOperationKind::LogoutProfile,
            Some("corp-only".to_string())
        )
        .is_err());
        assert_eq!(
            dws_profile_operation_args(DwsOperationKind::SwitchProfile, "corp-a:user-a").unwrap(),
            ["profile", "switch", "corp-a:user-a", "--format", "json"]
        );
        assert_eq!(
            dws_profile_operation_args(DwsOperationKind::LogoutProfile, "corp-a:user-a").unwrap(),
            ["auth", "logout", "--profile", "corp-a:user-a"]
        );
        assert!(validate_dws_json_output(
            br#"{"success":true,"currentProfile":"corp-a:user-a","profiles":[]}"#,
            DwsOperationKind::SwitchProfile,
            Some("corp-a:user-a")
        )
        .is_ok());
        assert!(validate_dws_json_output(
            br#"{"success":true,"profiles":[{"profile":"corp-b:user-b"}]}"#,
            DwsOperationKind::LogoutProfile,
            Some("corp-a:user-a")
        )
        .is_ok());
        assert!(validate_dws_json_output(
            br#"{"success":true,"profiles":[{"profile":"corp-a:user-a"}]}"#,
            DwsOperationKind::LogoutProfile,
            Some("corp-a:user-a")
        )
        .is_err());
    }
}
