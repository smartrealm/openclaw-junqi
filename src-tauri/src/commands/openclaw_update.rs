use crate::commands::{gateway, system};
use crate::paths;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::GatewayProcess;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::process::{Output, Stdio};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::sync::Mutex;

const STATUS_TIMEOUT: Duration = Duration::from_secs(30);
const UPDATE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const UPDATE_BUSY_ERROR: &str = "An OpenClaw update operation is already running";

static UPDATE_OPERATION: OnceLock<Mutex<()>> = OnceLock::new();

fn update_operation() -> &'static Mutex<()> {
    UPDATE_OPERATION.get_or_init(|| Mutex::new(()))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenclawUpdateStatus {
    pub current_version: Option<String>,
    pub latest_version: Option<String>,
    pub available: bool,
    pub has_git_update: bool,
    pub has_registry_update: bool,
    pub git_behind: Option<i64>,
    pub channel: Option<String>,
    pub channel_label: Option<String>,
    pub install_kind: Option<String>,
    pub package_manager: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenclawUpdateResult {
    pub success: bool,
    pub status: String,
    pub mode: Option<String>,
    pub reason: Option<String>,
    pub before_version: Option<String>,
    pub after_version: Option<String>,
    pub gateway_restarted: bool,
    pub gateway_error: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusEnvelope {
    #[serde(default)]
    update: RawUpdateStatus,
    #[serde(default)]
    channel: RawChannel,
    #[serde(default)]
    availability: RawAvailability,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawUpdateStatus {
    install_kind: Option<String>,
    package_manager: Option<String>,
    registry: Option<RawRegistryStatus>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawRegistryStatus {
    latest_version: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChannel {
    value: Option<String>,
    label: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawAvailability {
    available: bool,
    has_git_update: bool,
    has_registry_update: bool,
    latest_version: Option<String>,
    git_behind: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawUpdateResult {
    status: String,
    mode: Option<String>,
    reason: Option<String>,
    before: Option<RawVersionMarker>,
    after: Option<RawVersionMarker>,
}

#[derive(Debug, Deserialize)]
struct RawVersionMarker {
    version: Option<String>,
}

fn configure_background_command(command: &mut tokio::process::Command) {
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    #[cfg(not(windows))]
    let _ = command;
}

fn build_openclaw_command(binary: &Path, args: &[&str]) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .env("PATH", system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", paths::desktop_dir())
        .env("OPENCLAW_CONFIG_PATH", paths::config_path())
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_background_command(&mut command);
    command
}

async fn run_openclaw_command(
    binary: &Path,
    args: &[&str],
    command_timeout: Duration,
) -> Result<Output, String> {
    let command_name = args.join(" ");
    let mut command = build_openclaw_command(binary, args);
    tokio::time::timeout(command_timeout, command.output())
        .await
        .map_err(|_| format!("OpenClaw {} timed out", command_name))?
        .map_err(|error| format!("Failed to run OpenClaw {}: {}", command_name, error))
}

fn has_required_keys(value: &Value, required_keys: &[&str]) -> bool {
    required_keys.iter().all(|key| value.get(*key).is_some())
}

fn parse_json_object(output: &[u8], required_keys: &[&str]) -> Result<Value, String> {
    let text = String::from_utf8_lossy(output);
    let trimmed = text.trim();

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        if has_required_keys(&value, required_keys) {
            return Ok(value);
        }
    }

    // Older runtimes or package managers may print a warning before JSON.
    // Walk object starts from the end and accept only the expected payload.
    for (start, ch) in text.char_indices().rev() {
        if ch != '{' {
            continue;
        }
        let mut deserializer = serde_json::Deserializer::from_str(&text[start..]);
        if let Ok(value) = Value::deserialize(&mut deserializer) {
            if has_required_keys(&value, required_keys) {
                return Ok(value);
            }
        }
    }

    Err("OpenClaw returned an invalid JSON response".to_string())
}

fn redact_diagnostic_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    if [
        "api_key",
        "apikey",
        "authorization",
        "credential",
        "password",
        "secret",
        "token",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
    {
        return "[sensitive diagnostic redacted]".to_string();
    }

    let mut value = line.trim().chars().take(600).collect::<String>();
    if line.trim().chars().count() > 600 {
        value.push_str("...");
    }
    value
}

fn output_diagnostic(output: &Output) -> Option<String> {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let source = if stderr.trim().is_empty() {
        stdout.as_ref()
    } else {
        stderr.as_ref()
    };
    let lines = source
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(4)
        .map(redact_diagnostic_line)
        .collect::<Vec<_>>();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

fn empty_update_status(current_version: Option<String>, error: String) -> OpenclawUpdateStatus {
    OpenclawUpdateStatus {
        current_version,
        latest_version: None,
        available: false,
        has_git_update: false,
        has_registry_update: false,
        git_behind: None,
        channel: None,
        channel_label: None,
        install_kind: None,
        package_manager: None,
        error: Some(error),
    }
}

fn parse_update_status(
    output: &[u8],
    current_version: Option<String>,
) -> Result<OpenclawUpdateStatus, String> {
    let value = parse_json_object(output, &["update", "channel", "availability"])?;
    let payload: StatusEnvelope = serde_json::from_value(value)
        .map_err(|error| format!("Invalid OpenClaw update status: {}", error))?;
    let registry = payload.update.registry.unwrap_or_default();

    Ok(OpenclawUpdateStatus {
        current_version,
        latest_version: payload
            .availability
            .latest_version
            .or(registry.latest_version),
        available: payload.availability.available,
        has_git_update: payload.availability.has_git_update,
        has_registry_update: payload.availability.has_registry_update,
        git_behind: payload.availability.git_behind,
        channel: payload.channel.value,
        channel_label: payload.channel.label,
        install_kind: payload.update.install_kind,
        package_manager: payload.update.package_manager,
        error: registry.error.map(|error| redact_diagnostic_line(&error)),
    })
}

fn parse_update_result(output: &[u8]) -> Result<OpenclawUpdateResult, String> {
    let value = parse_json_object(output, &["status", "mode", "steps", "durationMs"])?;
    let payload: RawUpdateResult = serde_json::from_value(value)
        .map_err(|error| format!("Invalid OpenClaw update result: {}", error))?;
    let success = payload.status == "ok";

    Ok(OpenclawUpdateResult {
        success,
        status: payload.status,
        mode: payload.mode,
        reason: payload.reason.clone(),
        before_version: payload.before.and_then(|marker| marker.version),
        after_version: payload.after.and_then(|marker| marker.version),
        gateway_restarted: false,
        gateway_error: None,
        error: (!success).then(|| {
            payload
                .reason
                .unwrap_or_else(|| "OpenClaw update did not complete".to_string())
        }),
    })
}

#[tauri::command]
pub async fn check_openclaw_update() -> Result<OpenclawUpdateStatus, String> {
    let _operation_guard = update_operation()
        .try_lock()
        .map_err(|_| UPDATE_BUSY_ERROR.to_string())?;
    let detected = system::detect_openclaw().await;
    if !detected.installed {
        return Err("OpenClaw is not installed".to_string());
    }
    let binary = system::resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw executable was not found".to_string())?;
    let output = run_openclaw_command(
        &binary,
        &["update", "status", "--json", "--timeout", "15"],
        STATUS_TIMEOUT,
    )
    .await?;

    if !output.status.success() {
        return Ok(empty_update_status(
            detected.version,
            output_diagnostic(&output)
                .unwrap_or_else(|| format!("Update check exited with {}", output.status)),
        ));
    }

    match parse_update_status(&output.stdout, detected.version.clone()) {
        Ok(status) => Ok(status),
        Err(error) => Ok(empty_update_status(
            detected.version,
            output_diagnostic(&output).unwrap_or(error),
        )),
    }
}

async fn stop_managed_gateway(state: &GatewayProcess) -> Result<bool, String> {
    let managed = state
        .runtime_mode
        .lock()
        .map(|mode| *mode == GatewayRuntimeMode::ManagedChild)
        .map_err(|error| error.to_string())?;
    if !managed {
        return Ok(false);
    }

    let child = state
        .child
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    if let Some(mut child) = child {
        if let Err(error) = child.kill().await {
            state
                .child
                .lock()
                .map_err(|lock_error| lock_error.to_string())?
                .replace(child);
            return Err(format!("Failed to stop the managed Gateway: {}", error));
        }
    }
    crate::commands::gateway_supervisor::transition_runtime(
        state,
        GatewayLifecycle::Stopped,
        GatewayRuntimeMode::None,
        "openclaw_update: managed child stopped before package replacement",
    );
    Ok(true)
}

async fn restore_managed_gateway(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    should_restore: bool,
) -> Result<bool, String> {
    if !should_restore {
        return Ok(false);
    }
    gateway::start_gateway_locked(app, state, None)
        .await
        .map(|status| status.running)
}

#[tauri::command]
pub async fn update_openclaw(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<OpenclawUpdateResult, String> {
    let _update_guard = update_operation()
        .try_lock()
        .map_err(|_| UPDATE_BUSY_ERROR.to_string())?;
    let operation_gate = state.operation_gate.clone();
    let _gateway_guard = operation_gate
        .try_lock_owned()
        .map_err(|_| "A Gateway lifecycle operation is already running".to_string())?;

    let detected = system::detect_openclaw().await;
    if !detected.installed {
        return Err("OpenClaw is not installed".to_string());
    }
    let binary = system::resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw executable was not found".to_string())?;
    let restore_gateway = stop_managed_gateway(&state).await?;

    let output =
        run_openclaw_command(&binary, &["update", "--yes", "--json"], UPDATE_TIMEOUT).await;

    let mut result = match output {
        Ok(output) => match parse_update_result(&output.stdout) {
            Ok(mut parsed) => {
                if !output.status.success() {
                    parsed.success = false;
                    parsed.error = output_diagnostic(&output)
                        .or(parsed.error)
                        .or_else(|| Some(format!("Update exited with {}", output.status)));
                }
                parsed
            }
            Err(error) => OpenclawUpdateResult {
                success: false,
                status: "error".to_string(),
                mode: None,
                reason: None,
                before_version: detected.version.clone(),
                after_version: None,
                gateway_restarted: false,
                gateway_error: None,
                error: output_diagnostic(&output).or(Some(error)),
            },
        },
        Err(error) => OpenclawUpdateResult {
            success: false,
            status: "error".to_string(),
            mode: None,
            reason: None,
            before_version: detected.version.clone(),
            after_version: None,
            gateway_restarted: false,
            gateway_error: None,
            error: Some(error),
        },
    };

    match restore_managed_gateway(app, state.clone(), restore_gateway).await {
        Ok(restarted) => result.gateway_restarted = restarted,
        Err(error) => result.gateway_error = Some(error),
    }

    let refreshed = system::detect_openclaw().await;
    if refreshed.version.is_some() {
        result.after_version = refreshed.version;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_package_update_status_from_official_payload() {
        let status = parse_update_status(
            br#"{
              "update": {
                "installKind": "package",
                "packageManager": "npm",
                "registry": { "latestVersion": "2026.7.1", "tag": "latest" }
              },
              "channel": { "value": "stable", "label": "stable (default)" },
              "availability": {
                "available": true,
                "hasGitUpdate": false,
                "hasRegistryUpdate": true,
                "latestVersion": "2026.7.1",
                "gitBehind": null
              }
            }"#,
            Some("2026.6.11".to_string()),
        )
        .unwrap();

        assert!(status.available);
        assert_eq!(status.current_version.as_deref(), Some("2026.6.11"));
        assert_eq!(status.latest_version.as_deref(), Some("2026.7.1"));
        assert_eq!(status.install_kind.as_deref(), Some("package"));
        assert_eq!(status.package_manager.as_deref(), Some("npm"));
    }

    #[test]
    fn parses_git_update_without_a_registry_version() {
        let status = parse_update_status(
            br#"{
              "update": { "installKind": "git", "git": { "behind": 3 } },
              "channel": { "value": "dev", "label": "dev" },
              "availability": {
                "available": true,
                "hasGitUpdate": true,
                "hasRegistryUpdate": false,
                "latestVersion": null,
                "gitBehind": 3
              }
            }"#,
            Some("2026.7.0".to_string()),
        )
        .unwrap();

        assert!(status.has_git_update);
        assert_eq!(status.git_behind, Some(3));
        assert_eq!(status.channel.as_deref(), Some("dev"));
        assert_eq!(status.latest_version, None);
    }

    #[test]
    fn preserves_registry_failure_as_an_unknown_check() {
        let status = parse_update_status(
            br#"{
              "update": {
                "installKind": "package",
                "packageManager": "npm",
                "registry": { "error": "network unavailable" }
              },
              "channel": { "value": "beta", "label": "beta" },
              "availability": {
                "available": false,
                "hasGitUpdate": false,
                "hasRegistryUpdate": false,
                "latestVersion": null,
                "gitBehind": null
              }
            }"#,
            Some("2026.6.11".to_string()),
        )
        .unwrap();

        assert!(!status.available);
        assert_eq!(status.error.as_deref(), Some("network unavailable"));
    }

    #[test]
    fn parses_json_after_a_package_manager_warning() {
        let result = parse_update_result(
            br#"npm warn using --force
            {
              "status": "ok",
              "mode": "npm",
              "before": { "version": "2026.6.11" },
              "after": { "version": "2026.7.1" },
              "steps": [],
              "durationMs": 1200
            }"#,
        )
        .unwrap();

        assert!(result.success);
        assert_eq!(result.mode.as_deref(), Some("npm"));
        assert_eq!(result.after_version.as_deref(), Some("2026.7.1"));
    }

    #[test]
    fn ignores_nested_plugin_status_objects() {
        let result = parse_update_result(
            br#"{
              "status": "ok",
              "mode": "npm",
              "before": { "version": "2026.6.11" },
              "after": { "version": "2026.7.1" },
              "steps": [],
              "durationMs": 1200,
              "postUpdate": {
                "plugins": { "status": "error", "reason": "plugin-sync" }
              }
            }"#,
        )
        .unwrap();

        assert!(result.success);
        assert_eq!(result.mode.as_deref(), Some("npm"));
    }

    #[test]
    fn redacts_sensitive_diagnostics() {
        assert_eq!(
            redact_diagnostic_line("Authorization: Bearer abc"),
            "[sensitive diagnostic redacted]"
        );
        assert_eq!(
            redact_diagnostic_line("network unavailable"),
            "network unavailable"
        );
    }
}
