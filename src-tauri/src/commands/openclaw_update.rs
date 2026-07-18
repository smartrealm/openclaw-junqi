use crate::commands::{
    gateway,
    npm_registry::{self, NpmPackageSource, NpmRegistryKind},
    setup, setup_progress, system,
};
use crate::paths;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::GatewayProcess;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::process::{Output, Stdio};
use std::sync::{
    atomic::{AtomicU8, AtomicUsize, Ordering},
    Arc, OnceLock,
};
use std::time::Duration;
use tauri::{AppHandle, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

const STATUS_TIMEOUT: Duration = Duration::from_secs(90);
const OPENCLAW_STATUS_TIMEOUT_SECONDS: &str = "60";
const UPDATE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const UPDATE_BUSY_ERROR: &str = "An OpenClaw update operation is already running";
const UPDATE_PROGRESS_STEP: &str = "openclaw-update";
const UPDATE_STREAM_START_PERCENT: u8 = 55;

static UPDATE_OPERATION: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
enum UpdateStreamPhase {
    Resolving = 1,
    Downloading = 2,
    Extracting = 3,
    RunningScripts = 4,
    Verifying = 5,
}

impl UpdateStreamPhase {
    fn progress(self, http_request_count: usize) -> u8 {
        match self {
            Self::Resolving => 58,
            Self::Downloading => 62 + http_request_count.min(10) as u8,
            Self::Extracting => 76,
            Self::RunningScripts => 82,
            Self::Verifying => 86,
        }
    }

    fn event(self) -> (&'static str, &'static str) {
        match self {
            Self::Resolving => (
                "Resolving OpenClaw package dependencies...",
                "setup.openclawUpdate.progress.resolvingPackage",
            ),
            Self::Downloading => (
                "Downloading OpenClaw package from the npm registry...",
                "setup.openclawUpdate.progress.downloadingPackage",
            ),
            Self::Extracting => (
                "Extracting and replacing the OpenClaw package...",
                "setup.openclawUpdate.progress.extractingPackage",
            ),
            Self::RunningScripts => (
                "Running OpenClaw package installation scripts...",
                "setup.openclawUpdate.progress.runningScripts",
            ),
            Self::Verifying => (
                "Validating the updated OpenClaw package...",
                "setup.openclawUpdate.progress.verifyingPackage",
            ),
        }
    }
}

#[derive(Debug)]
struct UpdateStreamObservation {
    progress: f64,
    entered_phase: Option<UpdateStreamPhase>,
}

#[derive(Debug)]
struct UpdateStreamProgress {
    phase: AtomicU8,
    progress: AtomicU8,
    http_requests: AtomicUsize,
}

impl UpdateStreamProgress {
    fn new() -> Self {
        Self {
            phase: AtomicU8::new(0),
            progress: AtomicU8::new(UPDATE_STREAM_START_PERCENT),
            http_requests: AtomicUsize::new(0),
        }
    }

    fn observe(&self, line: &str) -> UpdateStreamObservation {
        let lower = line.to_ascii_lowercase();
        let phase = if lower.contains("npm http fetch")
            || lower.contains("downloading")
            || lower.contains("tarball")
        {
            Some(UpdateStreamPhase::Downloading)
        } else if lower.contains("reify")
            || lower.contains("extract")
            || lower.contains("unpack")
            || lower.contains("package tree")
            || lower.contains("staging")
        {
            Some(UpdateStreamPhase::Extracting)
        } else if lower.contains("preinstall")
            || lower.contains("postinstall")
            || lower.contains("install script")
            || lower.contains("foreground script")
        {
            Some(UpdateStreamPhase::RunningScripts)
        } else if lower.contains("validat")
            || lower.contains("dist manifest")
            || lower.contains("promot")
            || lower.contains("activat")
            || lower.contains("packages in")
            || lower.starts_with("added ")
            || lower.starts_with("changed ")
        {
            Some(UpdateStreamPhase::Verifying)
        } else if lower.contains("resolv")
            || lower.contains("ideal tree")
            || lower.contains("idealtree")
            || lower.contains("fetch manifest")
            || lower.contains("npm http cache")
        {
            Some(UpdateStreamPhase::Resolving)
        } else {
            None
        };

        let http_request_count = if lower.contains("npm http fetch") {
            self.http_requests.fetch_add(1, Ordering::Relaxed) + 1
        } else {
            self.http_requests.load(Ordering::Relaxed)
        };
        let candidate = phase
            .map(|value| value.progress(http_request_count))
            .unwrap_or_else(|| self.progress.load(Ordering::Relaxed));
        let progress = self
            .progress
            .fetch_max(candidate, Ordering::Relaxed)
            .max(candidate);

        let entered_phase = phase.and_then(|next| {
            let previous = self.phase.fetch_max(next as u8, Ordering::Relaxed);
            (next as u8 > previous).then_some(next)
        });

        UpdateStreamObservation {
            progress: f64::from(progress) / 100.0,
            entered_phase,
        }
    }
}

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
    runtime: &system::NativeOpenclawRuntime,
    args: &[&str],
    npm_source: Option<&NpmPackageSource>,
) -> Result<tokio::process::Command, String> {
    let context = system::OpenclawCommandContext::maintenance()?;
    let mut command = runtime.command(&context);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    system::apply_configured_npm_cache(&mut command);
    if let Some(source) = npm_source {
        // Source selection is process-scoped. Configured sources deliberately
        // retain npm's own credentials/proxy settings instead of reconstructing
        // them in the desktop process.
        source.apply_to_command(&mut command);
        command
            // OpenClaw delegates package replacement to npm. HTTP-level output
            // gives the desktop updater useful download detail without enabling
            // npm's credential-heavy verbose/silly logs.
            .env("npm_config_loglevel", "http")
            .env("npm_config_foreground_scripts", "true")
            .env("npm_config_progress", "true");
    }
    Ok(command)
}

async fn run_openclaw_command(
    runtime: &system::NativeOpenclawRuntime,
    args: &[&str],
    command_timeout: Duration,
    npm_source: Option<&NpmPackageSource>,
) -> Result<Output, String> {
    let command_name = args.join(" ");
    let mut command = build_openclaw_command(runtime, args, npm_source)?;
    tokio::time::timeout(command_timeout, command.output())
        .await
        .map_err(|_| {
            let source = npm_source
                .map(|source| format!(" via {}", source.label()))
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

fn emit_update_progress_keyed(app: &AppHandle, message: &str, key: &str, progress: f64) {
    setup_progress::emit_keyed(app, UPDATE_PROGRESS_STEP, message, key, progress);
}

fn emit_update_error(app: &AppHandle, message: &str, progress: Option<f64>) {
    setup_progress::emit_error(app, UPDATE_PROGRESS_STEP, message, progress);
}

async fn collect_stream<R>(
    app: AppHandle,
    stream: R,
    tracker: Arc<UpdateStreamProgress>,
) -> Result<Vec<u8>, String>
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
            let observation = tracker.observe(&safe_line);
            if let Some(phase) = observation.entered_phase {
                let (message, key) = phase.event();
                emit_update_progress_keyed(&app, message, key, observation.progress);
            }
            emit_update_progress(&app, &safe_line, observation.progress);
        }
    }
    Ok(output)
}

async fn run_openclaw_command_streaming(
    app: &AppHandle,
    runtime: &system::NativeOpenclawRuntime,
    args: &[&str],
    command_timeout: Duration,
    npm_source: Option<&NpmPackageSource>,
) -> Result<Output, String> {
    let command_name = args.join(" ");
    let mut command = build_openclaw_command(runtime, args, npm_source)?;
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
    let tracker = Arc::new(UpdateStreamProgress::new());
    let stdout_task = tokio::spawn(collect_stream(app.clone(), stdout, Arc::clone(&tracker)));
    let stderr_task = tokio::spawn(collect_stream(app.clone(), stderr, tracker));

    let child_pid = child.id();
    let status = match tokio::time::timeout(command_timeout, child.wait()).await {
        Ok(Ok(status)) => status,
        Ok(Err(error)) => {
            crate::commands::process_control::terminate_process_tree(&mut child, child_pid).await;
            return Err(format!(
                "Failed to wait for OpenClaw {command_name}: {error}"
            ));
        }
        Err(_) => {
            crate::commands::process_control::terminate_process_tree(&mut child, child_pid).await;
            let source = npm_source
                .map(|source| format!(" via {}", source.label()))
                .unwrap_or_default();
            return Err(format!(
                "OpenClaw {command_name} timed out{source} after {} seconds",
                command_timeout.as_secs()
            ));
        }
    };
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

async fn ensure_update_node_runtime(
    app: &AppHandle,
    binary: &std::path::Path,
) -> Result<system::NodeStatus, String> {
    emit_update_progress_keyed(
        app,
        "Checking Node.js runtime compatibility...",
        "setup.openclawUpdate.progress.nodeCompatibility",
        0.08,
    );
    let requirement = system::required_node_requirement_for_openclaw_binary(binary)?;
    setup::ensure_compatible_node_runtime(app, UPDATE_PROGRESS_STEP, &requirement).await
}

#[derive(Debug, Clone)]
struct UpdateTargetContract {
    version: String,
    node_requirement: crate::commands::node_runtime::NodeRuntimeRequirement,
}

/// Resolve the exact npm package contract reported by OpenClaw's dry-run.
/// A package update must never proceed with a best-effort `latest` contract:
/// it can otherwise replace the package with a Node.js-incompatible release.
async fn resolve_update_target_contract(
    dry_run: &RawDryRunUpdateStatus,
    metadata_source: &NpmPackageSource,
) -> Result<Option<UpdateTargetContract>, String> {
    let install_kind = dry_run
        .install_kind
        .as_deref()
        .ok_or_else(|| "OpenClaw update dry-run did not report an install kind".to_string())?;
    if install_kind != "package" {
        return Ok(None);
    }
    if !is_npm_package_dry_run(dry_run) {
        return Err(
            "OpenClaw package update dry-run did not confirm npm package replacement; update was not started"
                .to_string(),
        );
    }
    let version = dry_run
        .target_version
        .as_deref()
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| {
            "OpenClaw package update target version is unavailable; update was not started"
                .to_string()
        })?;
    let expression = metadata_source
        .node_requirement(version)
        .await?
        .ok_or_else(|| {
            format!(
                "OpenClaw {version} does not publish an engines.node requirement; update was not started"
            )
        })?;
    let node_requirement = crate::commands::node_runtime::NodeRuntimeRequirement::parse(
        expression,
        crate::commands::node_runtime::NodeRequirementSource::RegistryPackage,
    )?;
    Ok(Some(UpdateTargetContract {
        version: version.to_string(),
        node_requirement,
    }))
}

/// Verify the actual package after replacement, including its strict
/// `engines.node` metadata. This remains mandatory for non-npm update modes,
/// whose target contract cannot be known before the official updater runs.
async fn validate_updated_runtime_contract(
    app: &AppHandle,
    binary: &std::path::Path,
    expected: Option<&UpdateTargetContract>,
) -> Result<system::NativeOpenclawRuntime, String> {
    let installed_version = system::openclaw_package_version_for_binary(binary)?;
    if let Some(expected) = expected {
        if installed_version != expected.version {
            return Err(format!(
                "OpenClaw package version mismatch after update: expected {}, found {}",
                expected.version, installed_version
            ));
        }
    }
    let installed_requirement = system::required_node_requirement_for_openclaw_binary(binary)?;
    if let Some(expected) = expected {
        if installed_requirement.expression() != expected.node_requirement.expression() {
            return Err(format!(
                "OpenClaw {} changed its Node.js requirement during update: expected {}, found {}",
                installed_version,
                expected.node_requirement.expression(),
                installed_requirement.expression()
            ));
        }
    }
    let node =
        setup::ensure_compatible_node_runtime(app, UPDATE_PROGRESS_STEP, &installed_requirement)
            .await?;
    system::native_openclaw_runtime(binary.to_path_buf(), &node)
}

fn mark_update_failure(result: &mut OpenclawUpdateResult, error: impl Into<String>) {
    result.success = false;
    result.status = "error".to_string();
    result.error = Some(error.into());
}

async fn run_npm_update_dry_run_with_registry_fallback(
    runtime: &system::NativeOpenclawRuntime,
    sources: &[NpmPackageSource],
) -> Result<(Output, NpmPackageSource), String> {
    let args = [
        "update",
        "--dry-run",
        "--no-restart",
        "--yes",
        "--json",
        "--timeout",
        OPENCLAW_STATUS_TIMEOUT_SECONDS,
    ];
    let mut last = None;
    for (index, source) in sources.iter().enumerate() {
        let output = run_openclaw_command(runtime, &args, STATUS_TIMEOUT, Some(source)).await;
        if !should_retry_dry_run_with_fallback(&output) || index + 1 == sources.len() {
            return output.map(|output| (output, source.clone()));
        }
        last = Some(output);
    }
    match last {
        Some(Err(error)) => Err(error),
        Some(Ok(_)) | None => {
            Err("No npm package source is available for update check".to_string())
        }
    }
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
    source: &NpmPackageSource,
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
            source.label()
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
        npm_registry: source
            .public_registry()
            .map(|registry| registry.url.to_string()),
        npm_registry_kind: source.public_registry().map(|registry| registry.kind),
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
    if matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        if let Err(error) = system::ensure_openclaw_relocation_complete() {
            emit_update_error(&app, &error, Some(0.02));
            return Err(error);
        }
    }
    let _operation_guard = update_operation()
        .try_lock()
        .map_err(|_| UPDATE_BUSY_ERROR.to_string())?;
    emit_update_progress_keyed(
        &app,
        "Starting OpenClaw update check...",
        "setup.openclawUpdate.progress.checkStart",
        0.02,
    );
    let detected = system::detect_openclaw().await;
    if !detected.installed {
        let error = "OpenClaw is not installed".to_string();
        emit_update_error(&app, &error, Some(0.28));
        return Err(error);
    }
    let binary = match system::resolve_openclaw_binary_async().await {
        Some(binary) => binary,
        None => {
            let error = "OpenClaw executable was not found".to_string();
            emit_update_error(&app, &error, Some(0.28));
            return Err(error);
        }
    };
    let node = match ensure_update_node_runtime(&app, &binary).await {
        Ok(node) => node,
        Err(error) => {
            emit_update_error(&app, &error, Some(0.28));
            return Err(error);
        }
    };
    let runtime = system::native_openclaw_runtime(binary.clone(), &node)?;
    emit_update_progress_keyed(
        &app,
        &format!("OpenClaw binary: {}", system::path_for_display(&binary)),
        "setup.openclawUpdate.progress.binary",
        0.34,
    );
    emit_update_progress_keyed(
        &app,
        "Checking the configured update channel...",
        "setup.openclawUpdate.progress.channel",
        0.4,
    );
    let node_path = node
        .path
        .as_deref()
        .map(std::path::Path::new)
        .ok_or("The selected Node.js runtime did not report an executable path")?;
    let policy = npm_registry::resolve_effective_npm_registry_policy(node_path).await?;
    let (dry_run_output, selected_source) =
        run_npm_update_dry_run_with_registry_fallback(&runtime, policy.sources()).await?;

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
                update_status_from_npm_dry_run(dry_run, detected.version, &selected_source);
            setup_progress::emit_completed_keyed(
                &app,
                UPDATE_PROGRESS_STEP,
                "OpenClaw update check completed",
                "setup.openclawUpdate.progress.checkCompleted",
            );
            return Ok(status);
        }
        Ok(_) | Err(_) => {}
    }

    // OpenClaw's status command internally hard-codes the public npm registry.
    // Use it only for non-npm installs, where it supplies git-specific state.
    let output = run_openclaw_command(
        &runtime,
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
            setup_progress::emit_completed_keyed(
                &app,
                UPDATE_PROGRESS_STEP,
                "OpenClaw update check completed",
                "setup.openclawUpdate.progress.checkCompleted",
            );
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
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
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
    if matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Docker
    ) {
        return Err(
            "Docker is the selected OpenClaw runtime. Refresh the Docker image and recreate its container instead of updating a native package."
                .to_string(),
        );
    }
    if let Err(error) = system::ensure_openclaw_relocation_complete() {
        emit_update_error(&app, &error, Some(0.02));
        return Err(error);
    }
    let _update_guard = update_operation()
        .try_lock()
        .map_err(|_| UPDATE_BUSY_ERROR.to_string())?;
    let operation_gate = state.operation_gate.clone();
    let _gateway_guard = operation_gate
        .try_lock_owned()
        .map_err(|_| "A Gateway lifecycle operation is already running".to_string())?;

    emit_update_progress_keyed(
        &app,
        "Preparing the OpenClaw update...",
        "setup.openclawUpdate.progress.preparing",
        0.02,
    );
    let detected = system::detect_openclaw().await;
    if !detected.installed {
        let error = "OpenClaw is not installed".to_string();
        emit_update_error(&app, &error, Some(0.28));
        return Err(error);
    }
    let binary = match system::resolve_openclaw_binary_async().await {
        Some(binary) => binary,
        None => {
            let error = "OpenClaw executable was not found".to_string();
            emit_update_error(&app, &error, Some(0.28));
            return Err(error);
        }
    };
    let mut node = match ensure_update_node_runtime(&app, &binary).await {
        Ok(node) => node,
        Err(error) => {
            emit_update_error(&app, &error, Some(0.28));
            return Err(error);
        }
    };
    let mut runtime = system::native_openclaw_runtime(binary.clone(), &node)?;
    emit_update_progress_keyed(
        &app,
        &format!("OpenClaw binary: {}", system::path_for_display(&binary)),
        "setup.openclawUpdate.progress.binary",
        0.34,
    );
    emit_update_progress_keyed(
        &app,
        "Resolving the target OpenClaw runtime contract...",
        "setup.openclawUpdate.progress.targetContract",
        0.36,
    );
    let node_path = node
        .path
        .as_deref()
        .map(std::path::Path::new)
        .ok_or("The selected Node.js runtime did not report an executable path")?;
    // Probe before taking the managed Gateway down so source negotiation and
    // Node compatibility never lengthen its maintenance window.
    let policy = npm_registry::resolve_effective_npm_registry_policy(node_path).await?;
    let (dry_run_output, metadata_source) =
        run_npm_update_dry_run_with_registry_fallback(&runtime, policy.sources()).await?;
    let dry_run_output = match dry_run_output {
        output if output.status.success() => output,
        output => {
            let error = output_diagnostic(&output).unwrap_or_else(|| {
                format!("OpenClaw update dry-run exited with {}", output.status)
            });
            emit_update_error(&app, &error, Some(0.38));
            return Err(error);
        }
    };
    let dry_run_status = match parse_dry_run_update_status(&dry_run_output.stdout) {
        Ok(status) => status,
        Err(error) => {
            emit_update_error(&app, &error, Some(0.38));
            return Err(error);
        }
    };
    let target_contract =
        match resolve_update_target_contract(&dry_run_status, &metadata_source).await {
            Ok(contract) => contract,
            Err(error) => {
                emit_update_error(&app, &error, Some(0.38));
                return Err(error);
            }
        };
    if let Some(target) = target_contract.as_ref() {
        emit_update_progress_keyed(
            &app,
            &format!(
                "Target OpenClaw requires Node.js {}; validating update runtime...",
                target.node_requirement.expression()
            ),
            "setup.openclawUpdate.progress.targetNode",
            0.38,
        );
        node = setup::ensure_compatible_node_runtime(
            &app,
            UPDATE_PROGRESS_STEP,
            &target.node_requirement,
        )
        .await?;
        runtime = system::native_openclaw_runtime(binary.clone(), &node)?;
    }
    emit_update_progress_keyed(
        &app,
        "Stopping the managed Gateway if necessary...",
        "setup.openclawUpdate.progress.stoppingGateway",
        0.45,
    );
    let restore_gateway = stop_managed_gateway(&state).await?;

    // The update itself must use the exact source that supplied both the
    // dry-run target and its engines.node contract. Retrying a different
    // registry here would invalidate that preflight decision.
    let selected_source = metadata_source;
    let output = run_openclaw_command_streaming(
        &app,
        &runtime,
        &["update", "--yes", "--no-restart", "--json"],
        UPDATE_TIMEOUT,
        Some(&selected_source),
    )
    .await;

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
        result.npm_registry = selected_source
            .public_registry()
            .map(|registry| registry.url.to_string());
        result.npm_registry_kind = selected_source
            .public_registry()
            .map(|registry| registry.kind);
    }

    let mut updated_runtime = None;
    if result.success {
        match validate_updated_runtime_contract(&app, &binary, target_contract.as_ref()).await {
            Ok(runtime) => updated_runtime = Some(runtime),
            Err(error) => mark_update_failure(
                &mut result,
                format!("OpenClaw package was updated but runtime validation failed: {error}"),
            ),
        }
    }
    if result.success && result.mode.as_deref() == Some("npm") && target_contract.is_none() {
        mark_update_failure(
            &mut result,
            "OpenClaw performed an npm package update without a validated target contract",
        );
    }
    if result.success && paths::terminal_integration_requested() {
        match updated_runtime.as_ref() {
            Some(runtime) => {
                if let Err(error) = crate::commands::terminal_integration::sync_terminal_integration_with_native_runtime(runtime) {
                    mark_update_failure(
                        &mut result,
                        format!("OpenClaw was updated, but the terminal launcher could not be rebuilt: {error}"),
                    );
                }
            }
            None => mark_update_failure(
                &mut result,
                "OpenClaw was updated, but its terminal runtime could not be rebuilt",
            ),
        }
    }

    emit_update_progress_keyed(
        &app,
        "Restoring the Gateway...",
        "setup.openclawUpdate.progress.restoringGateway",
        0.88,
    );
    match restore_managed_gateway(app.clone(), state.clone(), restore_gateway).await {
        Ok(restarted) => {
            result.gateway_restarted = restarted;
            if restore_gateway && !restarted {
                let error = "Gateway did not report ready after the OpenClaw update".to_string();
                result.gateway_error = Some(error.clone());
                if result.success {
                    mark_update_failure(
                        &mut result,
                        format!("OpenClaw was updated, but Gateway recovery failed: {error}"),
                    );
                }
            }
        }
        Err(error) => {
            result.gateway_error = Some(error.clone());
            if result.success {
                mark_update_failure(
                    &mut result,
                    format!("OpenClaw was updated, but Gateway recovery failed: {error}"),
                );
            }
        }
    }

    let refreshed = system::detect_openclaw().await;
    if let Some(version) = refreshed.version {
        result.after_version = Some(version);
    }
    if result.success {
        setup_progress::emit_completed_keyed(
            &app,
            UPDATE_PROGRESS_STEP,
            "OpenClaw update completed",
            "setup.openclawUpdate.progress.updated",
        );
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
    use crate::commands::npm_registry::NpmRegistry;

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
        let source = NpmPackageSource::public(mirror);
        let status = update_status_from_npm_dry_run(dry_run, None, &source);

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
    fn update_stream_reports_download_details_with_incrementing_progress() {
        let tracker = UpdateStreamProgress::new();
        let first = tracker.observe(
            "npm http fetch GET 200 https://registry.npmmirror.com/openclaw/-/openclaw.tgz 350ms",
        );
        let second = tracker.observe(
            "npm http fetch GET 200 https://registry.npmmirror.com/dependency/-/dependency.tgz 90ms",
        );

        assert_eq!(first.entered_phase, Some(UpdateStreamPhase::Downloading));
        assert!(first.progress > 0.62);
        assert!(second.entered_phase.is_none());
        assert!(second.progress > first.progress);
    }

    #[test]
    fn update_stream_advances_through_installation_phases_without_regressing() {
        let tracker = UpdateStreamProgress::new();
        let resolving = tracker.observe("npm http cache openclaw@https://registry.npmmirror.com");
        let extracting = tracker.observe("npm verb reify unpack OpenClaw package tree");
        let scripts = tracker.observe("npm info run openclaw@2026.7.1 postinstall");
        let verifying = tracker.observe("changed 1 package in 8s");
        let late_download = tracker.observe("npm http fetch GET 200 a-late-request 5ms");

        assert_eq!(resolving.entered_phase, Some(UpdateStreamPhase::Resolving));
        assert_eq!(
            extracting.entered_phase,
            Some(UpdateStreamPhase::Extracting)
        );
        assert_eq!(
            scripts.entered_phase,
            Some(UpdateStreamPhase::RunningScripts)
        );
        assert_eq!(verifying.entered_phase, Some(UpdateStreamPhase::Verifying));
        assert!(resolving.progress < extracting.progress);
        assert!(extracting.progress < scripts.progress);
        assert!(scripts.progress < verifying.progress);
        assert_eq!(late_download.progress, verifying.progress);
        assert!(late_download.entered_phase.is_none());
    }

    #[test]
    fn unknown_update_output_keeps_the_current_progress() {
        let tracker = UpdateStreamProgress::new();
        let initial = tracker.observe("OpenClaw updater started");
        let download = tracker.observe("Downloading package tarball");
        let unknown = tracker.observe("still working");

        assert_eq!(initial.progress, 0.55);
        assert_eq!(unknown.progress, download.progress);
        assert!(unknown.entered_phase.is_none());
    }
}
