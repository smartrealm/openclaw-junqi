use crate::commands::{
    openclaw_cli::{output_error, parse_cli_json, run_openclaw, validate_cli_identifier},
    system,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

const READ_TIMEOUT: Duration = Duration::from_secs(45);
const STATUS_TIMEOUT: Duration = Duration::from_secs(75);
/// Plugin installs reach the registry and can take materially longer than a
/// catalog read. Keep the operation bounded while leaving the actual package
/// resolution to OpenClaw.
const PLUGIN_INSTALL_TIMEOUT: Duration = Duration::from_secs(240);

/// A renderer never supplies an arbitrary package spec. Each managed external
/// channel is explicitly reviewed here, then installed through OpenClaw's own
/// plugin command for the currently selected runtime.
#[derive(Clone, Copy)]
struct ManagedExternalChannelPlugin {
    channel_id: &'static str,
    npm_spec: &'static str,
}

const DINGTALK_CONNECTOR: ManagedExternalChannelPlugin = ManagedExternalChannelPlugin {
    channel_id: "dingtalk-connector",
    npm_spec: "@dingtalk-real-ai/dingtalk-connector",
};

fn managed_external_channel_plugin(channel: &str) -> Option<ManagedExternalChannelPlugin> {
    match channel {
        "dingtalk-connector" => Some(DINGTALK_CONNECTOR),
        _ => None,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialChannelCatalog {
    version: Option<String>,
    chat: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialChannelPluginInstallResult {
    channel: String,
    npm_spec: String,
    already_installed: bool,
    installed: bool,
}

async fn channel_catalog_payload() -> Result<Value, String> {
    let output = run_openclaw(&["channels", "list", "--all", "--json"], None, READ_TIMEOUT).await?;
    if !output.success {
        return Err(output_error("channels list", &output));
    }
    parse_cli_json(&output)
}

fn catalog_channel<'a>(payload: &'a Value, channel: &str) -> Option<&'a Value> {
    payload.get("chat")?.get(channel)
}

async fn require_installed_channel(channel: &str) -> Result<(), String> {
    let payload = channel_catalog_payload().await?;
    let entry = catalog_channel(&payload, channel).ok_or_else(|| {
        format!("OpenClaw channel is not present in the official catalog: {channel}")
    })?;
    if entry.get("installed").and_then(Value::as_bool) == Some(true) {
        Ok(())
    } else {
        Err(format!(
            "OpenClaw channel {channel} is installable but not installed; run the official setup first"
        ))
    }
}

fn catalog_entry_is_installed(payload: &Value, channel: &str) -> bool {
    catalog_channel(payload, channel)
        .and_then(|entry| entry.get("installed"))
        .and_then(Value::as_bool)
        == Some(true)
}

/// Install one JunQi-managed external channel plugin through OpenClaw.
///
/// This intentionally does not call a package's ad-hoc `npx` installer:
/// those tools may write to a hard-coded home directory or install unrelated
/// global utilities. OpenClaw owns the plugin location, lock/pin record, and
/// selected Native/Docker runtime here. A successful process exit is not
/// enough; the refreshed official channel catalog must show the plugin loaded.
#[tauri::command]
pub async fn install_openclaw_channel_plugin(
    channel: String,
) -> Result<OfficialChannelPluginInstallResult, String> {
    let channel = channel.trim();
    validate_cli_identifier(channel, "channel ID")?;
    let plugin = managed_external_channel_plugin(channel).ok_or_else(|| {
        format!("JunQi does not manage an installable external plugin for channel: {channel}")
    })?;
    let _guard = crate::commands::maintenance::acquire_operation_guard().await;

    let initial_catalog = channel_catalog_payload().await?;
    if catalog_entry_is_installed(&initial_catalog, plugin.channel_id) {
        return Ok(OfficialChannelPluginInstallResult {
            channel: plugin.channel_id.to_string(),
            npm_spec: plugin.npm_spec.to_string(),
            already_installed: true,
            installed: true,
        });
    }

    let output = run_openclaw(
        &["plugins", "install", plugin.npm_spec, "--pin"],
        None,
        PLUGIN_INSTALL_TIMEOUT,
    )
    .await?;
    if !output.success {
        return Err(output_error("plugins install", &output));
    }

    let refreshed_catalog = channel_catalog_payload().await?;
    if !catalog_entry_is_installed(&refreshed_catalog, plugin.channel_id) {
        return Err(format!(
            "OpenClaw installed {} but did not load the {} channel; run OpenClaw doctor --fix and retry",
            plugin.npm_spec, plugin.channel_id
        ));
    }

    Ok(OfficialChannelPluginInstallResult {
        channel: plugin.channel_id.to_string(),
        npm_spec: plugin.npm_spec.to_string(),
        already_installed: false,
        installed: true,
    })
}

#[tauri::command]
pub async fn get_openclaw_channel_catalog() -> Result<OfficialChannelCatalog, String> {
    let payload = channel_catalog_payload().await?;
    let version = if let Some(path) = system::resolve_openclaw_binary_async().await {
        system::validate_openclaw_binary(&path, &system::openclaw_search_path())
            .await
            .version
    } else {
        None
    };
    Ok(OfficialChannelCatalog {
        version,
        chat: payload.get("chat").cloned().unwrap_or_else(|| json!({})),
    })
}

#[tauri::command]
pub async fn get_openclaw_channel_capabilities(channel: String) -> Result<Value, String> {
    let channel = channel.trim();
    validate_cli_identifier(channel, "channel ID")?;
    require_installed_channel(channel).await?;
    let output = run_openclaw(
        &["channels", "capabilities", "--channel", channel, "--json"],
        None,
        READ_TIMEOUT,
    )
    .await?;
    let payload =
        parse_cli_json(&output).map_err(|_| output_error("channels capabilities", &output))?;
    if output.success {
        Ok(payload)
    } else {
        Err(output_error("channels capabilities", &output))
    }
}

#[tauri::command]
pub async fn get_openclaw_channel_status(
    channel: Option<String>,
    probe: bool,
) -> Result<Value, String> {
    let normalized = channel
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(channel) = normalized {
        validate_cli_identifier(channel, "channel ID")?;
    }
    let mut args = vec!["channels", "status", "--json"];
    if probe {
        args.push("--probe");
        args.extend(["--timeout", "15000"]);
    }
    if let Some(channel) = normalized {
        args.extend(["--channel", channel]);
    }
    let output = run_openclaw(&args, None, STATUS_TIMEOUT).await?;
    // Offline Gateway status is still useful structured state (configOnly,
    // configuredChannels, and the connection error), even on a non-zero exit.
    parse_cli_json(&output).map_err(|_| output_error("channels status", &output))
}

#[tauri::command]
pub async fn get_openclaw_channel_logs(
    channel: Option<String>,
    lines: Option<u16>,
) -> Result<Value, String> {
    let normalized = channel
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("all");
    validate_cli_identifier(normalized, "channel ID")?;
    let lines = lines.unwrap_or(200).clamp(1, 1_000).to_string();
    let output = run_openclaw(
        &[
            "channels",
            "logs",
            "--channel",
            normalized,
            "--lines",
            &lines,
            "--json",
        ],
        None,
        READ_TIMEOUT,
    )
    .await?;
    let payload = parse_cli_json(&output).map_err(|_| output_error("channels logs", &output))?;
    if output.success {
        Ok(payload)
    } else {
        Err(output_error("channels logs", &output))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_lookup_requires_an_exact_channel_id() {
        let payload = json!({"chat": {"dingtalk-connector": {"installed": true}}});
        assert!(catalog_channel(&payload, "dingtalk-connector").is_some());
        assert!(catalog_channel(&payload, "dingtalk").is_none());
    }

    #[test]
    fn managed_external_plugins_are_explicitly_whitelisted() {
        let dingtalk = managed_external_channel_plugin("dingtalk-connector").unwrap();
        assert_eq!(dingtalk.npm_spec, "@dingtalk-real-ai/dingtalk-connector");
        assert!(managed_external_channel_plugin("telegram").is_none());
        assert!(managed_external_channel_plugin("dingtalk-connector;whoami").is_none());
    }

    #[test]
    fn catalog_installation_check_requires_the_boolean_flag() {
        assert!(catalog_entry_is_installed(
            &json!({"chat": {"dingtalk-connector": {"installed": true}}}),
            "dingtalk-connector",
        ));
        assert!(!catalog_entry_is_installed(
            &json!({"chat": {"dingtalk-connector": {"installed": "true"}}}),
            "dingtalk-connector",
        ));
    }
}
