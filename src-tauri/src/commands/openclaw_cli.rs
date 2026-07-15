use crate::{commands::system, paths, platform};
use serde_json::Value;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

pub(crate) struct CliOutput {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

pub(crate) fn validate_cli_identifier(value: &str, label: &str) -> Result<(), String> {
    let mut characters = value.chars();
    let valid = !value.is_empty()
        && value.len() <= 128
        && characters
            .next()
            .is_some_and(|character| character.is_ascii_alphanumeric())
        && characters
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character));
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid {label}"))
    }
}

pub(crate) async fn run_openclaw(
    args: &[&str],
    config_path: Option<&Path>,
    timeout: Duration,
) -> Result<CliOutput, String> {
    let binary = system::resolve_openclaw_binary().ok_or_else(|| {
        "OpenClaw is not installed; official CLI operations are unavailable".to_string()
    })?;
    let active_config_path = paths::config_path();
    let mut command = tokio::process::Command::new(&binary);
    command
        .args(args)
        .env("PATH", system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", paths::desktop_dir())
        .env(
            "OPENCLAW_CONFIG_PATH",
            config_path.unwrap_or(active_config_path.as_path()),
        )
        .env("OPENCLAW_NO_RESPAWN", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);

    let output = tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| format!("OpenClaw command timed out: {}", args.join(" ")))?
        .map_err(|error| format!("Failed to run OpenClaw {}: {error}", args.join(" ")))?;
    Ok(CliOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

pub(crate) fn parse_json_payload(raw: &str) -> Result<Value, String> {
    if let Ok(value) = serde_json::from_str(raw) {
        return Ok(value);
    }
    for (index, character) in raw.char_indices() {
        if character != '{' && character != '[' {
            continue;
        }
        let mut values = serde_json::Deserializer::from_str(&raw[index..]).into_iter::<Value>();
        if let Some(Ok(value)) = values.next() {
            return Ok(value);
        }
    }
    Err("OpenClaw did not return a JSON payload".to_string())
}

pub(crate) fn parse_cli_json(output: &CliOutput) -> Result<Value, String> {
    parse_json_payload(&output.stdout).or_else(|_| parse_json_payload(&output.stderr))
}

pub(crate) fn output_error(label: &str, output: &CliOutput) -> String {
    let detail = output
        .stderr
        .lines()
        .chain(output.stdout.lines())
        .map(crate::commands::diagnostic_output::sanitize_diagnostic_line)
        .find(|line| !line.is_empty())
        .unwrap_or_else(|| "unknown error".to_string());
    format!("OpenClaw {label} failed: {detail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_parser_ignores_leading_cli_warnings() {
        let payload = parse_json_payload("warning line\n{\"valid\":true}\n").unwrap();
        assert_eq!(payload.get("valid").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn cli_json_parser_accepts_structured_stderr() {
        let output = CliOutput {
            success: false,
            stdout: String::new(),
            stderr: "warning\n{\"valid\":false}".to_string(),
        };
        assert_eq!(
            parse_cli_json(&output)
                .unwrap()
                .get("valid")
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn cli_identifiers_reject_shell_and_flag_syntax() {
        assert!(validate_cli_identifier("github-copilot:main", "profile ID").is_ok());
        assert!(validate_cli_identifier("--force", "provider ID").is_err());
        assert!(validate_cli_identifier("openai;whoami", "provider ID").is_err());
    }
}
