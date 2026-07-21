use crate::{
    commands::{docker, system},
    paths::{self, OpenClawRuntimeMode},
    platform,
};
use serde_json::Value;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};

const MAX_DIAGNOSTIC_CHARS: usize = 2_048;

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

/// An immutable CLI endpoint used by collaboration bootstrap and recovery.
/// Unlike `OpenClawCliTarget`, this target remains bound to the exact
/// binary, state directory, config file, and optional OpenClaw container that
/// were attested at the start of the operation.
#[derive(Debug, Clone)]
pub struct PinnedOpenClawCliTarget {
    pub binary: PathBuf,
    pub state_dir: PathBuf,
    pub config_path: PathBuf,
    pub container: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct OpenClawCliLimits {
    pub timeout: Duration,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
}

impl Default for OpenClawCliLimits {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(120),
            stdout_bytes: 2 * 1024 * 1024,
            stderr_bytes: 512 * 1024,
        }
    }
}

#[derive(Debug)]
pub struct OpenClawCliOutput {
    pub status: ExitStatus,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct ParsedJsonOutput {
    pub value: Value,
    pub warnings: Vec<String>,
}

impl PinnedOpenClawCliTarget {
    pub fn verified(
        binary: impl AsRef<Path>,
        state_dir: impl AsRef<Path>,
        config_path: impl AsRef<Path>,
    ) -> Result<Self, String> {
        let binary = canonical_file(binary.as_ref(), "OpenClaw binary")?;
        let state_dir = absolute_path(state_dir.as_ref(), "OpenClaw state directory")?;
        let config_path = absolute_path(config_path.as_ref(), "OpenClaw config path")?;
        Ok(Self {
            binary,
            state_dir,
            config_path,
            container: None,
        })
    }

    pub fn verified_container(
        binary: impl AsRef<Path>,
        state_dir: impl AsRef<Path>,
        config_path: impl AsRef<Path>,
        container: impl Into<String>,
    ) -> Result<Self, String> {
        let mut target = Self::verified(binary, state_dir, config_path)?;
        let container = container.into();
        if container.is_empty()
            || container.len() > 128
            || !container
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        {
            return Err("OpenClaw container name is invalid".to_string());
        }
        target.container = Some(container);
        Ok(target)
    }
}

fn canonical_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    let canonical =
        std::fs::canonicalize(path).map_err(|error| format!("{label} is unavailable: {error}"))?;
    if !canonical.is_file() {
        return Err(format!("{label} is not a file"));
    }
    Ok(canonical)
}

fn absolute_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    Ok(path.to_path_buf())
}

/// Resolve the command target once for a multi-command operation. Callers
/// such as maintenance can then run config validation and doctor consistently
/// against the same selected runtime.
pub(crate) async fn resolve_active_openclaw_target() -> Result<OpenClawCliTarget, String> {
    paths::validate_runtime_mode(paths::active_runtime_mode())?;
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
    let state_dir = paths::desktop_dir();
    let config_path = config_path
        .map(Path::to_path_buf)
        .unwrap_or_else(paths::config_path);
    let context = system::OpenclawCommandContext::for_paths(state_dir, config_path);
    let mut command = runtime.command(&context);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
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
    let locale_env = format!(
        "OPENCLAW_LOCALE={}",
        system::configured_openclaw_locale(&paths::active_config_path())
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
        .arg(locale_env)
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
    let locale_env = format!(
        "OPENCLAW_LOCALE={}",
        system::configured_openclaw_locale(&paths::active_config_path())
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
        .arg(locale_env)
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

pub async fn run_openclaw_cli<I, S>(
    target: &PinnedOpenClawCliTarget,
    args: I,
    limits: OpenClawCliLimits,
) -> Result<OpenClawCliOutput, String>
where
    I: IntoIterator<Item = S>,
    S: Into<OsString>,
{
    if limits.stdout_bytes == 0 || limits.stderr_bytes == 0 {
        return Err("OpenClaw CLI output limits must be greater than zero".to_string());
    }
    let args = args.into_iter().map(Into::into).collect::<Vec<_>>();
    let mut command = tokio::process::Command::new(&target.binary);
    if let Some(container) = &target.container {
        command.args([OsString::from("--container"), OsString::from(container)]);
    }
    command
        .args(&args)
        .env("PATH", system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", &target.state_dir)
        .env("OPENCLAW_CONFIG_PATH", &target.config_path)
        .env("OPENCLAW_NO_RESPAWN", "1")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    configure_cli_process_tree(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start the selected OpenClaw binary: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "OpenClaw CLI stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "OpenClaw CLI stderr was not captured".to_string())?;

    let execution = tokio::time::timeout(limits.timeout, async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|error| format!("process wait failed: {error}"))
            },
            read_limited(stdout, limits.stdout_bytes, "stdout"),
            read_limited(stderr, limits.stderr_bytes, "stderr")
        )
    })
    .await;

    match execution {
        Ok(Ok((status, stdout, stderr))) => Ok(OpenClawCliOutput {
            status,
            stdout,
            stderr,
        }),
        Ok(Err(error)) => {
            terminate_cli_child(&mut child, Duration::from_secs(5)).await;
            Err(format!("OpenClaw CLI execution failed: {error}"))
        }
        Err(_) => {
            terminate_cli_child(&mut child, Duration::from_secs(5)).await;
            Err(format!(
                "OpenClaw CLI timed out after {} seconds",
                limits.timeout.as_secs()
            ))
        }
    }
}

fn configure_cli_process_tree(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
}

async fn terminate_cli_child(child: &mut tokio::process::Child, timeout_budget: Duration) {
    let pid = child.id();
    #[cfg(unix)]
    if let Some(pid) = pid
        .filter(|value| *value > 1)
        .and_then(|value| i32::try_from(value).ok())
    {
        // The child is the leader of the process group created above.
        let _ = unsafe { libc::kill(-pid, libc::SIGKILL) };
    }
    #[cfg(windows)]
    if let Some(pid) = pid {
        let _ = tokio::time::timeout(
            timeout_budget,
            crate::commands::process_control::terminate_windows_process_tree(pid),
        )
        .await;
    }
    let _ = child.start_kill();
    let _ = tokio::time::timeout(timeout_budget, child.wait()).await;
}

async fn read_limited<R>(mut reader: R, limit: usize, stream: &str) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8_192];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|error| format!("{stream} read failed: {error}"))?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > limit {
            return Err(format!("{stream} exceeded the {limit} byte limit"));
        }
        output.extend_from_slice(&chunk[..count]);
    }
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

pub fn parse_json_with_warnings(output: &[u8]) -> Result<ParsedJsonOutput, String> {
    let text = String::from_utf8_lossy(output);
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("OpenClaw CLI returned an empty response".to_string());
    }

    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(ParsedJsonOutput {
            value,
            warnings: Vec::new(),
        });
    }

    for (start, character) in text.char_indices() {
        if character != '{' && character != '[' {
            continue;
        }
        let source = &text[start..];
        let mut stream = serde_json::Deserializer::from_str(source).into_iter::<Value>();
        let Some(Ok(value)) = stream.next() else {
            continue;
        };
        let end = start.saturating_add(stream.byte_offset());
        let warnings = warning_lines(&format!("{}\n{}", &text[..start], &text[end..]));
        return Ok(ParsedJsonOutput { value, warnings });
    }

    Err("OpenClaw CLI response did not contain a valid JSON value".to_string())
}

fn warning_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(16)
        .map(redact_sensitive_text)
        .collect()
}

pub fn output_diagnostic(output: &OpenClawCliOutput, private_paths: &[&Path]) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let source = if stderr.trim().is_empty() {
        stdout.as_ref()
    } else {
        stderr.as_ref()
    };
    let mut diagnostic = redact_sensitive_text(source);
    for path in private_paths {
        let value = path.to_string_lossy();
        if !value.is_empty() {
            diagnostic = diagnostic.replace(value.as_ref(), "[path]");
        }
    }
    if diagnostic.chars().count() > MAX_DIAGNOSTIC_CHARS {
        diagnostic = diagnostic.chars().take(MAX_DIAGNOSTIC_CHARS).collect();
        diagnostic.push_str("...[truncated]");
    }
    diagnostic.trim().to_string()
}

pub fn redact_sensitive_text(text: &str) -> String {
    text.lines()
        .take(64)
        .map(|line| {
            let sanitized = crate::commands::diagnostic_output::sanitize_diagnostic_line(line);
            if sanitized.is_empty() && !line.trim().is_empty() {
                "[redacted sensitive diagnostic]".to_string()
            } else {
                sanitized
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
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

    #[test]
    fn pinned_parser_preserves_sanitized_warnings_around_json() {
        let parsed = parse_json_with_warnings(
            b"migration warning\n{\"plugin\":{\"id\":\"junqi-collab\"}}\nrestart warning",
        )
        .unwrap();
        assert_eq!(parsed.value["plugin"]["id"].as_str(), Some("junqi-collab"));
        assert_eq!(parsed.warnings, ["migration warning", "restart warning"]);
    }

    #[test]
    fn pinned_diagnostics_remove_sensitive_lines() {
        let value = redact_sensitive_text("normal\nAuthorization: Bearer abc\napiKey=def");
        assert!(value.contains("normal"));
        assert!(!value.contains("abc"));
        assert!(!value.contains("def"));
    }

    #[test]
    fn pinned_target_requires_an_exact_binary_file() {
        let result = PinnedOpenClawCliTarget::verified(
            Path::new("openclaw"),
            Path::new("/tmp/state"),
            Path::new("/tmp/state/openclaw.json"),
        );
        assert!(result.unwrap_err().contains("absolute"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn pinned_container_target_forwards_global_cli_arguments() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("junqi-cli-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("openclaw-test");
        std::fs::write(&script, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o700)).unwrap();
        let target = PinnedOpenClawCliTarget::verified_container(
            &script,
            root.join("state"),
            root.join("state/openclaw.json"),
            "maxauto-openclaw",
        )
        .unwrap();
        let output = run_openclaw_cli(
            &target,
            ["plugins", "inspect", "junqi-collab"],
            OpenClawCliLimits::default(),
        )
        .await
        .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout).unwrap(),
            "--container\nmaxauto-openclaw\nplugins\ninspect\njunqi-collab\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
