use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};

const TITLE_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PROMPT_CHARS: usize = 4_000;
const MAX_TITLE_CHARS: usize = 120;

fn validate_project_path(project_path: &str) -> Result<(), String> {
    let path = Path::new(project_path);
    if !path.is_absolute() {
        return Err("project_path must be absolute".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve project_path: {error}"))?;
    if !canonical.is_dir() {
        return Err("project_path is not a directory".to_string());
    }
    Ok(())
}

fn title_prompt(original_prompt: &str) -> String {
    let prompt = if original_prompt.chars().count() > MAX_PROMPT_CHARS {
        format!(
            "{}...",
            original_prompt
                .chars()
                .take(MAX_PROMPT_CHARS)
                .collect::<String>()
        )
    } else {
        original_prompt.to_string()
    };
    format!(
        "Generate one concise task title for the request below. Match its primary language. Start with a verb, describe the core work, use at most {MAX_TITLE_CHARS} characters, and output exactly one line wrapped in <TITLE> and </TITLE>. No explanation.\n\nRequest:\n{prompt}",
    )
}

async fn read_pipe<R: AsyncRead + Unpin>(mut pipe: R, name: &str) -> Result<Vec<u8>, String> {
    let mut contents = Vec::new();
    pipe.read_to_end(&mut contents)
        .await
        .map_err(|error| format!("Failed to read agent {name}: {error}"))?;
    Ok(contents)
}

fn extract_title(output: &str) -> Option<String> {
    let close = output.rfind("</TITLE>")?;
    let open = output[..close].rfind("<TITLE>")? + "<TITLE>".len();
    let title = output[open..close]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let title = title
        .trim_matches(|character: char| matches!(character, '"' | '\'' | '`'))
        .trim_end_matches(|character: char| {
            matches!(character, '.' | '。' | '!' | '！' | '?' | '？')
        })
        .trim();
    if title.is_empty() {
        None
    } else {
        Some(title.chars().take(MAX_TITLE_CHARS).collect())
    }
}

#[tauri::command]
pub async fn generate_task_name(
    project_path: String,
    agent: String,
    original_prompt: String,
) -> Result<String, String> {
    if !matches!(agent.as_str(), "claude" | "codex") {
        return Err(format!("Unsupported agent: {agent}"));
    }
    validate_project_path(&project_path)?;

    let prompt = title_prompt(&original_prompt);
    let program = crate::platform::resolve_spawn_program(&agent);
    let mut command = tokio::process::Command::new(program);
    crate::platform::configure_background_command(&mut command);
    if agent == "codex" {
        command.args([
            "exec",
            "--sandbox",
            "read-only",
            "--ephemeral",
            "-c",
            "approval_policy=\"never\"",
            &prompt,
        ]);
    } else {
        command.args([
            "-p",
            &prompt,
            "--output-format",
            "text",
            "--permission-mode",
            "plan",
            "--tools",
            "",
            "--no-session-persistence",
        ]);
    }
    command
        .current_dir(project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for (key, value) in crate::platform::login_shell_env() {
        command.env(key, value);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start {agent}: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture agent stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture agent stderr".to_string())?;
    let stdout_task = tokio::spawn(read_pipe(stdout, "stdout"));
    let stderr_task = tokio::spawn(read_pipe(stderr, "stderr"));

    let status = match tokio::time::timeout(TITLE_TIMEOUT, child.wait()).await {
        Ok(result) => result.map_err(|error| format!("Agent wait failed: {error}"))?,
        Err(_) => {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
            stdout_task.abort();
            stderr_task.abort();
            return Err("Task title generation timed out".to_string());
        }
    };
    let stdout = stdout_task
        .await
        .map_err(|error| format!("Agent stdout task failed: {error}"))??;
    let stderr = stderr_task
        .await
        .map_err(|error| format!("Agent stderr task failed: {error}"))??;
    if !status.success() {
        return Err(format!(
            "Agent failed: {}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    extract_title(&String::from_utf8_lossy(&stdout))
        .ok_or_else(|| "Agent did not return a valid title".to_string())
}

#[cfg(test)]
mod tests {
    use super::extract_title;

    #[test]
    fn extracts_the_last_wrapped_title_and_normalizes_whitespace() {
        let output = "<TITLE>Example</TITLE>\n<TITLE>  修复   任务标题  。 </TITLE>";
        assert_eq!(extract_title(output).as_deref(), Some("修复 任务标题"));
    }
}
