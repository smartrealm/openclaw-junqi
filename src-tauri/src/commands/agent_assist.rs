use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};

const TITLE_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_PROMPT_CHARS: usize = 4_000;
const MAX_TITLE_CHARS: usize = 120;
const MAX_SESSION_BYTES_FOR_SUMMARY: u64 = 50 * 1024 * 1024;
const MAX_SESSION_LINES_FOR_SUMMARY: usize = 20_000;
const SESSION_SUMMARY_BUDGET: usize = 7_000;

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

fn title_prompt(original_prompt: &str, summary: Option<&str>) -> String {
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
        "Generate one concise task title for the request below and, when available, the session execution summary. Match its primary language. Start with a verb and describe the core work actually performed. If the execution differs from the request, follow the execution summary. Use at most {MAX_TITLE_CHARS} characters, and output exactly one line wrapped in <TITLE> and </TITLE>. No explanation.\n\nRequest:\n{prompt}\n\nSession execution summary:\n{}",
        summary.unwrap_or("(No session summary available.)"),
    )
}

fn session_roots(project_path: &str, is_codex: bool) -> Vec<PathBuf> {
    if is_codex {
        let mut roots = vec![PathBuf::from(project_path).join(".codex").join("sessions")];
        if let Some(home) = crate::platform::home_dir() {
            roots.push(home.join(".codex").join("sessions"));
        }
        roots
    } else {
        let Some(home) = crate::platform::home_dir() else {
            return Vec::new();
        };
        let encoded: String = project_path
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || character == '-' {
                    character
                } else {
                    '-'
                }
            })
            .collect();
        vec![home.join(".claude").join("projects").join(encoded)]
    }
}

fn validate_session_path(
    session_path: &str,
    project_path: &str,
    is_codex: bool,
) -> Result<PathBuf, String> {
    let path = Path::new(session_path);
    if !path.is_absolute() {
        return Err("Session path must be absolute".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve session path: {error}"))?;
    if !canonical.is_file() {
        return Err("Session path is not a regular file".to_string());
    }
    let allowed = session_roots(project_path, is_codex)
        .into_iter()
        .filter_map(|root| root.canonicalize().ok())
        .any(|root| canonical.starts_with(root));
    if !allowed {
        return Err(format!(
            "Session path is outside allowed session roots: {}",
            canonical.display()
        ));
    }
    Ok(canonical)
}

fn collapse_text(text: &str) -> String {
    let collapsed = text
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if collapsed.chars().count() <= 400 {
        collapsed
    } else {
        collapsed.chars().take(400).collect::<String>() + "…"
    }
}

fn collect_content_text(value: &serde_json::Value) -> Vec<String> {
    match value {
        serde_json::Value::String(text) => vec![collapse_text(text)],
        serde_json::Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let kind = item
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("");
                if matches!(kind, "text" | "input_text" | "output_text") {
                    item.get("text")
                        .and_then(serde_json::Value::as_str)
                        .map(collapse_text)
                } else {
                    None
                }
            })
            .filter(|text| !text.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn summary_line(value: &serde_json::Value) -> Option<String> {
    let top_type = value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if matches!(top_type, "user" | "assistant") {
        let content = value.get("message")?.get("content")?;
        let text = collect_content_text(content).join(" ");
        return (!text.is_empty()).then(|| format!("[{top_type}] {text}"));
    }
    if top_type == "response_item" {
        let payload = value.get("payload")?;
        if payload.get("type").and_then(serde_json::Value::as_str) != Some("message") {
            return None;
        }
        let role = payload.get("role").and_then(serde_json::Value::as_str)?;
        if !matches!(role, "user" | "assistant") {
            return None;
        }
        let text = collect_content_text(payload.get("content")?).join(" ");
        return (!text.is_empty()).then(|| format!("[{role}] {text}"));
    }
    None
}

fn fit_summary_budget(messages: &[String], budget: usize) -> Option<String> {
    if messages.is_empty() {
        return None;
    }
    let joined = messages.join("\n");
    if joined.len() <= budget {
        return Some(joined);
    }
    let half = budget / 2;
    let mut head = Vec::new();
    let mut head_size = 0;
    for message in messages {
        if head_size + message.len() + 1 > half {
            break;
        }
        head_size += message.len() + 1;
        head.push(message.as_str());
    }
    let mut tail = Vec::new();
    let mut tail_size = 0;
    for message in messages.iter().rev() {
        if tail.len() + head.len() >= messages.len() || tail_size + message.len() + 1 > half {
            break;
        }
        tail_size += message.len() + 1;
        tail.push(message.as_str());
    }
    tail.reverse();
    let omitted = messages.len().saturating_sub(head.len() + tail.len());
    Some(format!(
        "{}\n... [{omitted} messages omitted] ...\n{}",
        head.join("\n"),
        tail.join("\n")
    ))
}

fn extract_session_summary(path: &Path) -> Option<String> {
    if path.metadata().ok()?.len() > MAX_SESSION_BYTES_FOR_SUMMARY {
        return None;
    }
    let reader = BufReader::new(File::open(path).ok()?);
    let half = MAX_SESSION_LINES_FOR_SUMMARY / 2;
    let mut head = Vec::new();
    let mut tail = std::collections::VecDeque::new();
    for line in reader
        .lines()
        .map_while(Result::ok)
        .filter(|line| !line.trim().is_empty())
    {
        if head.len() < half {
            head.push(line);
        } else {
            tail.push_back(line);
            if tail.len() > half {
                tail.pop_front();
            }
        }
    }
    head.extend(tail);
    let messages: Vec<String> = head
        .iter()
        .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
        .filter_map(|value| summary_line(&value))
        .collect();
    fit_summary_budget(&messages, SESSION_SUMMARY_BUDGET)
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

fn extract_codex_title(output: &str) -> Option<String> {
    let mut section_start = None;
    let mut offset = 0;
    for line in output.split_inclusive('\n') {
        if line.trim() == "codex" {
            section_start = Some(offset + line.len());
        }
        offset += line.len();
    }
    extract_title(&output[section_start?..])
}

#[tauri::command]
pub async fn generate_task_name(
    project_path: String,
    agent: String,
    session_path: Option<String>,
    original_prompt: String,
) -> Result<String, String> {
    if !matches!(agent.as_str(), "claude" | "codex") {
        return Err(format!("Unsupported agent: {agent}"));
    }
    validate_project_path(&project_path)?;

    let is_codex = agent == "codex";
    let summary = if let Some(raw_path) = session_path {
        let project = project_path.clone();
        tokio::task::spawn_blocking(move || {
            validate_session_path(&raw_path, &project, is_codex)
                .ok()
                .and_then(|path| extract_session_summary(&path))
        })
        .await
        .map_err(|error| format!("Session summary task failed: {error}"))?
    } else {
        None
    };
    let prompt = title_prompt(&original_prompt, summary.as_deref());
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
    let output = String::from_utf8_lossy(&stdout);
    (if is_codex {
        extract_codex_title(&output)
    } else {
        extract_title(&output)
    })
    .ok_or_else(|| "Agent did not return a valid title".to_string())
}

#[cfg(test)]
mod tests {
    use super::{extract_codex_title, extract_title, fit_summary_budget, summary_line};

    #[test]
    fn extracts_the_last_wrapped_title_and_normalizes_whitespace() {
        let output = "<TITLE>Example</TITLE>\n<TITLE>  修复   任务标题  。 </TITLE>";
        assert_eq!(extract_title(output).as_deref(), Some("修复 任务标题"));
    }

    #[test]
    fn extracts_only_user_and_assistant_text_for_session_summary() {
        let claude = serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":"fixed\nlogin"},{"type":"tool_use","name":"Bash"}]}});
        let codex = serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"run tests"}]}});
        let tool = serde_json::json!({"type":"response_item","payload":{"type":"function_call","name":"exec"}});
        assert_eq!(
            summary_line(&claude).as_deref(),
            Some("[assistant] fixed login")
        );
        assert_eq!(summary_line(&codex).as_deref(), Some("[user] run tests"));
        assert_eq!(summary_line(&tool), None);
        assert!(
            fit_summary_budget(&["a".repeat(20), "b".repeat(20), "c".repeat(20)], 45)
                .unwrap()
                .contains("omitted")
        );
    }

    #[test]
    fn codex_title_ignores_wrapped_examples_before_the_final_codex_section() {
        let output = "user\n<TITLE>Example</TITLE>\ncodex\n<TITLE>修复真实问题</TITLE>\n";
        assert_eq!(extract_codex_title(output).as_deref(), Some("修复真实问题"));
    }
}
