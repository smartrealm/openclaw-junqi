use crate::commands::{
    gateway,
    npm_registry::{self, NpmRegistry, NpmRegistryKind, NpmRegistrySelection},
    setup, setup_progress, system,
};
use crate::paths;
use crate::platform;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::GatewayProcess;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::process::{Output, Stdio};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

const STATUS_TIMEOUT: Duration = Duration::from_secs(90);
const OPENCLAW_STATUS_TIMEOUT_SECONDS: &str = "60";
const UPDATE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const UPDATE_BUSY_ERROR: &str = "An OpenClaw update operation is already running";
const UPDATE_PROGRESS_STEP: &str = "openclaw-update";

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
    pub npm_registry: Option<String>,
    pub npm_registry_kind: Option<NpmRegistryKind>,
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
    pub npm_registry: Option<String>,
    pub npm_registry_kind: Option<NpmRegistryKind>,
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
#[serde(rename_all = "camelCase")]
struct RawDryRunUpdateStatus {
    #[serde(default)]
    dry_run: bool,
    install_kind: Option<String>,
    mode: Option<String>,
    current_version: Option<String>,
    target_version: Option<String>,
    effective_channel: Option<String>,
    #[serde(default)]
    downgrade_risk: bool,
}

#[derive(Debug, Deserialize)]
struct RawVersionMarker {
    version: Option<String>,
}

fn build_openclaw_command(
    binary: &Path,
    args: &[&str],
    npm_registry: Option<NpmRegistry>,
) -> tokio::process::Command {
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
    if let Some(registry) = npm_registry {
        // Child-process-only config: this must not mutate ~/.npmrc or global npm settings.
        command
            .env("npm_config_registry", registry.url)
            .env("NPM_CONFIG_REGISTRY", registry.url);
    }
    platform::configure_background_command(&mut command);
    command
}

async fn run_openclaw_command(
    binary: &Path,
    args: &[&str],
    command_timeout: Duration,
    npm_registry: Option<NpmRegistry>,
) -> Result<Output, String> {
    let command_name = args.join(" ");
    let mut command = build_openclaw_command(binary, args, npm_registry);
    tokio::time::timeout(command_timeout, command.output())
        .await
        .map_err(|_| {
            let source = npm_registry
                .map(|registry| format!(" via {}", registry.label()))
                .unwrap_or_default();
            format!(
                "OpenClaw {} timed out{} after {} seconds",
                command_name,
                source,
                command_timeout.as_secs()
            )
        })?
        .map_err(|error| format!("Failed to run OpenClaw {}: {}", command_name, error))
}

fn emit_update_progress(app: &AppHandle, message: &str, progress: f64) {
    setup_progress::emit(app, UPDATE_PROGRESS_STEP, message, progress);
}

fn emit_update_error(app: &AppHandle, message: &str, progress: Option<f64>) {
    setup_progress::emit_error(app, UPDATE_PROGRESS_STEP, message, progress);
}

async fn collect_stream<R>(app: AppHandle, stream: R, progress: f64) -> Result<Vec<u8>, String>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut reader = BufReader::new(stream).lines();
    let mut output = Vec::new();
    while let Some(line) = reader
        .next_line()
        .await
        .map_err(|error| format!("Failed to read OpenClaw update output: {error}"))?
    {
        output.extend_from_slice(line.as_bytes());
        output.push(b'\n');
        let safe_line = redact_diagnostic_line(&line);
        if !safe_line.trim().is_empty() {
            emit_update_progress(&app, &safe_line, progress);
        }
    }
    Ok(output)
}

async fn run_openclaw_command_streaming(
    app: &AppHandle,
    binary: &Path,
    args: &[&str],
    command_timeout: Duration,
    npm_registry: Option<NpmRegistry>,
) -> Result<Output, String> {
    let command_name = args.join(" ");
    let mut command = build_openclaw_command(binary, args, npm_registry);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run OpenClaw {command_name}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "OpenClaw update stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "OpenClaw update stderr was not captured".to_string())?;
    let stdout_task = tokio::spawn(collect_stream(app.clone(), stdout, 0.65));
    let stderr_task = tokio::spawn(collect_stream(app.clone(), stderr, 0.65));

    let status = tokio::time::timeout(command_timeout, child.wait())
        .await
        .map_err(|_| {
            let source = npm_registry
                .map(|registry| format!(" via {}", registry.label()))
                .unwrap_or_default();
            format!(
                "OpenClaw {command_name} timed out{source} after {} seconds",
                command_timeout.as_secs()
            )
        })?
        .map_err(|error| format!("Failed to wait for OpenClaw {command_name}: {error}"))?;
    let stdout = stdout_task
        .await
        .map_err(|error| format!("OpenClaw stdout reader stopped: {error}"))??;
    let stderr = stderr_task
        .await
        .map_err(|error| format!("OpenClaw stderr reader stopped: {error}"))??;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

async fn run_openclaw_command_with_registry_fallback(
    app: &AppHandle,
    binary: &Path,
    args: &[&str],
    command_timeout: Duration,
    selection: NpmRegistrySelection,
) -> (Result<Output, String>, NpmRegistry) {
    let primary = selection.primary;
    emit_update_progress(
        app,
        &format!("Running official updater via {}", primary.label()),
        0.55,
    );
    let output =
        run_openclaw_command_streaming(app, binary, args, command_timeout, Some(primary)).await;
    if !is_network_failure(&output) {
        return (output, primary);
    }

    let Some(fallback) = selection.fallback else {
        return (output, primary);
    };
    emit_update_progress(
        app,
        &format!(
            "Network failure via {}; retrying via {}",
            primary.label(),
            fallback.label()
        ),
        0.58,
    );
    let retry =
        run_openclaw_command_streaming(app, binary, args, command_timeout, Some(fallback)).await;
    (retry, fallback)
}

async fn ensure_update_node_runtime(app: &AppHandle) -> Result<(), String> {
    emit_update_progress(app, "Checking Node.js runtime compatibility...", 0.08);
    setup::ensure_compatible_node_runtime(app, UPDATE_PROGRESS_STEP).await?;
    Ok(())
}

async fn run_npm_update_dry_run_with_registry_fallback(
    binary: &Path,
    selection: NpmRegistrySelection,
) -> (Result<Output, String>, NpmRegistry) {
    let args = [
        "update",
        "--dry-run",
        "--no-restart",
        "--yes",
        "--json",
        "--timeout",
        OPENCLAW_STATUS_TIMEOUT_SECONDS,
    ];
    let primary = selection.primary;
    let output = run_openclaw_command(binary, &args, STATUS_TIMEOUT, Some(primary)).await;
    if !should_retry_dry_run_with_fallback(&output) {
        return (output, primary);
    }

    let Some(fallback) = selection.fallback else {
        return (output, primary);
    };
    let retry = run_openclaw_command(binary, &args, STATUS_TIMEOUT, Some(fallback)).await;
    (retry, fallback)
}

fn is_network_failure(result: &Result<Output, String>) -> bool {
    let diagnostic = match result {
        Ok(output) if !output.status.success() => output_contains_network_error(output),
        Err(error) => error.clone(),
        _ => return false,
    };
    contains_network_error(&diagnostic)
}

fn output_contains_network_error(output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    format!("{stderr}\n{stdout}")
}

fn contains_network_error(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "network",
        "econn",
        "enotfound",
        "eai_again",
        "etimedout",
        "fetch failed",
        "socket hang up",
        "connection reset",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
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

fn should_retry_dry_run_with_fallback(result: &Result<Output, String>) -> bool {
    if is_network_failure(result) {
        return true;
    }

    let Ok(output) = result else {
        return false;
    };
    if !output.status.success() {
        return false;
    }

    parse_dry_run_update_status(&output.stdout)
        .map(|status| npm_dry_run_needs_registry_fallback(&status))
        .unwrap_or(false)
}

use crate::commands::diagnostic_output::sanitize_diagnostic_line as redact_diagnostic_line;

fn output_diagnostic(output: &Output) -> Option<String> {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    diagnostic_from_text(&stderr, &stdout)
}

fn diagnostic_from_text(stderr: &str, stdout: &str) -> Option<String> {
    let combined = format!("{stderr}\n{stdout}");
    let all_lines = combined
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    let important = all_lines.iter().copied().filter(|line| {
        let lower = line.to_ascii_lowercase();
        [
            "node.js",
            "is required",
            "permission denied",
            "eacces",
            "network",
            "econn",
            "timed out",
            "failed",
            "error",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
    });
    let selected = important.chain(all_lines.iter().copied()).take(4);
    let mut lines = selected.map(redact_diagnostic_line).collect::<Vec<_>>();
    lines.dedup();
    (!lines.is_empty()).then(|| lines.join("\n"))
}

const GATEWAY_RESTART_FAILURE_MARKERS: &[&str] = &[
    "gateway did not become healthy after restart",
    "gateway: restart failed",
    "gateway restart failed after",
    "gateway service restart failed",
    "updated install restart failed",
    "update restart failed",
    "failed to restart managed gateway service",
];

fn gateway_restart_failure_diagnostic(output: &Output) -> Option<String> {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    gateway_restart_failure_diagnostic_from_text(&stderr, &stdout)
}

fn gateway_restart_failure_diagnostic_from_text(stderr: &str, stdout: &str) -> Option<String> {
    let combined = format!("{stderr}\n{stdout}");
    let lines = combined.lines().collect::<Vec<_>>();
    let start = lines.iter().position(|line| {
        let lower = line.to_ascii_lowercase();
        GATEWAY_RESTART_FAILURE_MARKERS
            .iter()
            .any(|marker| lower.contains(marker))
    })?;
    let diagnostic = lines[start..]
        .iter()
        .filter(|line| !line.trim().is_empty())
        .take(4)
        .map(|line| redact_diagnostic_line(line))
        .collect::<Vec<_>>();
    (!diagnostic.is_empty()).then(|| diagnostic.join("\n"))
}

fn reconcile_installed_update_with_restart_failure(
    result: &mut OpenclawUpdateResult,
    detected_before: Option<&str>,
    detected_after: Option<String>,
    restart_error: Option<String>,
) {
    if let Some(after) = detected_after {
        result.after_version = Some(after.clone());
        if !result.success
            && restart_error.is_some()
            && detected_before.is_some_and(|before| before != after)
        {
            result.success = true;
            result.status = "ok".to_string();
            result.reason = None;
            result.error = None;
            result.gateway_error = restart_error;
        }
    }
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
        npm_registry: None,
        npm_registry_kind: None,
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
    let install_kind = payload.update.install_kind;
    let package_manager = payload.update.package_manager;

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
        install_kind,
        package_manager,
        npm_registry: None,
        npm_registry_kind: None,
        error: registry.error.map(|error| redact_diagnostic_line(&error)),
    })
}

fn parse_dry_run_update_status(output: &[u8]) -> Result<RawDryRunUpdateStatus, String> {
    let value = parse_json_object(output, &["dryRun", "installKind", "mode"])?;
    let payload: RawDryRunUpdateStatus = serde_json::from_value(value)
        .map_err(|error| format!("Invalid OpenClaw update dry-run result: {}", error))?;
    if !payload.dry_run {
        return Err("OpenClaw update check did not return a dry-run result".to_string());
    }
    Ok(payload)
}

fn is_npm_package_dry_run(status: &RawDryRunUpdateStatus) -> bool {
    status.install_kind.as_deref() == Some("package") && status.mode.as_deref() == Some("npm")
}

fn npm_dry_run_needs_registry_fallback(status: &RawDryRunUpdateStatus) -> bool {
    is_npm_package_dry_run(status) && status.target_version.is_none()
}

fn update_status_from_npm_dry_run(
    payload: RawDryRunUpdateStatus,
    detected_version: Option<String>,
    registry: NpmRegistry,
) -> OpenclawUpdateStatus {
    let current_version = payload.current_version.or(detected_version);
    let latest_version = payload.target_version;
    let available = matches!(
        (current_version.as_deref(), latest_version.as_deref()),
        (Some(current), Some(latest)) if current != latest && !payload.downgrade_risk
    );
    let error = if payload.downgrade_risk {
        Some(
            "The selected OpenClaw update channel would downgrade the installed version"
                .to_string(),
        )
    } else if latest_version.is_none() {
        Some(format!(
            "Could not resolve the OpenClaw update target from {}",
            registry.url
        ))
    } else {
        None
    };

    OpenclawUpdateStatus {
        current_version,
        latest_version,
        available,
        has_git_update: false,
        has_registry_update: available,
        git_behind: None,
        channel: payload.effective_channel.clone(),
        channel_label: payload.effective_channel,
        install_kind: payload.install_kind,
        package_manager: payload.mode,
        npm_registry: Some(registry.url.to_string()),
        npm_registry_kind: Some(registry.kind),
        error,
    }
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
        npm_registry: None,
        npm_registry_kind: None,
        error: (!success).then(|| {
            payload
                .reason
                .unwrap_or_else(|| "OpenClaw update did not complete".to_string())
        }),
    })
}

#[tauri::command]
pub async fn check_openclaw_update(app: AppHandle) -> Result<OpenclawUpdateStatus, String> {
    let _operation_guard = update_operation()
        .try_lock()
        .map_err(|_| UPDATE_BUSY_ERROR.to_string())?;
    emit_update_progress(&app, "Starting OpenClaw update check...", 0.02);
    if let Err(error) = ensure_update_node_runtime(&app).await {
        emit_update_error(&app, &error, Some(0.28));
        return Err(error);
    }
    let detected = system::detect_openclaw().await;
    if !detected.installed {
        return Err("OpenClaw is not installed".to_string());
    }
    let binary = system::resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw executable was not found".to_string())?;
    emit_update_progress(
        &app,
        &format!("OpenClaw binary: {}", system::path_for_display(&binary)),
        0.34,
    );
    emit_update_progress(&app, "Checking the configured update channel...", 0.4);
    let selection = npm_registry::select_npm_registry().await;
    let (dry_run_output, selected_registry) =
        run_npm_update_dry_run_with_registry_fallback(&binary, selection).await;
    let dry_run_output = dry_run_output?;

    if !dry_run_output.status.success() {
        return Ok(empty_update_status(
            detected.version,
            output_diagnostic(&dry_run_output)
                .unwrap_or_else(|| format!("Update check exited with {}", dry_run_output.status)),
        ));
    }

    match parse_dry_run_update_status(&dry_run_output.stdout) {
        Ok(dry_run) if is_npm_package_dry_run(&dry_run) => {
            let status =
                update_status_from_npm_dry_run(dry_run, detected.version, selected_registry);
            emit_update_progress(&app, "OpenClaw update check completed", 1.0);
            return Ok(status);
        }
        Ok(_) | Err(_) => {}
    }

    // OpenClaw's status command internally hard-codes the public npm registry.
    // Use it only for non-npm installs, where it supplies git-specific state.
    let output = run_openclaw_command(
        &binary,
        &[
            "update",
            "status",
            "--json",
            "--timeout",
            OPENCLAW_STATUS_TIMEOUT_SECONDS,
        ],
        STATUS_TIMEOUT,
        None,
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
        Ok(status) => {
            emit_update_progress(&app, "OpenClaw update check completed", 1.0);
            Ok(status)
        }
        Err(error) => Ok(empty_update_status(
            detected.version,
            output_diagnostic(&output).unwrap_or(error),
        )),
    }
}

async fn stop_managed_gateway(state: &GatewayProcess) -> Result<bool, String> {
    let managed = state.runtime_snapshot()?.mode == GatewayRuntimeMode::ManagedChild;
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
    state.transition(
        Some(GatewayLifecycle::Stopped),
        Some(GatewayRuntimeMode::None),
        None,
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

    emit_update_progress(&app, "Preparing the OpenClaw update...", 0.02);
    if let Err(error) = ensure_update_node_runtime(&app).await {
        emit_update_error(&app, &error, Some(0.28));
        return Err(error);
    }

    let detected = system::detect_openclaw().await;
    if !detected.installed {
        return Err("OpenClaw is not installed".to_string());
    }
    let binary = system::resolve_openclaw_binary()
        .ok_or_else(|| "OpenClaw executable was not found".to_string())?;
    emit_update_progress(
        &app,
        &format!("OpenClaw binary: {}", system::path_for_display(&binary)),
        0.34,
    );
    // Probe before taking the managed Gateway down so the expected network
    // decision does not lengthen its maintenance window.
    let selection = npm_registry::select_npm_registry().await;
    emit_update_progress(&app, "Stopping the managed Gateway if necessary...", 0.45);
    let restore_gateway = stop_managed_gateway(&state).await?;

    let (output, selected_registry) = run_openclaw_command_with_registry_fallback(
        &app,
        &binary,
        &["update", "--yes", "--json"],
        UPDATE_TIMEOUT,
        selection,
    )
    .await;

    // OpenClaw intentionally exits non-zero when the package was replaced but
    // the follow-up Gateway health check failed. Preserve that distinction so
    // the UI can report a successful core update with a restart warning.
    let gateway_restart_error = output
        .as_ref()
        .ok()
        .and_then(gateway_restart_failure_diagnostic);

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
                npm_registry: None,
                npm_registry_kind: None,
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
            npm_registry: None,
            npm_registry_kind: None,
            error: Some(error),
        },
    };

    if result.mode.as_deref() == Some("npm") {
        result.npm_registry = Some(selected_registry.url.to_string());
        result.npm_registry_kind = Some(selected_registry.kind);
    }

    emit_update_progress(&app, "Restoring the Gateway...", 0.88);
    match restore_managed_gateway(app.clone(), state.clone(), restore_gateway).await {
        Ok(restarted) => result.gateway_restarted = restarted,
        Err(error) => result.gateway_error = Some(error),
    }

    let refreshed = system::detect_openclaw().await;
    reconcile_installed_update_with_restart_failure(
        &mut result,
        detected.version.as_deref(),
        refreshed.version,
        gateway_restart_error,
    );
    if result.success {
        emit_update_progress(&app, "OpenClaw update completed", 1.0);
    } else {
        emit_update_error(
            &app,
            result
                .error
                .as_deref()
                .unwrap_or("OpenClaw update did not complete"),
            Some(1.0),
        );
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
    fn npm_dry_run_reports_the_selected_registry_version() {
        let dry_run = parse_dry_run_update_status(
            br#"npm warn cache bypassed
            {
              "dryRun": true,
              "installKind": "package",
              "mode": "npm",
              "currentVersion": "2026.6.11",
              "targetVersion": "2026.7.1",
              "effectiveChannel": "stable",
              "downgradeRisk": false
            }"#,
        )
        .unwrap();
        let mirror = NpmRegistry {
            kind: NpmRegistryKind::ChinaMirror,
            url: "https://registry.npmmirror.com",
        };
        let status = update_status_from_npm_dry_run(dry_run, None, mirror);

        assert!(status.available);
        assert!(status.has_registry_update);
        assert_eq!(status.latest_version.as_deref(), Some("2026.7.1"));
        assert_eq!(status.npm_registry_kind, Some(NpmRegistryKind::ChinaMirror));
        assert_eq!(status.npm_registry.as_deref(), Some(mirror.url));
    }

    #[test]
    fn unresolved_npm_dry_run_requests_the_verified_fallback_source() {
        let dry_run = parse_dry_run_update_status(
            br#"{
              "dryRun": true,
              "installKind": "package",
              "mode": "npm",
              "currentVersion": "2026.6.11",
              "targetVersion": null,
              "effectiveChannel": "stable"
            }"#,
        )
        .unwrap();

        assert!(npm_dry_run_needs_registry_fallback(&dry_run));
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

    #[test]
    fn diagnostic_prioritizes_node_runtime_errors_over_json_headers() {
        assert!(diagnostic_from_text(
            "openclaw: Node.js >=24.15.0 <25 is required (current: v24.14.1).",
            r#"{ "status": "error", "mode": "npm" }"#,
        )
        .unwrap()
        .starts_with("openclaw: Node.js >=24.15.0 <25 is required"));
    }

    #[test]
    fn recognizes_npm_network_failures_without_retrying_business_errors() {
        let network_error = Err("OpenClaw update failed: ECONNRESET".to_string());
        let business_error = Err("OpenClaw update failed: permission denied".to_string());

        assert!(is_network_failure(&network_error));
        assert!(!is_network_failure(&business_error));
        assert!(contains_network_error("step stderr: ECONNRESET"));
        assert!(!contains_network_error("permission denied"));
    }

    #[test]
    fn promotes_an_installed_core_update_with_a_restart_failure_to_warning() {
        let mut result = OpenclawUpdateResult {
            success: false,
            status: "error".to_string(),
            mode: None,
            reason: None,
            before_version: Some("2026.6.11".to_string()),
            after_version: None,
            gateway_restarted: false,
            gateway_error: None,
            npm_registry: None,
            npm_registry_kind: None,
            error: Some("OpenClaw returned an invalid JSON response".to_string()),
        };

        reconcile_installed_update_with_restart_failure(
            &mut result,
            Some("2026.6.11"),
            Some("2026.7.1".to_string()),
            Some("Gateway did not become healthy after restart.".to_string()),
        );

        assert!(result.success);
        assert_eq!(result.status, "ok");
        assert_eq!(result.after_version.as_deref(), Some("2026.7.1"));
        assert_eq!(
            result.gateway_error.as_deref(),
            Some("Gateway did not become healthy after restart.")
        );
        assert_eq!(result.error, None);
    }

    #[test]
    fn does_not_hide_non_restart_update_failures() {
        let mut result = OpenclawUpdateResult {
            success: false,
            status: "error".to_string(),
            mode: Some("npm".to_string()),
            reason: Some("post-update-plugins".to_string()),
            before_version: Some("2026.6.11".to_string()),
            after_version: None,
            gateway_restarted: false,
            gateway_error: None,
            npm_registry: None,
            npm_registry_kind: None,
            error: Some("plugin sync failed".to_string()),
        };

        reconcile_installed_update_with_restart_failure(
            &mut result,
            Some("2026.6.11"),
            Some("2026.7.1".to_string()),
            None,
        );

        assert!(!result.success);
        assert_eq!(result.reason.as_deref(), Some("post-update-plugins"));
        assert_eq!(result.gateway_error, None);
    }

    #[test]
    fn extracts_restart_failure_after_unrelated_migration_warnings() {
        let diagnostic = gateway_restart_failure_diagnostic_from_text(
            "[state-migrations] Legacy state migration warnings\n\
             [restart] killing 1 stale gateway process(es) before restart: 84555\n\
             Gateway did not become healthy after restart.\n\
             Service runtime stayed stopped.",
            "",
        );

        assert_eq!(
            diagnostic.as_deref(),
            Some(
                "Gateway did not become healthy after restart.\n\
                 Service runtime stayed stopped."
            )
        );
    }

    #[test]
    fn stale_process_cleanup_alone_is_not_a_restart_failure() {
        assert_eq!(
            gateway_restart_failure_diagnostic_from_text(
                "[restart] killing 1 stale gateway process(es) before restart: 84555",
                "",
            ),
            None
        );
    }
}
