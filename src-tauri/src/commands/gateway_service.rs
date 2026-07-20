//! Official OpenClaw Gateway service ownership and lifecycle operations.
//!
//! Service mutations are permitted only after the official status document
//! identifies the same state directory JunQi currently selected.

use crate::{commands::system, paths, platform};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAutostartStatus {
    pub supported: bool,
    pub enabled: bool,
    pub service_label: Option<String>,
}

fn selected_service_autostart_status(
    inspection: GatewayServiceInspection,
) -> GatewayAutostartStatus {
    GatewayAutostartStatus {
        supported: true,
        enabled: belongs_to_selected_state(inspection.ownership) && inspection.installed,
        service_label: Some("OpenClaw Gateway".to_string()),
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

#[tauri::command]
pub async fn gateway_autostart_status() -> Result<GatewayAutostartStatus, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Ok(GatewayAutostartStatus {
            supported: false,
            enabled: false,
            service_label: None,
        });
    }
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    let identity = GatewayServiceIdentity::for_runtime(&state_dir, &config_path, &runtime);
    let inspection = inspect_gateway_service_state(&runtime, &identity, None).await?;
    Ok(selected_service_autostart_status(inspection))
}

#[tauri::command]
pub async fn enable_gateway_autostart() -> Result<GatewayAutostartStatus, String> {
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    let port = crate::commands::gateway::gateway_port_for_config(&config_path);
    install_selected_gateway_service(&runtime, &state_dir, &config_path, port).await?;
    let identity = GatewayServiceIdentity::for_runtime(&state_dir, &config_path, &runtime);
    let inspection = inspect_gateway_service_state(&runtime, &identity, None).await?;
    let status = selected_service_autostart_status(inspection);
    if !status.enabled {
        return Err("Gateway service was installed but could not be verified for the selected OpenClaw state directory".to_string());
    }
    Ok(status)
}

#[tauri::command]
pub async fn disable_gateway_autostart() -> Result<GatewayAutostartStatus, String> {
    if !matches!(
        paths::active_runtime_mode(),
        paths::OpenClawRuntimeMode::Native
    ) {
        return Ok(GatewayAutostartStatus {
            supported: false,
            enabled: false,
            service_label: None,
        });
    }
    let (runtime, state_dir, config_path) = selected_native_service_context().await?;
    uninstall_selected_gateway_service(&runtime, &state_dir, &config_path, None).await?;
    Ok(GatewayAutostartStatus {
        supported: true,
        enabled: false,
        service_label: Some("OpenClaw Gateway".to_string()),
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

fn service_config_path<'a>(
    document: &'a GatewayStatusDocument,
    environment: Option<&'a HashMap<String, String>>,
) -> Option<&'a str> {
    environment
        .and_then(|values| declared_environment(values, "OPENCLAW_CONFIG_PATH"))
        .or_else(|| {
            document
                .config
                .as_ref()
                .and_then(|config| config.daemon.as_ref().or(config.cli.as_ref()))
                .and_then(|path| path.path.as_deref())
                .map(str::trim)
                .filter(|path| !path.is_empty())
        })
}

fn classify_service_ownership(
    document: &GatewayStatusDocument,
    identity: &GatewayServiceIdentity,
) -> GatewayServiceOwnership {
    let Some(service) = document.service.as_ref() else {
        return GatewayServiceOwnership::Absent;
    };
    let environment = service
        .command
        .as_ref()
        .and_then(|command| command.environment.as_ref());
    let Some(environment) = environment else {
        return GatewayServiceOwnership::Unverifiable;
    };
    let Some(service_state_dir) = declared_environment(environment, "OPENCLAW_STATE_DIR") else {
        return GatewayServiceOwnership::Unverifiable;
    };
    let Some(service_config_path) = service_config_path(document, Some(environment)) else {
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
                Some(expected) => match declared_environment(environment, "OPENCLAW_LOCALE") {
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
    let running = service
        .runtime
        .as_ref()
        .and_then(|runtime| runtime.status.as_deref())
        .map(|status| status.eq_ignore_ascii_case("running"))
        .unwrap_or(service.loaded.unwrap_or(false));
    let ownership = classify_service_ownership(&document, identity);
    GatewayServiceInspection {
        ownership,
        installed,
        running,
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

async fn run_service_command(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let context = identity.command_context(search_path);
    let mut command = runtime.command(&context);
    command
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    tokio::time::timeout(std::time::Duration::from_secs(30), command.output())
        .await
        .map_err(|_| format!("OpenClaw service command timed out: {}", args.join(" ")))?
        .map_err(|error| format!("Failed to run OpenClaw service command: {error}"))
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

pub(crate) async fn inspect_gateway_service_identity(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
) -> Result<GatewayServiceOwnership, String> {
    let args = ["gateway", "status", "--json"];
    let output = run_service_command(runtime, identity, search_path, &args).await?;
    command_success(&output, &args)?;
    parse_gateway_status(&output.stdout)
        .map(|document| classify_service_ownership(&document, identity))
}

pub(crate) async fn inspect_gateway_service_state(
    runtime: &system::NativeOpenclawRuntime,
    identity: &GatewayServiceIdentity,
    search_path: Option<&str>,
) -> Result<GatewayServiceInspection, String> {
    let args = ["gateway", "status", "--json"];
    let output = run_service_command(runtime, identity, search_path, &args).await?;
    command_success(&output, &args)?;
    parse_gateway_status(&output.stdout).map(|document| inspect_document(document, identity))
}

pub(crate) async fn stop_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> Result<bool, String> {
    let identity = GatewayServiceIdentity::for_runtime(state_dir, config_path, runtime);
    if !belongs_to_selected_state(
        inspect_gateway_service_identity(runtime, &identity, search_path).await?,
    ) {
        return Ok(false);
    }
    let args = ["gateway", "stop"];
    let output = run_service_command(runtime, &identity, search_path, &args).await?;
    command_success(&output, &args)?;
    Ok(true)
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
    if !belongs_to_selected_state(inspection.ownership) || !inspection.installed {
        return Ok(false);
    }

    if inspection.running {
        let stop_args = ["gateway", "stop"];
        let stop = run_service_command(runtime, &identity, search_path, &stop_args).await?;
        command_success(&stop, &stop_args)?;
    }

    let uninstall_args = ["gateway", "uninstall", "--json"];
    let uninstall = run_service_command(runtime, &identity, search_path, &uninstall_args).await?;
    command_success(&uninstall, &uninstall_args)?;
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

    fn classify(output: &[u8], identity: &GatewayServiceIdentity) -> GatewayServiceOwnership {
        let document = parse_gateway_status(output).unwrap();
        classify_service_ownership(&document, identity)
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
}
