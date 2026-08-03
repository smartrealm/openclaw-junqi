//! Official OpenClaw Gateway service ownership and lifecycle operations.
//!
//! Service mutations are permitted only after the official status document
//! identifies the same state directory JunQi currently selected.

use crate::{commands::system, paths, platform, state::GatewayProcess};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::State;

const fn service_command_timeout_for_platform(is_windows: bool) -> Duration {
    Duration::from_secs(if is_windows { 60 } else { 30 })
}

const SERVICE_COMMAND_TIMEOUT: Duration = service_command_timeout_for_platform(cfg!(windows));
const SERVICE_COMMAND_STDOUT_LIMIT: usize = 512 * 1024;
const SERVICE_COMMAND_STDERR_LIMIT: usize = 128 * 1024;
#[cfg(any(windows, test))]
const WINDOWS_GATEWAY_TASK_NAME: &str = "OpenClaw Gateway";

/// Read-only evidence available without an OpenClaw executable. It is used
/// only to decide whether an interrupted Native setup is safe to resume; a
/// present or uninspectable artifact is never mutated through this path.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GatewayServiceArtifactPresence {
    Absent,
    Present,
    Unverifiable,
}

#[cfg(any(windows, test))]
fn windows_task_name_matches(raw: &str) -> bool {
    windows_task_name_matches_expected(raw, WINDOWS_GATEWAY_TASK_NAME)
}

#[cfg(any(windows, test))]
fn windows_task_name_matches_expected(raw: &str, expected: &str) -> bool {
    let name = raw.trim().trim_matches('"').trim_start_matches(['\\', '/']);
    let expected = expected
        .trim()
        .trim_matches('"')
        .trim_start_matches(['\\', '/']);
    if name.eq_ignore_ascii_case(expected) {
        return true;
    }
    // OpenClaw's default profile may append a profile suffix to the shared
    // task name. A caller-provided task name is an exact identity and must not
    // match a sibling task by prefix.
    expected.eq_ignore_ascii_case(WINDOWS_GATEWAY_TASK_NAME)
        && name
            .get(..expected.len())
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(expected))
        && name
            .get(expected.len()..)
            .is_some_and(|suffix| suffix.starts_with(" (") && suffix.ends_with(')'))
}

#[cfg(any(windows, test))]
fn first_windows_csv_field(line: &str) -> Option<String> {
    let mut chars = line.trim_start().chars().peekable();
    let mut value = String::new();
    if chars.peek() == Some(&'"') {
        chars.next();
        while let Some(character) = chars.next() {
            if character == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    value.push('"');
                } else {
                    return Some(value);
                }
            } else {
                value.push(character);
            }
        }
        return None;
    }
    for character in chars {
        if character == ',' {
            break;
        }
        value.push(character);
    }
    (!value.trim().is_empty()).then(|| value.trim().to_string())
}

#[cfg(any(windows, test))]
fn windows_task_list_contains_gateway(stdout: &[u8]) -> Result<bool, String> {
    windows_task_list_contains_named_task(stdout, WINDOWS_GATEWAY_TASK_NAME)
}

#[cfg(any(windows, test))]
fn windows_task_list_contains_named_task(stdout: &[u8], expected: &str) -> Result<bool, String> {
    // `schtasks` uses the active Windows console code page, not guaranteed
    // UTF-8. Decode only the first CSV field (the ASCII task name) so localized
    // status columns cannot turn a successful absence probe into mojibake.
    for raw_line in stdout.split(|byte| *byte == b'\n') {
        let raw_line = raw_line.strip_suffix(b"\r").unwrap_or(raw_line);
        if raw_line.is_empty() {
            continue;
        }
        let field_end = if raw_line.first() == Some(&b'"') {
            raw_line[1..]
                .iter()
                .position(|byte| *byte == b'"')
                .map(|index| index + 2)
                .ok_or_else(|| {
                    "Windows Scheduled Task CSV contained an unterminated task name".to_string()
                })?
        } else {
            raw_line
                .iter()
                .position(|byte| *byte == b',')
                .unwrap_or(raw_line.len())
        };
        let field = std::str::from_utf8(&raw_line[..field_end]).map_err(|error| {
            format!("Windows Scheduled Task name was not valid UTF-8/ASCII: {error}")
        })?;
        let task_name = first_windows_csv_field(field)
            .ok_or_else(|| "Windows Scheduled Task CSV did not contain a task name".to_string())?;
        if windows_task_name_matches_expected(&task_name, expected) {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(windows)]
fn windows_gateway_startup_entry_presence(expected_task_name: &str) -> Result<bool, String> {
    let app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(dirs::data_dir)
        .ok_or_else(|| "Windows APPDATA is unavailable".to_string())?;
    let startup = app_data.join("Microsoft/Windows/Start Menu/Programs/Startup");
    let entries = match std::fs::read_dir(&startup) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Could not inspect Windows Gateway login-item directory {}: {error}",
                startup.display()
            ))
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| {
            format!(
                "Could not inspect a Windows Gateway login item in {}: {error}",
                startup.display()
            )
        })?;
        let path = entry.path();
        let Some(extension) = path.extension() else {
            continue;
        };
        let Some(extension) = extension.to_str() else {
            return Err(format!(
                "A Windows login-item extension in {} could not be decoded safely",
                startup.display()
            ));
        };
        if !extension.eq_ignore_ascii_case("cmd") && !extension.eq_ignore_ascii_case("vbs") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                format!(
                    "A Windows command-script login-item name in {} could not be decoded safely",
                    startup.display()
                )
            })?;
        if windows_task_name_matches_expected(name, expected_task_name) {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Probe the selected official Windows task and OpenClaw's login-item fallback
/// without requiring the OpenClaw package. A failed exact query is followed by
/// a successful full task enumeration before absence is accepted, avoiding
/// locale-dependent parsing of `schtasks` error text.
#[cfg(windows)]
pub(crate) async fn inspect_gateway_service_artifacts_without_runtime(
) -> GatewayServiceArtifactPresence {
    use crate::commands::process_control::{run_command_output_confirmed, ControlledOutputLimits};

    let limits = ControlledOutputLimits {
        timeout: Duration::from_secs(15),
        stdout_bytes: 2 * 1024 * 1024,
        stderr_bytes: 128 * 1024,
    };
    let task_name = windows_gateway_task_name();
    let mut exact = tokio::process::Command::new("schtasks.exe");
    exact.args(["/Query", "/TN", task_name.as_str(), "/XML"]);
    match run_command_output_confirmed(exact, limits).await {
        Ok(output) if output.status.success() => return GatewayServiceArtifactPresence::Present,
        Ok(_) => {}
        Err(_) => return GatewayServiceArtifactPresence::Unverifiable,
    }

    let mut list = tokio::process::Command::new("schtasks.exe");
    list.args(["/Query", "/FO", "CSV", "/NH"]);
    let task_absent = match run_command_output_confirmed(list, limits).await {
        Ok(output) if output.status.success() => {
            match windows_task_list_contains_named_task(&output.stdout, &task_name) {
                Ok(true) => return GatewayServiceArtifactPresence::Present,
                Ok(false) => true,
                Err(_) => return GatewayServiceArtifactPresence::Unverifiable,
            }
        }
        _ => return GatewayServiceArtifactPresence::Unverifiable,
    };
    debug_assert!(task_absent);
    match windows_gateway_startup_entry_presence(&task_name) {
        Ok(true) => GatewayServiceArtifactPresence::Present,
        Ok(false) => GatewayServiceArtifactPresence::Absent,
        Err(_) => GatewayServiceArtifactPresence::Unverifiable,
    }
}

#[cfg(not(windows))]
pub(crate) async fn inspect_gateway_service_artifacts_without_runtime(
) -> GatewayServiceArtifactPresence {
    GatewayServiceArtifactPresence::Unverifiable
}

#[cfg(windows)]
fn windows_gateway_task_name() -> String {
    std::env::var("OPENCLAW_WINDOWS_TASK_NAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| WINDOWS_GATEWAY_TASK_NAME.to_string())
}

/// Check whether the selected OpenClaw Scheduled Task is registered without
/// interpreting localized error text. A successful exact query proves
/// registration; a successful full listing proves absence when the task name
/// is not present. Any command or decoding failure stays unverifiable.
#[cfg(windows)]
async fn windows_gateway_task_is_registered() -> Result<bool, String> {
    use crate::commands::process_control::{run_command_output_confirmed, ControlledOutputLimits};

    let limits = ControlledOutputLimits {
        timeout: Duration::from_secs(15),
        stdout_bytes: 2 * 1024 * 1024,
        stderr_bytes: 128 * 1024,
    };
    let task_name = windows_gateway_task_name();
    let mut exact = tokio::process::Command::new("schtasks.exe");
    exact.args(["/Query", "/TN", task_name.as_str(), "/XML"]);
    match run_command_output_confirmed(exact, limits).await {
        Ok(output) if output.status.success() => return Ok(true),
        Ok(_) => {}
        Err(error) => {
            return Err(format!(
                "Could not query the OpenClaw Scheduled Task registration: {error}"
            ));
        }
    }

    let mut list = tokio::process::Command::new("schtasks.exe");
    list.args(["/Query", "/FO", "CSV", "/NH"]);
    let output = run_command_output_confirmed(list, limits)
        .await
        .map_err(|error| format!("Could not list Windows Scheduled Tasks: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Windows Scheduled Task listing exited with {}",
            output.status
        ));
    }
    windows_task_list_contains_named_task(&output.stdout, &task_name)
        .map_err(|error| format!("Could not parse Windows Scheduled Task listing: {error}"))
}

#[cfg(windows)]
async fn run_windows_gateway_task() -> Result<(), String> {
    use crate::commands::process_control::{run_command_output_confirmed, ControlledOutputLimits};

    let task_name = windows_gateway_task_name();
    let args = ["/Run", "/TN", task_name.as_str()];
    let mut command = tokio::process::Command::new("schtasks.exe");
    command.args(args);
    let output = run_command_output_confirmed(
        command,
        ControlledOutputLimits {
            timeout: Duration::from_secs(15),
            stdout_bytes: 128 * 1024,
            stderr_bytes: 128 * 1024,
        },
    )
    .await
    .map_err(|error| format!("Could not start the OpenClaw Scheduled Task: {error}"))?;
    command_success(&output, &args)
}

#[cfg(windows)]
async fn stop_windows_gateway_before_task_run(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
) -> Result<(), String> {
    // OpenClaw's official Windows stop path tolerates an already stopped task,
    // terminates listeners left behind by a failed task transition, and waits
    // for the configured port to be released. Reuse that cleanup contract
    // before a direct /Run so a second process cannot race the old listener.
    let args = ["gateway", "stop"];
    let output = run_service_command(runtime, identity, search_path, &args).await?;
    command_success(&output, &args)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GatewayServiceOwnership {
    Absent,
    SelectedState,
    StaleRuntime,
    StaleLocale,
    Foreign,
    Unverifiable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GatewayServiceInspection {
    pub ownership: GatewayServiceOwnership,
    pub installed: bool,
    pub running: bool,
    /// `false` when the platform service adapter returned an unknown or
    /// locale-dependent runtime state. A missing/unknown state must never be
    /// treated as stopped before a lifecycle mutation.
    pub runtime_known: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAutostartStatus {
    pub supported: bool,
    pub enabled: bool,
    pub running: bool,
    pub service_kind: GatewayAutostartServiceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayAutostartServiceKind {
    MacosLaunchAgent,
    WindowsScheduledTask,
    NativeService,
}

fn gateway_autostart_service_kind_for_os(os: &str) -> GatewayAutostartServiceKind {
    match os {
        "macos" => GatewayAutostartServiceKind::MacosLaunchAgent,
        "windows" => GatewayAutostartServiceKind::WindowsScheduledTask,
        _ => GatewayAutostartServiceKind::NativeService,
    }
}

fn gateway_autostart_service_kind() -> GatewayAutostartServiceKind {
    gateway_autostart_service_kind_for_os(std::env::consts::OS)
}

fn unsupported_gateway_autostart_status() -> GatewayAutostartStatus {
    GatewayAutostartStatus {
        supported: false,
        enabled: false,
        running: false,
        service_kind: gateway_autostart_service_kind(),
    }
}

fn selected_service_autostart_status(
    inspection: GatewayServiceInspection,
) -> GatewayAutostartStatus {
    let enabled = belongs_to_selected_state(inspection.ownership) && inspection.installed;
    GatewayAutostartStatus {
        supported: true,
        enabled,
        running: enabled && is_running_selected_service(inspection),
        service_kind: gateway_autostart_service_kind(),
    }
}

async fn selected_native_service_context(
) -> Result<(system::NativeOpenclawRuntime, PathBuf, PathBuf), String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Err("Gateway autostart requires the Native runtime".to_string());
    }
    let runtime = system::resolve_compatible_native_openclaw_runtime().await?;
    Ok((runtime, paths::desktop_dir(), paths::active_config_path()))
}

/// Stop the selected Native service before its package tree is replaced.
///
/// Reinstalling runs `npm install -g` over the very package the running service
/// executes from. On Windows the live process locks those files, so the install
/// can fail or leave a half-replaced tree that still passes a shallow validity
/// check; on Unix the old inode survives until a later restart silently swaps
/// in new code. OpenClaw itself avoids this shape - `update.run` hands off to a
/// detached managed service rather than rewriting a live package tree.
///
/// Returns whether a service was actually stopped. Docker is not an error: its
/// gateway does not run from the host npm prefix, so nothing needs stopping.
pub(crate) async fn stop_selected_native_service_for_reinstall() -> Result<bool, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Ok(false);
    }
    let Ok(runtime) = system::resolve_compatible_native_openclaw_runtime().await else {
        // No usable runtime means no service of ours is running from it. A
        // broken install is exactly the case a repair reinstall must handle.
        return Ok(false);
    };
    stop_selected_gateway_service(
        &runtime,
        &paths::desktop_dir(),
        &paths::active_config_path(),
        None,
    )
    .await
}

/// Re-attest the official service that belongs to JunQi's selected Native
/// state/config. A healthy endpoint alone cannot distinguish that service from
/// an unrelated local Gateway that happens to use the same port.
pub(crate) async fn inspect_selected_native_gateway_service(
) -> Result<GatewayServiceInspection, String> {
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    let identity = GatewayServiceIdentity::for_runtime(&state_dir, &config_path, &runtime);
    inspect_gateway_service_state(&runtime, &identity, None).await
}

#[tauri::command]
pub async fn gateway_autostart_status() -> Result<GatewayAutostartStatus, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Ok(unsupported_gateway_autostart_status());
    }
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    let identity = GatewayServiceIdentity::for_runtime(&state_dir, &config_path, &runtime);
    let inspection = inspect_gateway_service_state(&runtime, &identity, None).await?;
    Ok(selected_service_autostart_status(inspection))
}

#[tauri::command]
pub async fn enable_gateway_autostart(
    state: State<'_, GatewayProcess>,
) -> Result<GatewayAutostartStatus, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    let port = crate::commands::gateway::gateway_port_for_config(&config_path);
    install_selected_gateway_service(&runtime, &state_dir, &config_path, port).await?;
    let identity = GatewayServiceIdentity::for_runtime(&state_dir, &config_path, &runtime);
    let inspection = inspect_gateway_service_state(&runtime, &identity, None).await?;
    let status = selected_service_autostart_status(inspection);
    if !status.enabled {
        return Err("Gateway service was installed but could not be verified for the selected OpenClaw state directory".to_string());
    }
    // Persist intent only after the official service has been installed and
    // re-attested for this selected runtime/config. A failed install must not
    // cause a later launch to recreate an unverified service.
    paths::save_gateway_lifecycle_preference(paths::GatewayLifecyclePreference::SystemService)?;
    Ok(status)
}

#[tauri::command]
pub async fn disable_gateway_autostart(
    state: State<'_, GatewayProcess>,
) -> Result<GatewayAutostartStatus, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Ok(unsupported_gateway_autostart_status());
    }
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    uninstall_selected_gateway_service(&runtime, &state_dir, &config_path, None).await?;
    // Commit DesktopManaged only after official uninstall postconditions pass.
    // This preserves SystemService intent if uninstall fails midway.
    paths::save_gateway_lifecycle_preference(paths::GatewayLifecyclePreference::DesktopManaged)?;
    Ok(GatewayAutostartStatus {
        supported: true,
        enabled: false,
        running: false,
        service_kind: gateway_autostart_service_kind(),
    })
}

/// The complete identity of the official service selected by JunQi.
///
/// OpenClaw's platform service name is shared across invocations. State and
/// config therefore have to match before JunQi may mutate that service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GatewayServiceIdentity {
    state_dir: PathBuf,
    config_path: PathBuf,
    runtime: Option<system::NativeOpenclawRuntimeIdentity>,
    locale: Option<String>,
}

impl GatewayServiceIdentity {
    #[cfg(test)]
    pub(crate) fn new(state_dir: &Path, config_path: &Path) -> Self {
        Self {
            state_dir: state_dir.to_path_buf(),
            config_path: config_path.to_path_buf(),
            runtime: None,
            locale: None,
        }
    }

    pub(crate) fn for_runtime(
        state_dir: &Path,
        config_path: &Path,
        runtime: &system::NativeOpenclawRuntime,
    ) -> Self {
        Self {
            state_dir: state_dir.to_path_buf(),
            config_path: config_path.to_path_buf(),
            runtime: Some(runtime.identity()),
            locale: Some(system::configured_openclaw_locale(config_path)),
        }
    }

    pub(crate) fn command_context(
        &self,
        search_path: Option<&str>,
    ) -> system::OpenclawCommandContext {
        let context = system::OpenclawCommandContext::for_paths(
            self.state_dir.clone(),
            self.config_path.clone(),
        );
        match search_path {
            Some(path) => context.with_search_path(path),
            None => context,
        }
    }
}

#[derive(Debug, Deserialize)]
struct GatewayStatusDocument {
    service: Option<GatewayServiceDocument>,
    config: Option<GatewayConfigDocument>,
}

#[derive(Debug, Deserialize)]
struct GatewayServiceDocument {
    command: Option<GatewayServiceCommand>,
    installed: Option<bool>,
    loaded: Option<bool>,
    runtime: Option<GatewayRuntimeDocument>,
    #[serde(rename = "sourcePath")]
    source_path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GatewayConfigDocument {
    cli: Option<GatewayConfigPath>,
    daemon: Option<GatewayConfigPath>,
}

#[derive(Debug, Deserialize)]
struct GatewayConfigPath {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GatewayRuntimeDocument {
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayServiceCommand {
    environment: Option<HashMap<String, String>>,
    program_arguments: Option<Vec<String>>,
    working_directory: Option<String>,
    source_path: Option<String>,
}

fn parse_gateway_status(output: &[u8]) -> Result<GatewayStatusDocument, String> {
    let text = std::str::from_utf8(output)
        .map_err(|error| format!("OpenClaw service status was not UTF-8: {error}"))?;
    let start = text
        .find('{')
        .ok_or_else(|| "OpenClaw service status did not return JSON".to_string())?;
    let end = text
        .rfind('}')
        .ok_or_else(|| "OpenClaw service status returned incomplete JSON".to_string())?;
    serde_json::from_str(&text[start..=end])
        .map_err(|error| format!("OpenClaw service status JSON was invalid: {error}"))
}

fn declared_environment<'a>(
    environment: &'a HashMap<String, String>,
    key: &str,
) -> Option<&'a str> {
    environment
        .iter()
        .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
        .map(|(_, value)| value.trim())
        .filter(|value| !value.is_empty())
}

fn declared_path(raw: &str) -> Option<PathBuf> {
    let raw = raw.trim().trim_matches(['"', '\'']);
    if raw.is_empty() {
        return None;
    }
    Some(if raw == "~" {
        platform::home_dir().unwrap_or_else(|| PathBuf::from(raw))
    } else if raw.starts_with("~/") || raw.starts_with("~\\") {
        platform::home_dir()
            .map(|home| home.join(raw[2..].trim_start_matches(['/', '\\'])))
            .unwrap_or_else(|| PathBuf::from(raw))
    } else {
        PathBuf::from(raw)
    })
}

fn path_matches_identity(raw: &str, expected: &Path) -> bool {
    declared_path(raw)
        .is_some_and(|candidate| paths::paths_refer_to_same_location(&candidate, expected))
}

fn path_is_inside(raw: &str, expected_root: &Path) -> bool {
    let Some(mut candidate) = declared_path(raw) else {
        return false;
    };
    loop {
        if paths::paths_refer_to_same_location(&candidate, expected_root) {
            return true;
        }
        let Some(parent) = candidate.parent() else {
            return false;
        };
        if parent == candidate {
            return false;
        }
        candidate = parent.to_path_buf();
    }
}

fn command_matches_runtime(
    command: &GatewayServiceCommand,
    expected: &system::NativeOpenclawRuntimeIdentity,
) -> Option<bool> {
    let arguments = command.program_arguments.as_ref()?;
    let program = arguments.first()?;
    if let Some(node) = expected.node.as_deref() {
        if !path_matches_identity(program, node) {
            return Some(false);
        }
        let package_dir = expected.package_dir.as_deref()?;
        return Some(
            arguments
                .iter()
                .skip(1)
                .any(|argument| path_is_inside(argument, package_dir)),
        );
    }
    if let Some(executable) = expected.executable.as_deref() {
        return Some(path_matches_identity(program, executable));
    }
    None
}

fn status_config_path(document: &GatewayStatusDocument) -> Option<&str> {
    document
        .config
        .as_ref()
        .and_then(|config| config.daemon.as_ref().or(config.cli.as_ref()))
        .and_then(|path| path.path.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty())
}

fn classify_service_ownership(
    document: &GatewayStatusDocument,
    identity: &GatewayServiceIdentity,
) -> GatewayServiceOwnership {
    let Some(service) = document.service.as_ref() else {
        return GatewayServiceOwnership::Absent;
    };
    let command = service.command.as_ref();
    let environment = command.and_then(|command| command.environment.as_ref());
    let environment_state_dir =
        environment.and_then(|environment| declared_environment(environment, "OPENCLAW_STATE_DIR"));
    let working_directory = command
        .and_then(|command| command.working_directory.as_deref())
        .map(str::trim)
        .filter(|path| !path.is_empty());
    // OpenClaw's official cross-platform service command contract includes both
    // environment and workingDirectory. Prefer the explicit state selector,
    // but reject contradictory metadata rather than choosing one. Older or
    // wrapper-backed services may expose only workingDirectory; it is accepted
    // only together with the independently checked config and runtime below.
    if environment_state_dir.is_some()
        && working_directory.is_some()
        && !path_matches_identity(working_directory.unwrap(), &identity.state_dir)
    {
        return GatewayServiceOwnership::Foreign;
    }
    let Some(service_state_dir) = environment_state_dir.or(working_directory) else {
        return GatewayServiceOwnership::Unverifiable;
    };
    let environment_config_path =
        environment.and_then(|values| declared_environment(values, "OPENCLAW_CONFIG_PATH"));
    let reported_config_path = status_config_path(document);
    // The explicit service selector and OpenClaw's daemon config summary are
    // independent official evidence. Contradiction is identity drift, not a
    // reason to prefer whichever field happens to be parsed first.
    if environment_config_path.is_some()
        && reported_config_path.is_some()
        && !path_matches_identity(reported_config_path.unwrap(), &identity.config_path)
    {
        return GatewayServiceOwnership::Foreign;
    }
    let Some(service_config_path) = environment_config_path.or(reported_config_path) else {
        return GatewayServiceOwnership::Unverifiable;
    };

    if !path_matches_identity(service_state_dir, &identity.state_dir)
        || !path_matches_identity(service_config_path, &identity.config_path)
    {
        return GatewayServiceOwnership::Foreign;
    }
    match identity.runtime.as_ref() {
        None => GatewayServiceOwnership::SelectedState,
        Some(runtime) => match service
            .command
            .as_ref()
            .and_then(|command| command_matches_runtime(command, runtime))
        {
            Some(true) => match identity.locale.as_deref() {
                Some(expected) => match environment
                    .and_then(|environment| declared_environment(environment, "OPENCLAW_LOCALE"))
                {
                    Some(actual) if actual.eq_ignore_ascii_case(expected) => {
                        GatewayServiceOwnership::SelectedState
                    }
                    _ => GatewayServiceOwnership::StaleLocale,
                },
                None => GatewayServiceOwnership::SelectedState,
            },
            Some(false) => GatewayServiceOwnership::StaleRuntime,
            None => GatewayServiceOwnership::Unverifiable,
        },
    }
}

fn inspect_document(
    document: GatewayStatusDocument,
    identity: &GatewayServiceIdentity,
) -> GatewayServiceInspection {
    let Some(service) = document.service.as_ref() else {
        return GatewayServiceInspection {
            ownership: GatewayServiceOwnership::Absent,
            installed: false,
            running: false,
            runtime_known: true,
        };
    };
    let installed = service.installed.unwrap_or(
        service.command.is_some()
            || service.source_path.is_some()
            || service
                .command
                .as_ref()
                .and_then(|command| command.source_path.as_ref())
                .is_some(),
    );
    let (running, runtime_known) = match service
        .runtime
        .as_ref()
        .and_then(|runtime| runtime.status.as_deref())
    {
        Some(status) if status.eq_ignore_ascii_case("running") => (true, true),
        Some(status) if status.eq_ignore_ascii_case("stopped") => (false, true),
        // OpenClaw reports `unknown` when Windows cannot derive a numeric
        // Scheduled Task result from localized `schtasks` output. Preserve a
        // conservative running bit for existing callers, but block lifecycle
        // actions until a known state is available.
        Some(_) => (service.loaded.unwrap_or(true), false),
        None => (service.loaded.unwrap_or(false), false),
    };
    let ownership = classify_service_ownership(&document, identity);
    GatewayServiceInspection {
        ownership,
        installed,
        running,
        runtime_known,
    }
}

pub(crate) fn belongs_to_selected_state(ownership: GatewayServiceOwnership) -> bool {
    matches!(
        ownership,
        GatewayServiceOwnership::SelectedState
            | GatewayServiceOwnership::StaleRuntime
            | GatewayServiceOwnership::StaleLocale
    )
}

fn service_uninstall_is_permitted(inspection: GatewayServiceInspection) -> bool {
    inspection.installed && belongs_to_selected_state(inspection.ownership)
}

pub(crate) fn is_running_selected_service(inspection: GatewayServiceInspection) -> bool {
    inspection.installed && inspection.running && belongs_to_selected_state(inspection.ownership)
}

/// A lifecycle operation may use a stale-but-owned service as a mutation
/// target so it can be rebuilt safely. Restart success is stricter: the
/// postcondition must prove that the service now matches the current runtime,
/// not merely that it still belongs to the selected state directory.
pub(crate) fn is_running_current_selected_service(inspection: GatewayServiceInspection) -> bool {
    inspection.installed
        && inspection.runtime_known
        && inspection.running
        && matches!(inspection.ownership, GatewayServiceOwnership::SelectedState)
}

#[cfg(any(windows, test))]
fn windows_task_start_requires_cleanup(inspection: GatewayServiceInspection) -> bool {
    belongs_to_selected_state(inspection.ownership)
        && inspection.installed
        && (!inspection.runtime_known || !inspection.running)
}

async fn run_service_command(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
    args: &[&str],
) -> Result<std::process::Output, String> {
    run_service_command_with_timeout(
        runtime,
        identity,
        search_path,
        args,
        SERVICE_COMMAND_TIMEOUT,
    )
    .await
}

async fn run_service_command_with_timeout(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    run_service_command_controlled(runtime, identity, search_path, args, timeout)
        .await
        .map_err(|error| format_service_command_error(args, &error))
}

async fn run_service_command_controlled(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, crate::commands::process_control::ControlledOutputError> {
    let context = identity.command_context(search_path);
    let mut command = runtime.command(&context);
    command.args(args);
    crate::commands::process_control::run_command_output_confirmed(
        command,
        crate::commands::process_control::ControlledOutputLimits {
            timeout,
            stdout_bytes: SERVICE_COMMAND_STDOUT_LIMIT,
            stderr_bytes: SERVICE_COMMAND_STDERR_LIMIT,
        },
    )
    .await
}

fn format_service_command_error(
    args: &[&str],
    error: &crate::commands::process_control::ControlledOutputError,
) -> String {
    if error.is_timeout() && error.cleanup_confirmed() {
        format!(
            "OpenClaw service command timed out and its process tree was cleaned before continuing: {} ({error})",
            args.join(" ")
        )
    } else if !error.cleanup_confirmed() {
        format!(
            "OpenClaw service command failed and process-tree cleanup could not be confirmed: {} ({error})",
            args.join(" ")
        )
    } else {
        format!("Failed to run OpenClaw service command: {error}")
    }
}

fn command_success(output: &std::process::Output, args: &[&str]) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("OpenClaw service command exited with {}", output.status)
    } else {
        format!("OpenClaw {} failed: {stderr}", args.join(" "))
    })
}

fn service_status_args() -> [&'static str; 4] {
    ["gateway", "status", "--json", "--no-probe"]
}

/// OpenClaw returns a useful JSON service document even when the configured
/// Gateway endpoint is offline, and the CLI may use a non-zero exit status for
/// that expected condition. Parse the document before interpreting the exit
/// code so an offline/absent service cannot block a foreground Gateway start.
fn parse_service_status_output(
    output: &std::process::Output,
    args: &[&str],
) -> Result<GatewayStatusDocument, String> {
    match parse_gateway_status(&output.stdout) {
        Ok(document) => Ok(document),
        Err(parse_error) => {
            command_success(output, args)?;
            Err(parse_error)
        }
    }
}

pub(crate) async fn inspect_gateway_service_state(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
) -> Result<GatewayServiceInspection, String> {
    let args = service_status_args();
    let output = run_service_command(runtime, identity, search_path, &args).await?;
    parse_service_status_output(&output, &args).map(|document| inspect_document(document, identity))
}

pub(crate) async fn stop_selected_gateway_service_verified(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
    inspection: GatewayServiceInspection,
) -> Result<bool, String> {
    if !inspection.installed
        || !inspection.running
        || !belongs_to_selected_state(inspection.ownership)
    {
        return Ok(false);
    }
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
    let args = ["gateway", "stop"];
    let output = run_service_command(runtime, &identity, search_path, &args).await?;
    command_success(&output, &args)?;
    Ok(true)
}

/// Stop an installed selected service even when the platform status parser
/// cannot classify its localized runtime state. Ownership and installation are
/// authoritative for mutation; the caller separately verifies port release.
/// Whether this service may be stopped on our behalf. Ownership plus an actual
/// installation are the authoritative conditions; running state is deliberately
/// excluded because localized platform status output cannot always be parsed.
pub(crate) fn stop_is_permitted_for_reinstall(inspection: GatewayServiceInspection) -> bool {
    inspection.installed && belongs_to_selected_state(inspection.ownership)
}

pub(crate) async fn stop_installed_selected_gateway_service_verified(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
    inspection: GatewayServiceInspection,
) -> Result<bool, String> {
    if !stop_is_permitted_for_reinstall(inspection) {
        return Ok(false);
    }
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
    let args = ["gateway", "stop"];
    let output = run_service_command(runtime, &identity, search_path, &args).await?;
    command_success(&output, &args)?;
    Ok(true)
}

pub(crate) async fn stop_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> Result<bool, String> {
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
    let inspection = inspect_gateway_service_state(runtime, &identity, search_path).await?;
    stop_installed_selected_gateway_service_verified(
        runtime,
        state_dir,
        config_path,
        search_path,
        inspection,
    )
    .await
}

/// Remove the official Gateway service only after its persisted state/config
/// identity has been verified as JunQi-owned. OpenClaw uses a shared service
/// name, so invoking `gateway uninstall` without this preflight could delete a
/// user's unrelated installation during desktop uninstall.
pub(crate) async fn uninstall_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> Result<bool, String> {
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
    let inspection = inspect_gateway_service_state(runtime, &identity, search_path).await?;
    if !service_uninstall_is_permitted(inspection) {
        return Ok(false);
    }

    // Legacy bootstraps predate lifecycle intent. Once an installed official
    // service has been positively attested to the selected identity, preserve
    // that observed lifecycle before removing the app-owned artifact. This is
    // not inferred from a platform label or port, and an explicit
    // DesktopManaged choice is never overwritten.
    if matches!(
        paths::gateway_lifecycle_preference(),
        paths::GatewayLifecyclePreference::Unknown
    ) {
        paths::save_gateway_lifecycle_preference(paths::GatewayLifecyclePreference::SystemService)?;
    }

    let port = crate::commands::gateway::gateway_port_for_config(config_path);
    let uninstall_args = ["gateway", "uninstall", "--json"];
    // OpenClaw 2026.7.1-2 owns stop-before-uninstall and verifies that the
    // service is no longer loaded before returning success. Starting separate
    // stop and post-status CLI processes here duplicated that lifecycle and
    // made NSIS appear stalled. The selected identity was already attested by
    // the status preflight above; JunQi retains an independent port postcondition
    // because the official stop step is best-effort before artifact removal.
    let uninstall = run_service_command(runtime, &identity, search_path, &uninstall_args).await?;
    command_success(&uninstall, &uninstall_args)?;

    crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000)
        .await
        .map_err(|error| {
            format!(
                "The selected Gateway service was removed, but its configured port {port} was not released: {error}"
            )
        })?;
    Ok(true)
}

pub(crate) async fn install_and_start_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    port: u16,
) -> Result<(), String> {
    install_selected_gateway_service(runtime, state_dir, config_path, port).await?;
    start_selected_gateway_service(runtime, state_dir, config_path).await
}

pub(crate) async fn install_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    port: u16,
) -> Result<(), String> {
    install_selected_gateway_service_with_path(runtime, state_dir, config_path, port, None).await
}

pub(crate) async fn install_selected_gateway_service_with_path(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    port: u16,
    search_path: Option<&str>,
) -> Result<(), String> {
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
    let port = port.to_string();
    let install_args = ["gateway", "install", "--force", "--port", port.as_str()];
    let install = run_service_command(runtime, &identity, search_path, &install_args).await?;
    command_success(&install, &install_args)
}

pub(crate) async fn start_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
) -> Result<(), String> {
    start_selected_gateway_service_with_path(runtime, state_dir, config_path, None).await
}

pub(crate) async fn start_selected_gateway_service_with_path(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> Result<(), String> {
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);

    #[cfg(windows)]
    {
        let inspection = inspect_gateway_service_state(runtime, &identity, search_path).await?;
        if windows_task_start_requires_cleanup(inspection) {
            if windows_gateway_task_is_registered().await? {
                stop_windows_gateway_before_task_run(runtime, &identity, search_path).await?;
                return run_windows_gateway_task().await;
            }
        }
    }

    let start_args = ["gateway", "start"];
    let start = run_service_command(runtime, &identity, search_path, &start_args).await?;
    command_success(&start, &start_args)
}

/// Recreate the platform service with the selected Node/npm/config contract
/// while preserving whether it was running before the rebind.
pub(crate) async fn rebind_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    port: u16,
    was_running: bool,
    search_path: Option<&str>,
) -> Result<(), String> {
    install_selected_gateway_service_with_path(runtime, state_dir, config_path, port, search_path)
        .await?;
    if was_running {
        start_selected_gateway_service_with_path(runtime, state_dir, config_path, search_path).await
    } else {
        let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
        let args = ["gateway", "stop"];
        let output = run_service_command(runtime, &identity, search_path, &args).await?;
        command_success(&output, &args)
    }
}

/// Rebind a previously selected official service after storage or runtime
/// locations changed. The pending flag is persisted in bootstrap.json so a
/// dependency repair cannot accidentally leave a Scheduled Task pointing at
/// the old npm/Node/config location.
pub(crate) async fn reconcile_pending_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    port: u16,
    search_path: Option<&str>,
) -> Result<bool, String> {
    let Some(was_running) = paths::pending_gateway_service_rebind() else {
        return Ok(false);
    };
    rebind_selected_gateway_service(
        runtime,
        state_dir,
        config_path,
        port,
        was_running,
        search_path,
    )
    .await?;
    paths::complete_gateway_service_rebind()?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    // A reinstall replaces the package tree the service runs from. Only a
    // service we own and that is installed may be stopped for that; a foreign
    // or unverifiable service must be left alone even when it holds the port.
    #[test]
    fn only_an_owned_installed_service_is_stopped_before_reinstall() {
        for ownership in [
            GatewayServiceOwnership::SelectedState,
            GatewayServiceOwnership::StaleRuntime,
        ] {
            assert!(
                stop_is_permitted_for_reinstall(GatewayServiceInspection {
                    ownership,
                    installed: true,
                    running: true,
                    runtime_known: true,
                }),
                "owned service {ownership:?} should be stoppable"
            );
        }
        for ownership in [
            GatewayServiceOwnership::Foreign,
            GatewayServiceOwnership::Unverifiable,
            GatewayServiceOwnership::Absent,
        ] {
            assert!(
                !stop_is_permitted_for_reinstall(GatewayServiceInspection {
                    ownership,
                    installed: true,
                    running: true,
                    runtime_known: true,
                }),
                "{ownership:?} must never be stopped by our reinstall"
            );
        }
        assert!(
            !stop_is_permitted_for_reinstall(GatewayServiceInspection {
                ownership: GatewayServiceOwnership::SelectedState,
                installed: false,
                running: false,
                runtime_known: true,
            }),
            "an absent installation has nothing to stop"
        );
    }

    #[test]
    fn uninstall_requires_an_installed_selected_service() {
        for ownership in [
            GatewayServiceOwnership::SelectedState,
            GatewayServiceOwnership::StaleRuntime,
            GatewayServiceOwnership::StaleLocale,
        ] {
            assert!(service_uninstall_is_permitted(GatewayServiceInspection {
                ownership,
                installed: true,
                running: false,
                runtime_known: true,
            }));
        }
        for ownership in [
            GatewayServiceOwnership::Foreign,
            GatewayServiceOwnership::Unverifiable,
            GatewayServiceOwnership::Absent,
        ] {
            assert!(!service_uninstall_is_permitted(GatewayServiceInspection {
                ownership,
                installed: true,
                running: true,
                runtime_known: true,
            }));
        }
        assert!(!service_uninstall_is_permitted(GatewayServiceInspection {
            ownership: GatewayServiceOwnership::SelectedState,
            installed: false,
            running: false,
            runtime_known: true,
        }));
    }

    #[test]
    fn healthy_selected_service_is_a_durable_local_owner() {
        assert!(is_running_selected_service(GatewayServiceInspection {
            ownership: GatewayServiceOwnership::SelectedState,
            installed: true,
            running: true,
            runtime_known: true,
        }));
        assert!(is_running_selected_service(GatewayServiceInspection {
            ownership: GatewayServiceOwnership::StaleRuntime,
            installed: true,
            running: true,
            runtime_known: true,
        }));
        for ownership in [
            GatewayServiceOwnership::Foreign,
            GatewayServiceOwnership::Unverifiable,
            GatewayServiceOwnership::Absent,
        ] {
            assert!(!is_running_selected_service(GatewayServiceInspection {
                ownership,
                installed: true,
                running: true,
                runtime_known: true,
            }));
        }
        assert!(!is_running_selected_service(GatewayServiceInspection {
            ownership: GatewayServiceOwnership::SelectedState,
            installed: true,
            running: false,
            runtime_known: true,
        }));
    }

    #[test]
    fn restart_success_requires_current_runtime_identity() {
        assert!(is_running_current_selected_service(
            GatewayServiceInspection {
                ownership: GatewayServiceOwnership::SelectedState,
                installed: true,
                running: true,
                runtime_known: true,
            }
        ));
        for ownership in [
            GatewayServiceOwnership::StaleRuntime,
            GatewayServiceOwnership::StaleLocale,
            GatewayServiceOwnership::Foreign,
            GatewayServiceOwnership::Unverifiable,
            GatewayServiceOwnership::Absent,
        ] {
            assert!(!is_running_current_selected_service(
                GatewayServiceInspection {
                    ownership,
                    installed: true,
                    running: true,
                    runtime_known: true,
                }
            ));
        }
        assert!(!is_running_current_selected_service(
            GatewayServiceInspection {
                ownership: GatewayServiceOwnership::SelectedState,
                installed: true,
                running: true,
                runtime_known: false,
            }
        ));
    }

    #[test]
    fn windows_service_artifact_parser_matches_only_the_shared_gateway_task() {
        let tasks = br#""OpenClaw Gateway","N/A","Ready"
"OpenClaw Gateway (work)","N/A","Ready"
"Other Task","N/A","Ready""#;
        assert!(windows_task_list_contains_gateway(tasks).unwrap());
        assert!(
            windows_task_list_contains_gateway(br#""OpenClaw Gateway (work)","N/A","Ready""#)
                .unwrap()
        );
        assert!(windows_task_name_matches("\\OpenClaw Gateway"));
        assert!(windows_task_name_matches("OpenClaw Gateway (work)"));
        assert!(!windows_task_name_matches("OpenClaw Gateway helper"));
    }

    #[test]
    fn windows_task_name_override_is_an_exact_identity() {
        assert!(windows_task_name_matches_expected(
            "\\JunQi OpenClaw Gateway",
            "JunQi OpenClaw Gateway"
        ));
        assert!(!windows_task_name_matches_expected(
            "JunQi OpenClaw Gateway (work)",
            "JunQi OpenClaw Gateway"
        ));
        assert!(windows_task_name_matches_expected(
            "OpenClaw Gateway (work)",
            WINDOWS_GATEWAY_TASK_NAME
        ));
        assert!(!windows_task_name_matches_expected(
            "OpenClaw Gateway helper",
            WINDOWS_GATEWAY_TASK_NAME
        ));
        let tasks = br#""JunQi OpenClaw Gateway","N/A","Ready"
"OpenClaw Gateway","N/A","Ready""#;
        assert!(windows_task_list_contains_named_task(tasks, "JunQi OpenClaw Gateway").unwrap());
    }

    #[test]
    fn malformed_windows_task_output_is_not_accepted_as_absence() {
        assert!(windows_task_list_contains_gateway(&[0xff]).is_err());
        assert!(windows_task_list_contains_gateway(b"\"unterminated").is_err());
        assert_eq!(first_windows_csv_field("\"unterminated"), None);
    }

    #[test]
    fn localized_windows_task_columns_do_not_break_ascii_name_detection() {
        let tasks = b"\"Other Task\",\xff\xfe\r\n\"OpenClaw Gateway\",\x80\x81\r\n";
        assert!(windows_task_list_contains_gateway(tasks).unwrap());
    }

    #[test]
    fn windows_service_commands_allow_for_cold_cli_startup() {
        assert_eq!(
            service_command_timeout_for_platform(true),
            Duration::from_secs(60)
        );
        assert_eq!(
            service_command_timeout_for_platform(false),
            Duration::from_secs(30)
        );
    }

    #[test]
    fn windows_task_start_cleans_stopped_or_unknown_selected_runtime() {
        let stopped = GatewayServiceInspection {
            ownership: GatewayServiceOwnership::SelectedState,
            installed: true,
            running: false,
            runtime_known: true,
        };
        let unknown = GatewayServiceInspection {
            running: true,
            runtime_known: false,
            ..stopped
        };
        let running = GatewayServiceInspection {
            running: true,
            runtime_known: true,
            ..stopped
        };
        assert!(windows_task_start_requires_cleanup(stopped));
        assert!(windows_task_start_requires_cleanup(unknown));
        assert!(!windows_task_start_requires_cleanup(running));
        assert!(!windows_task_start_requires_cleanup(
            GatewayServiceInspection {
                ownership: GatewayServiceOwnership::Foreign,
                ..stopped
            }
        ));
    }

    fn status_output(success: bool, stdout: &[u8], stderr: &[u8]) -> std::process::Output {
        #[cfg(unix)]
        let status = {
            use std::os::unix::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(if success { 0 } else { 1 })
        };
        #[cfg(windows)]
        let status = {
            use std::os::windows::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(if success { 0 } else { 1 })
        };
        std::process::Output {
            status,
            stdout: stdout.to_vec(),
            stderr: stderr.to_vec(),
        }
    }

    fn classify(output: &[u8], identity: &GatewayServiceIdentity) -> GatewayServiceOwnership {
        let document = parse_gateway_status(output).unwrap();
        classify_service_ownership(&document, identity)
    }

    #[test]
    fn offline_status_json_is_usable_even_when_cli_exits_nonzero() {
        let output = status_output(false, br#"{"service":null}"#, b"Gateway is not reachable");
        let args = service_status_args();
        let document = parse_service_status_output(&output, &args).unwrap();
        assert!(document.service.is_none());
    }

    #[test]
    fn service_is_selected_only_when_state_and_config_both_match() {
        let identity = GatewayServiceIdentity::new(
            Path::new("/tmp/junqi-selected-state"),
            Path::new("/tmp/junqi-selected-state/config/openclaw.json"),
        );
        let selected_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state","OPENCLAW_CONFIG_PATH":"/tmp/junqi-selected-state/config/openclaw.json"}}}}"#;
        let selected_default_config_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state"}}},"config":{"daemon":{"path":"/tmp/junqi-selected-state/config/openclaw.json"}}}"#;
        let foreign_state_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/other-state","OPENCLAW_CONFIG_PATH":"/tmp/junqi-selected-state/config/openclaw.json"}}}}"#;
        let foreign_config_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state","OPENCLAW_CONFIG_PATH":"/tmp/other-config.json"}}}}"#;
        let selected_working_directory_json = br#"{"service":{"command":{"workingDirectory":"/tmp/junqi-selected-state","environment":{}}},"config":{"daemon":{"path":"/tmp/junqi-selected-state/config/openclaw.json"}}}"#;
        let contradictory_working_directory_json = br#"{"service":{"command":{"workingDirectory":"/tmp/other-state","environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state","OPENCLAW_CONFIG_PATH":"/tmp/junqi-selected-state/config/openclaw.json"}}}}"#;
        let contradictory_reported_config_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state","OPENCLAW_CONFIG_PATH":"/tmp/junqi-selected-state/config/openclaw.json"}}},"config":{"daemon":{"path":"/tmp/other-config.json"}}}"#;
        let foreign_working_directory_json = br#"{"service":{"command":{"workingDirectory":"/tmp/other-state","environment":{}}},"config":{"daemon":{"path":"/tmp/junqi-selected-state/config/openclaw.json"}}}"#;
        let missing_json = br#"{"service":null}"#;
        let missing_state_json = br#"{"service":{"command":{"environment":{"OPENCLAW_CONFIG_PATH":"/tmp/junqi-selected-state/config/openclaw.json"}}}}"#;
        let missing_config_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state"}}}}"#;

        assert_eq!(
            classify(selected_json, &identity),
            GatewayServiceOwnership::SelectedState
        );
        assert_eq!(
            classify(selected_default_config_json, &identity),
            GatewayServiceOwnership::SelectedState
        );
        assert_eq!(
            classify(foreign_state_json, &identity),
            GatewayServiceOwnership::Foreign
        );
        assert_eq!(
            classify(foreign_config_json, &identity),
            GatewayServiceOwnership::Foreign
        );
        assert_eq!(
            classify(selected_working_directory_json, &identity),
            GatewayServiceOwnership::SelectedState
        );
        assert_eq!(
            classify(contradictory_working_directory_json, &identity),
            GatewayServiceOwnership::Foreign
        );
        assert_eq!(
            classify(contradictory_reported_config_json, &identity),
            GatewayServiceOwnership::Foreign
        );
        assert_eq!(
            classify(foreign_working_directory_json, &identity),
            GatewayServiceOwnership::Foreign
        );
        assert_eq!(
            classify(missing_json, &identity),
            GatewayServiceOwnership::Absent
        );
        assert_eq!(
            classify(missing_state_json, &identity),
            GatewayServiceOwnership::Unverifiable
        );
        assert_eq!(
            classify(missing_config_json, &identity),
            GatewayServiceOwnership::Unverifiable
        );
    }

    #[test]
    fn service_identity_compares_normalized_path_locations() {
        let root = std::env::temp_dir().join(format!(
            "junqi-service-identity-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let state_dir = root.join("state");
        let config_path = state_dir.join("config").join("openclaw.json");
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        std::fs::write(&config_path, b"{}").unwrap();

        let identity = GatewayServiceIdentity::new(&state_dir, &config_path);
        let state_alias = state_dir.join("..").join("state");
        let config_alias = state_dir
            .join("config")
            .join("..")
            .join("config")
            .join("openclaw.json");
        let document = GatewayStatusDocument {
            service: Some(GatewayServiceDocument {
                command: Some(GatewayServiceCommand {
                    environment: Some(HashMap::from([
                        (
                            "openclaw_state_dir".to_string(),
                            state_alias.to_string_lossy().into_owned(),
                        ),
                        (
                            "openclaw_config_path".to_string(),
                            config_alias.to_string_lossy().into_owned(),
                        ),
                    ])),
                    program_arguments: None,
                    working_directory: None,
                    source_path: None,
                }),
                installed: Some(true),
                loaded: Some(true),
                runtime: Some(GatewayRuntimeDocument {
                    status: Some("running".into()),
                }),
                source_path: Some(root.join("service.json").to_string_lossy().into_owned()),
            }),
            config: None,
        };

        assert_eq!(
            classify_service_ownership(&document, &identity),
            GatewayServiceOwnership::SelectedState
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn macos_status_uses_working_directory_when_service_env_omits_state_dir() {
        let identity = GatewayServiceIdentity::new(
            Path::new("/tmp/junqi-selected-state"),
            Path::new("/tmp/junqi-selected-state/openclaw.json"),
        );
        let document = GatewayStatusDocument {
            service: Some(GatewayServiceDocument {
                command: Some(GatewayServiceCommand {
                    environment: Some(HashMap::from([(
                        "OPENCLAW_GATEWAY_PORT".to_string(),
                        "18789".to_string(),
                    )])),
                    program_arguments: Some(vec![
                        "/tmp/node".into(),
                        "/tmp/openclaw/dist/index.js".into(),
                        "gateway".into(),
                    ]),
                    working_directory: Some("/tmp/junqi-selected-state".into()),
                    source_path: Some("/tmp/ai.openclaw.gateway.plist".into()),
                }),
                installed: Some(true),
                loaded: Some(true),
                runtime: Some(GatewayRuntimeDocument {
                    status: Some("running".into()),
                }),
                source_path: Some("/tmp/ai.openclaw.gateway.plist".into()),
            }),
            config: Some(GatewayConfigDocument {
                cli: None,
                daemon: Some(GatewayConfigPath {
                    path: Some("/tmp/junqi-selected-state/openclaw.json".into()),
                }),
            }),
        };
        assert_eq!(
            classify_service_ownership(&document, &identity),
            GatewayServiceOwnership::SelectedState
        );
    }

    #[test]
    fn stopped_service_is_still_installed_when_not_loaded() {
        let identity = GatewayServiceIdentity::new(
            Path::new("/tmp/junqi-selected-state"),
            Path::new("/tmp/junqi-selected-state/openclaw.json"),
        );
        let document = GatewayStatusDocument {
            service: Some(GatewayServiceDocument {
                command: Some(GatewayServiceCommand {
                    environment: Some(HashMap::from([(
                        "OPENCLAW_STATE_DIR".to_string(),
                        "/tmp/junqi-selected-state".to_string(),
                    )])),
                    program_arguments: None,
                    working_directory: None,
                    source_path: Some("/tmp/junqi-selected-state/gateway.cmd".into()),
                }),
                installed: None,
                loaded: Some(false),
                runtime: Some(GatewayRuntimeDocument {
                    status: Some("stopped".into()),
                }),
                source_path: Some("/tmp/junqi-selected-state/gateway.cmd".into()),
            }),
            config: Some(GatewayConfigDocument {
                cli: None,
                daemon: Some(GatewayConfigPath {
                    path: Some("/tmp/junqi-selected-state/openclaw.json".into()),
                }),
            }),
        };
        let inspection = inspect_document(document, &identity);
        assert_eq!(inspection.ownership, GatewayServiceOwnership::SelectedState);
        assert!(inspection.installed);
        assert!(!inspection.running);
        assert!(inspection.runtime_known);
    }

    #[test]
    fn unknown_service_runtime_is_not_reported_as_stopped() {
        let identity = GatewayServiceIdentity::new(
            Path::new("/tmp/junqi-selected-state"),
            Path::new("/tmp/junqi-selected-state/openclaw.json"),
        );
        let document = GatewayStatusDocument {
            service: Some(GatewayServiceDocument {
                command: Some(GatewayServiceCommand {
                    environment: Some(HashMap::from([
                        (
                            "OPENCLAW_STATE_DIR".to_string(),
                            "/tmp/junqi-selected-state".to_string(),
                        ),
                        (
                            "OPENCLAW_CONFIG_PATH".to_string(),
                            "/tmp/junqi-selected-state/openclaw.json".to_string(),
                        ),
                    ])),
                    program_arguments: None,
                    working_directory: None,
                    source_path: Some("/tmp/junqi-selected-state/gateway.cmd".into()),
                }),
                installed: Some(true),
                loaded: Some(true),
                runtime: Some(GatewayRuntimeDocument {
                    status: Some("unknown".into()),
                }),
                source_path: Some("/tmp/junqi-selected-state/gateway.cmd".into()),
            }),
            config: Some(GatewayConfigDocument {
                cli: None,
                daemon: Some(GatewayConfigPath {
                    path: Some("/tmp/junqi-selected-state/openclaw.json".into()),
                }),
            }),
        };
        let inspection = inspect_document(document, &identity);
        assert_eq!(inspection.ownership, GatewayServiceOwnership::SelectedState);
        assert!(inspection.installed);
        assert!(inspection.running);
        assert!(!inspection.runtime_known);
        assert!(windows_task_start_requires_cleanup(inspection));
    }

    #[test]
    fn selected_service_runtime_requires_current_node_and_package_root() {
        let root = std::env::temp_dir().join(format!(
            "junqi-service-runtime-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let state = root.join("state");
        let config = state.join("openclaw.json");
        let node = root
            .join("node")
            .join(if cfg!(windows) { "node.exe" } else { "node" });
        let package = root.join("npm").join("node_modules").join("openclaw");
        let entry = package.join("dist").join("index.js");
        let identity = GatewayServiceIdentity {
            state_dir: state.clone(),
            config_path: config.clone(),
            runtime: Some(system::NativeOpenclawRuntimeIdentity {
                node: Some(node.clone()),
                entry: Some(entry.clone()),
                package_dir: Some(package.clone()),
                executable: None,
                npm_prefix: Some(root.join("npm")),
            }),
            locale: None,
        };
        let status = |program_arguments: Option<Vec<String>>| GatewayStatusDocument {
            service: Some(GatewayServiceDocument {
                command: Some(GatewayServiceCommand {
                    environment: Some(HashMap::from([
                        (
                            "OPENCLAW_STATE_DIR".into(),
                            state.to_string_lossy().into_owned(),
                        ),
                        (
                            "OPENCLAW_CONFIG_PATH".into(),
                            config.to_string_lossy().into_owned(),
                        ),
                        ("OPENCLAW_LOCALE".into(), "en-US".into()),
                    ])),
                    program_arguments,
                    working_directory: None,
                    source_path: Some(root.join("gateway-service").display().to_string()),
                }),
                installed: Some(true),
                loaded: Some(false),
                runtime: None,
                source_path: None,
            }),
            config: None,
        };

        assert_eq!(
            classify_service_ownership(
                &status(Some(vec![
                    node.to_string_lossy().into_owned(),
                    entry.to_string_lossy().into_owned(),
                    "gateway".into(),
                ])),
                &identity,
            ),
            GatewayServiceOwnership::SelectedState,
        );
        assert_eq!(
            classify_service_ownership(
                &status(Some(vec![
                    root.join("old-node").display().to_string(),
                    entry.to_string_lossy().into_owned(),
                    "gateway".into(),
                ])),
                &identity,
            ),
            GatewayServiceOwnership::StaleRuntime,
        );
        let mut locale_identity = identity.clone();
        locale_identity.locale = Some("zh-CN".into());
        assert_eq!(
            classify_service_ownership(
                &status(Some(vec![
                    node.to_string_lossy().into_owned(),
                    entry.to_string_lossy().into_owned(),
                    "gateway".into(),
                ])),
                &locale_identity,
            ),
            GatewayServiceOwnership::StaleLocale,
        );
        assert_eq!(
            classify_service_ownership(
                &status(Some(vec![
                    node.to_string_lossy().into_owned(),
                    root.join("old-prefix/openclaw/dist/index.js")
                        .display()
                        .to_string(),
                    "gateway".into(),
                ])),
                &identity,
            ),
            GatewayServiceOwnership::StaleRuntime,
        );
        assert_eq!(
            classify_service_ownership(&status(None), &identity),
            GatewayServiceOwnership::Unverifiable,
        );
    }

    #[test]
    fn autostart_status_keeps_registration_and_runtime_state_distinct() {
        let stopped = GatewayServiceInspection {
            ownership: GatewayServiceOwnership::SelectedState,
            installed: true,
            running: false,
            runtime_known: true,
        };
        let running = GatewayServiceInspection {
            running: true,
            ..stopped
        };

        let stopped_status = selected_service_autostart_status(stopped);
        assert!(stopped_status.enabled);
        assert!(!stopped_status.running);

        let running_status = selected_service_autostart_status(running);
        assert!(running_status.enabled);
        assert!(running_status.running);
    }

    #[test]
    fn autostart_service_kind_matches_platform_service_contracts() {
        assert_eq!(
            gateway_autostart_service_kind_for_os("macos"),
            GatewayAutostartServiceKind::MacosLaunchAgent,
        );
        assert_eq!(
            gateway_autostart_service_kind_for_os("windows"),
            GatewayAutostartServiceKind::WindowsScheduledTask,
        );
        assert_eq!(
            gateway_autostart_service_kind_for_os("linux"),
            GatewayAutostartServiceKind::NativeService,
        );
    }
}
