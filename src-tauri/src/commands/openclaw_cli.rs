use crate::{
    commands::{docker, system},
    paths::{self, OpenClawRuntimeMode},
    platform,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub(crate) struct CliOutput {
    pub(crate) success: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

/// The process endpoint that owns the selected OpenClaw runtime. Keeping this
/// decision here prevents config, provider, channel, and maintenance commands
/// from independently guessing whether the user selected Native or Docker.
#[derive(Clone, Debug)]
pub(crate) enum OpenClawCliTarget {
    Native(system::NativeOpenclawRuntime),
    Docker(PathBuf),
}

impl OpenClawCliTarget {
    pub(crate) fn command(&self, args: &[&str]) -> tokio::process::Command {
        match self {
            Self::Native(runtime) => native_command(runtime, args, None),
            Self::Docker(docker_bin) => docker_command(docker_bin, args),
        }
    }
}

/// Resolve the command target once for a multi-command operation. Callers
/// such as maintenance can then run config validation and doctor consistently
/// against the same selected runtime.
pub(crate) async fn resolve_active_openclaw_target() -> Result<OpenClawCliTarget, String> {
    match paths::active_runtime_mode() {
        OpenClawRuntimeMode::Native => system::resolve_compatible_native_openclaw_runtime()
            .await
            .map(OpenClawCliTarget::Native),
        OpenClawRuntimeMode::Docker => docker::resolve_docker_bin()
            .await
            .map(PathBuf::from)
            .map(OpenClawCliTarget::Docker)
            .map_err(|error| format!("Docker is selected but its CLI is unavailable: {error}")),
    }
}

fn native_command(
    runtime: &system::NativeOpenclawRuntime,
    args: &[&str],
    config_path: Option<&Path>,
) -> tokio::process::Command {
    let active_config_path = paths::config_path();
    let mut command = runtime.command();
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
    command
}

fn docker_command(docker_bin: &Path, args: &[&str]) -> tokio::process::Command {
    let state_dir_env = format!(
        "OPENCLAW_STATE_DIR={}",
        docker::OPENCLAW_CONTAINER_STATE_DIR
    );
    let config_path_env = format!(
        "OPENCLAW_CONFIG_PATH={}",
        docker::OPENCLAW_CONTAINER_CONFIG_PATH
    );
    let mut command = tokio::process::Command::new(docker_bin);
    command
        .arg("exec")
        .arg("-i")
        .arg("-e")
        .arg("OPENCLAW_NO_RESPAWN=1")
        .arg("-e")
        .arg("NO_COLOR=1")
        .arg("-e")
        .arg(state_dir_env)
        .arg("-e")
        .arg(config_path_env)
        .arg(docker::OPENCLAW_CONTAINER_NAME)
        .arg("openclaw")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    command
}

/// Candidate configuration validation needs an isolated config file. Docker
/// cannot see a host temporary path, so stream it into a temporary in-container
/// file and remove it with a shell trap. Arguments remain positional (`$@`) and
/// are never interpolated into the shell script.
const DOCKER_CANDIDATE_CONFIG_SCRIPT: &str = r#"candidate="$(mktemp "${TMPDIR:-/tmp}/junqi-openclaw-config.XXXXXX")" || exit 1
cleanup() { rm -f "$candidate"; }
trap cleanup EXIT HUP INT TERM
cat > "$candidate" || exit 1
OPENCLAW_CONFIG_PATH="$candidate" openclaw "$@"
"#;

fn docker_candidate_command(docker_bin: &Path, args: &[&str]) -> tokio::process::Command {
    let state_dir_env = format!(
        "OPENCLAW_STATE_DIR={}",
        docker::OPENCLAW_CONTAINER_STATE_DIR
    );
    let mut command = tokio::process::Command::new(docker_bin);
    command
        .arg("exec")
        .arg("-i")
        .arg("-e")
        .arg("OPENCLAW_NO_RESPAWN=1")
        .arg("-e")
        .arg("NO_COLOR=1")
        .arg("-e")
        .arg(state_dir_env)
        .arg(docker::OPENCLAW_CONTAINER_NAME)
        .arg("sh")
        .arg("-c")
        .arg(DOCKER_CANDIDATE_CONFIG_SCRIPT)
        .arg("junqi-openclaw-candidate")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    command
}

async fn command_output(
    mut command: tokio::process::Command,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    tokio::time::timeout(timeout, command.output())
        .await
        .map_err(|_| format!("OpenClaw command timed out: {}", args.join(" ")))?
        .map_err(|error| format!("Failed to run OpenClaw {}: {error}", args.join(" ")))
}

async fn command_output_with_candidate_config(
    mut command: tokio::process::Command,
    config_path: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let candidate = tokio::fs::read(config_path)
        .await
        .map_err(|error| format!("Failed to read candidate OpenClaw config: {error}"))?;
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to run OpenClaw {}: {error}", args.join(" ")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Docker candidate config input was unavailable".to_string())?;
    let execution = tokio::time::timeout(timeout, async move {
        let write_candidate = async move {
            stdin
                .write_all(&candidate)
                .await
                .map_err(|error| format!("Failed to stream candidate OpenClaw config: {error}"))?;
            stdin
                .shutdown()
                .await
                .map_err(|error| format!("Failed to finish candidate OpenClaw config: {error}"))
        };
        let wait_for_output = async move {
            child
                .wait_with_output()
                .await
                .map_err(|error| format!("Failed to run OpenClaw {}: {error}", args.join(" ")))
        };
        let (_, output) = tokio::try_join!(write_candidate, wait_for_output)?;
        Ok::<_, String>(output)
    })
    .await;
    match execution {
        Ok(result) => result,
        Err(_) => Err(format!("OpenClaw command timed out: {}", args.join(" "))),
    }
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
    let target = resolve_active_openclaw_target().await?;
    let output = match (&target, config_path) {
        (OpenClawCliTarget::Native(runtime), Some(candidate_path)) => {
            command_output(
                native_command(runtime, args, Some(candidate_path)),
                args,
                timeout,
            )
            .await?
        }
        (OpenClawCliTarget::Docker(docker_bin), Some(candidate_path)) => {
            command_output_with_candidate_config(
                docker_candidate_command(docker_bin, args),
                candidate_path,
                args,
                timeout,
            )
            .await?
        }
        _ => command_output(target.command(args), args, timeout).await?,
    };
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

    #[test]
    fn docker_candidate_config_script_cleans_up_without_interpolating_arguments() {
        assert!(DOCKER_CANDIDATE_CONFIG_SCRIPT.contains("mktemp"));
        assert!(DOCKER_CANDIDATE_CONFIG_SCRIPT.contains("trap cleanup"));
        assert!(DOCKER_CANDIDATE_CONFIG_SCRIPT.contains("openclaw \"$@\""));
        assert!(!DOCKER_CANDIDATE_CONFIG_SCRIPT.contains("{args}"));
    }
}
