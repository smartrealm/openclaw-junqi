//! Official OpenClaw Gateway service ownership and lifecycle operations.
//!
//! Service mutations are permitted only after the official status document
//! identifies the same state directory JunQi currently selected.

use crate::{commands::system, paths};
use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GatewayServiceOwnership {
    Absent,
    SelectedState,
    OtherOrUnverifiable,
}

#[derive(Debug, Deserialize)]
struct GatewayStatusDocument {
    service: Option<GatewayServiceDocument>,
}

#[derive(Debug, Deserialize)]
struct GatewayServiceDocument {
    command: Option<GatewayServiceCommand>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GatewayServiceCommand {
    environment: Option<HashMap<String, String>>,
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

fn classify_service_ownership(
    document: GatewayStatusDocument,
    state_dir: &Path,
) -> GatewayServiceOwnership {
    let Some(service) = document.service else {
        return GatewayServiceOwnership::Absent;
    };
    let Some(service_state_dir) = service
        .command
        .and_then(|command| command.environment)
        .and_then(|environment| environment.get("OPENCLAW_STATE_DIR").cloned())
        .filter(|value| !value.trim().is_empty())
    else {
        return GatewayServiceOwnership::OtherOrUnverifiable;
    };
    if paths::paths_refer_to_same_location(Path::new(&service_state_dir), state_dir) {
        GatewayServiceOwnership::SelectedState
    } else {
        GatewayServiceOwnership::OtherOrUnverifiable
    }
}

fn command_context(
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> system::OpenclawCommandContext {
    let context = system::OpenclawCommandContext::for_paths(
        state_dir.to_path_buf(),
        config_path.to_path_buf(),
    );
    search_path.map_or(context.clone(), |path| context.with_search_path(path))
}

async fn run_service_command(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let context = command_context(state_dir, config_path, search_path);
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

pub(crate) async fn inspect_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> Result<GatewayServiceOwnership, String> {
    let args = ["gateway", "status", "--json"];
    let output = run_service_command(runtime, state_dir, config_path, search_path, &args).await?;
    command_success(&output, &args)?;
    parse_gateway_status(&output.stdout)
        .map(|document| classify_service_ownership(document, state_dir))
}

pub(crate) async fn stop_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    search_path: Option<&str>,
) -> Result<bool, String> {
    if inspect_gateway_service(runtime, state_dir, config_path, search_path).await?
        != GatewayServiceOwnership::SelectedState
    {
        return Ok(false);
    }
    let args = ["gateway", "stop"];
    let output = run_service_command(runtime, state_dir, config_path, search_path, &args).await?;
    command_success(&output, &args)?;
    Ok(true)
}

pub(crate) async fn install_and_start_selected_gateway_service(
    runtime: &system::NativeOpenclawRuntime,
    state_dir: &Path,
    config_path: &Path,
    port: u16,
) -> Result<(), String> {
    let port = port.to_string();
    let install_args = ["gateway", "install", "--force", "--port", port.as_str()];
    let install = run_service_command(runtime, state_dir, config_path, None, &install_args).await?;
    command_success(&install, &install_args)?;
    let start_args = ["gateway", "start"];
    let start = run_service_command(runtime, state_dir, config_path, None, &start_args).await?;
    command_success(&start, &start_args)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_is_selected_only_when_it_declares_the_selected_state_directory() {
        let selected = Path::new("/tmp/junqi-selected-state");
        let selected_json = br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/junqi-selected-state"}}}}"#;
        let foreign_json =
            br#"{"service":{"command":{"environment":{"OPENCLAW_STATE_DIR":"/tmp/other-state"}}}}"#;
        let missing_json = br#"{"service":null}"#;
        let unverifiable_json = br#"{"service":{"command":{}}}"#;

        assert_eq!(
            classify_service_ownership(parse_gateway_status(selected_json).unwrap(), selected),
            GatewayServiceOwnership::SelectedState
        );
        assert_eq!(
            classify_service_ownership(parse_gateway_status(foreign_json).unwrap(), selected),
            GatewayServiceOwnership::OtherOrUnverifiable
        );
        assert_eq!(
            classify_service_ownership(parse_gateway_status(missing_json).unwrap(), selected),
            GatewayServiceOwnership::Absent
        );
        assert_eq!(
            classify_service_ownership(parse_gateway_status(unverifiable_json).unwrap(), selected),
            GatewayServiceOwnership::OtherOrUnverifiable
        );
    }
}
