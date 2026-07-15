use crate::commands::{
    openclaw_cli::{output_error, parse_cli_json, run_openclaw, validate_cli_identifier},
    system,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

const READ_TIMEOUT: Duration = Duration::from_secs(45);
const STATUS_TIMEOUT: Duration = Duration::from_secs(75);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialChannelCatalog {
    version: Option<String>,
    chat: Value,
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

#[tauri::command]
pub async fn get_openclaw_channel_catalog() -> Result<OfficialChannelCatalog, String> {
    let payload = channel_catalog_payload().await?;
    let version = if let Some(path) = system::resolve_openclaw_binary() {
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
}
