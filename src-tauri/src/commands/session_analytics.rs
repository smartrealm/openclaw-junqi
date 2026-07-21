// ── Session metrics ───────────────────────────────────────────────────────────
//
// Ported from junqi's analytics.rs (src-tauri/src/junqi/analytics.rs).
// Differences from upstream:
//   - Uses std::sync::Mutex + std::sync::OnceLock instead of parking_lot / once_cell
//     (junqi doesn't depend on either crate).
//   - Public API: `read_session_metrics` matches junqi's signature so the
//     existing frontend RunningView can call it without changes.
//
// Reads Claude/Codex session JSONL files and aggregates:
//   - tool_calls (count of `tool_use` for Claude, `function_call`/`custom_tool_call` for Codex)
//   - duration_secs (first↔last timestamp delta)
//   - session_file_bytes (file size)
//   - total_tokens (sum of input/output/cache tokens)
//   - context_tokens (last prompt size, ≈ current context window usage)
//   - context_window (Codex only — Claude sessions don't expose it)

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

#[derive(serde::Serialize, Clone, Default)]
pub struct SessionMetrics {
    pub tool_calls: u64,
    pub duration_secs: f64,
    pub session_file_bytes: u64,
    /// 任务累计 token 消耗（包含缓存命中 / reasoning），用于 UI"总消耗"。
    pub total_tokens: u64,
    /// 当前上下文占用（最后一轮 prompt 大小）。Codex 直读，Claude 由最后一条 assistant 推导。
    pub context_tokens: u64,
    /// 模型上下文窗口大小。仅 Codex 自带；Claude session 不暴露此值，留 0 让前端隐藏。
    pub context_window: u64,
}

fn metrics_cache() -> &'static Mutex<HashMap<String, (SystemTime, SessionMetrics)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (SystemTime, SessionMetrics)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn parse_rfc3339_secs(ts: &str) -> Option<f64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp() as f64 + dt.timestamp_subsec_millis() as f64 / 1000.0)
}

fn track_timestamp(val: &Value, first: &mut Option<f64>, last: &mut Option<f64>) {
    if let Some(ts_str) = val.get("timestamp").and_then(|v| v.as_str()) {
        if let Some(ts) = parse_rfc3339_secs(ts_str) {
            if first.is_none() {
                *first = Some(ts);
            }
            *last = Some(ts);
        }
    }
}

fn duration_from(first: Option<f64>, last: Option<f64>) -> f64 {
    match (first, last) {
        (Some(a), Some(b)) => (b - a).max(0.0),
        _ => 0.0,
    }
}

/// 探测格式：与 `session.rs::is_codex_format` 保持一致——前 10 行内出现
/// `type=session_meta` 或 `type=event_msg` 即视为 Codex。
fn is_codex_session(content: &str) -> bool {
    for line in content.lines().take(10) {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("session_meta") | Some("event_msg") => return true,
            _ => {}
        }
    }
    false
}

fn parse_claude_metrics(content: &str) -> SessionMetrics {
    let mut input_tokens: u64 = 0;
    let mut output_tokens: u64 = 0;
    let mut cache_creation: u64 = 0;
    let mut cache_read: u64 = 0;
    let mut tool_calls: u64 = 0;
    let mut last_context: u64 = 0;
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        track_timestamp(&val, &mut first_ts, &mut last_ts);

        if val.get("type").and_then(|v| v.as_str()) != Some("assistant") {
            continue;
        }
        let Some(message) = val.get("message") else {
            continue;
        };

        if let Some(usage) = message.get("usage") {
            let inp = usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let out = usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cc = usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let cr = usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            input_tokens += inp;
            output_tokens += out;
            cache_creation += cc;
            cache_read += cr;
            last_context = inp + cc + cr;
        }

        if let Some(arr) = message.get("content").and_then(|v| v.as_array()) {
            for item in arr {
                if item.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    tool_calls += 1;
                }
            }
        }
    }

    SessionMetrics {
        tool_calls,
        duration_secs: duration_from(first_ts, last_ts),
        session_file_bytes: 0,
        total_tokens: input_tokens + output_tokens + cache_creation + cache_read,
        context_tokens: last_context,
        context_window: 0,
    }
}

fn parse_codex_metrics(content: &str) -> SessionMetrics {
    let mut tool_calls: u64 = 0;
    let mut last_token_info: Option<Value> = None;
    let mut first_ts: Option<f64> = None;
    let mut last_ts: Option<f64> = None;

    for line in content.lines() {
        let Ok(val) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        track_timestamp(&val, &mut first_ts, &mut last_ts);

        let t = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = val.get("payload");
        let pt = payload
            .and_then(|p| p.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match (t, pt) {
            ("event_msg", "token_count") => {
                if let Some(info) = payload.and_then(|p| p.get("info")) {
                    if !info.is_null() {
                        last_token_info = Some(info.clone());
                    }
                }
            }
            ("response_item", "function_call") | ("response_item", "custom_tool_call") => {
                tool_calls += 1;
            }
            _ => {}
        }
    }

    let (total_tokens, context_tokens, context_window) =
        if let Some(info) = last_token_info.as_ref() {
            let total = info.get("total_token_usage");
            let last = info.get("last_token_usage");
            let tot = total
                .and_then(|t| t.get("total_tokens"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let ctx = last
                .and_then(|l| l.get("total_tokens"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            let win = info
                .get("model_context_window")
                .and_then(|v| v.as_u64())
                .unwrap_or(0);
            (tot, ctx, win)
        } else {
            (0, 0, 0)
        };

    SessionMetrics {
        tool_calls,
        duration_secs: duration_from(first_ts, last_ts),
        session_file_bytes: 0,
        total_tokens,
        context_tokens,
        context_window,
    }
}

fn parse_session_metrics_from_path(path: &std::path::Path) -> SessionMetrics {
    let Ok(content) = std::fs::read_to_string(path) else {
        return SessionMetrics::default();
    };
    let session_file_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let mut metrics = if is_codex_session(&content) {
        parse_codex_metrics(&content)
    } else {
        parse_claude_metrics(&content)
    };
    metrics.session_file_bytes = session_file_bytes;
    metrics
}

fn parse_session_metrics_cached(path: &std::path::Path) -> SessionMetrics {
    let path_str = path.to_string_lossy().to_string();

    let modified = match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(t) => t,
        Err(_) => return SessionMetrics::default(),
    };

    {
        let cache = metrics_cache().lock().expect("metrics cache poisoned");
        if let Some((cached_time, cached_metrics)) = cache.get(&path_str) {
            if *cached_time == modified {
                return cached_metrics.clone();
            }
        }
    }

    let metrics = parse_session_metrics_from_path(path);

    {
        let mut cache = metrics_cache().lock().expect("metrics cache poisoned");
        cache.insert(path_str, (modified, metrics.clone()));
    }

    metrics
}

#[tauri::command]
pub async fn read_session_metrics(session_path: String) -> Result<SessionMetrics, String> {
    tokio::task::spawn_blocking(move || {
        let path = std::path::Path::new(&session_path);
        if !path.exists() {
            return Err(format!("Session file not found: {}", session_path));
        }
        Ok(parse_session_metrics_cached(path))
    })
    .await
    .map_err(|e| format!("read_session_metrics join error: {}", e))?
}

// ── Session messages (ported from junqi session.rs) ─────────────────────────
//
// Used by the SessionView to display past conversation turns.
// Output shape (must match junqi's serialized form so SessionView can render it):
//   SessionMessage { role: "user"|"assistant", content: [SessionContent] }
//   SessionContent (tagged enum):
//     { type: "text", text: string }
//     { type: "tool_use", id, name, input }
//     { type: "thinking", thinking: string }

#[derive(serde::Serialize, Clone)]
pub struct SessionMessage {
    pub role: String,
    pub content: Vec<SessionContent>,
}

#[derive(serde::Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionContent {
    Text {
        text: String,
    },
    ToolUse {
        id: String,
        name: String,
        input: String,
    },
    Thinking {
        thinking: String,
    },
}

fn is_codex_format(lines: &[&str]) -> bool {
    for line in lines.iter().take(10) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            match val.get("type").and_then(|v| v.as_str()) {
                Some("session_meta") | Some("event_msg") => return true,
                _ => {}
            }
        }
    }
    false
}

fn parse_claude_session(lines: &[&str]) -> Vec<SessionMessage> {
    let mut messages = Vec::new();
    for line in lines {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let msg_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let Some(message) = val.get("message") else {
            continue;
        };

        match msg_type {
            "user" => {
                let parts = claude_user_content(message.get("content"));
                if !parts.is_empty() {
                    messages.push(SessionMessage {
                        role: "user".to_string(),
                        content: parts,
                    });
                }
            }
            "assistant" => {
                let parts = message
                    .get("content")
                    .and_then(|c| c.as_array())
                    .map(|arr| claude_assistant_blocks(arr))
                    .unwrap_or_default();
                if !parts.is_empty() {
                    messages.push(SessionMessage {
                        role: "assistant".to_string(),
                        content: parts,
                    });
                }
            }
            _ => {}
        }
    }
    messages
}

fn claude_user_content(content: Option<&serde_json::Value>) -> Vec<SessionContent> {
    match content {
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => {
            vec![SessionContent::Text { text: s.clone() }]
        }
        Some(serde_json::Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|b| {
                if b.get("type").and_then(|v| v.as_str()) == Some("text") {
                    let text = b.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    if !text.trim().is_empty() {
                        return Some(SessionContent::Text {
                            text: text.to_string(),
                        });
                    }
                }
                None
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn claude_assistant_blocks(blocks: &[serde_json::Value]) -> Vec<SessionContent> {
    let mut parts = Vec::new();
    for block in blocks {
        match block.get("type").and_then(|v| v.as_str()) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                    if !text.trim().is_empty() {
                        parts.push(SessionContent::Text {
                            text: text.to_string(),
                        });
                    }
                }
            }
            Some("tool_use") => {
                let id = block
                    .get("id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = block
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let input = block
                    .get("input")
                    .and_then(|v| serde_json::to_string_pretty(v).ok())
                    .unwrap_or_default();
                parts.push(SessionContent::ToolUse { id, name, input });
            }
            Some("thinking") => {
                if let Some(thinking) = block.get("thinking").and_then(|v| v.as_str()) {
                    if !thinking.trim().is_empty() {
                        parts.push(SessionContent::Thinking {
                            thinking: thinking.to_string(),
                        });
                    }
                }
            }
            _ => {}
        }
    }
    parts
}

fn parse_codex_session(lines: &[&str]) -> Vec<SessionMessage> {
    let mut messages: Vec<SessionMessage> = Vec::new();
    for line in lines {
        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let event_type = val.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let payload = val.get("payload");

        match event_type {
            "event_msg" => {
                let payload_type = payload
                    .and_then(|p| p.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if payload_type == "user_message" {
                    let text = payload
                        .and_then(|p| p.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if !text.trim().is_empty() {
                        messages.push(SessionMessage {
                            role: "user".to_string(),
                            content: vec![SessionContent::Text {
                                text: text.to_string(),
                            }],
                        });
                    }
                }
            }
            "response_item" => {
                let payload_type = payload
                    .and_then(|p| p.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                match payload_type {
                    "message" => {
                        let role = payload
                            .and_then(|p| p.get("role"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        if role != "assistant" {
                            continue;
                        }
                        let parts: Vec<SessionContent> = payload
                            .and_then(|p| p.get("content"))
                            .and_then(|v| v.as_array())
                            .map(|blocks| {
                                blocks
                                    .iter()
                                    .filter_map(|b| {
                                        let t = b.get("type").and_then(|v| v.as_str())?;
                                        if matches!(t, "output_text" | "text") {
                                            let text = b.get("text").and_then(|v| v.as_str())?;
                                            if !text.trim().is_empty() {
                                                return Some(SessionContent::Text {
                                                    text: text.to_string(),
                                                });
                                            }
                                        }
                                        None
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        if !parts.is_empty() {
                            if messages.last().map(|m| m.role.as_str()) == Some("assistant") {
                                messages.last_mut().unwrap().content.extend(parts);
                            } else {
                                messages.push(SessionMessage {
                                    role: "assistant".to_string(),
                                    content: parts,
                                });
                            }
                        }
                    }
                    "function_call" => {
                        let call_id = payload
                            .and_then(|p| p.get("call_id"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let name = payload
                            .and_then(|p| p.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let raw = payload
                            .and_then(|p| p.get("arguments"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("{}");
                        let input = serde_json::from_str::<serde_json::Value>(raw)
                            .ok()
                            .and_then(|v| serde_json::to_string_pretty(&v).ok())
                            .unwrap_or_else(|| raw.to_string());
                        let part = SessionContent::ToolUse {
                            id: call_id,
                            name,
                            input,
                        };
                        if messages.last().map(|m| m.role.as_str()) == Some("assistant") {
                            messages.last_mut().unwrap().content.push(part);
                        } else {
                            messages.push(SessionMessage {
                                role: "assistant".to_string(),
                                content: vec![part],
                            });
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    messages
}

#[tauri::command]
pub async fn read_session_messages(session_path: String) -> Result<Vec<SessionMessage>, String> {
    tokio::task::spawn_blocking(move || {
        let content = std::fs::read_to_string(&session_path).map_err(|e| e.to_string())?;
        let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        Ok(if is_codex_format(&lines) {
            parse_codex_session(&lines)
        } else {
            parse_claude_session(&lines)
        })
    })
    .await
    .map_err(|e| format!("read_session_messages join error: {}", e))?
}

// ── Export session to markdown ──────────────────────────────────────────────

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ExportTaskMeta {
    pub name: Option<String>,
    pub prompt: String,
    pub agent: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// Pure render: serialize session messages into a Markdown document.
/// Tested independently from the file-writing path.
fn render_session_markdown(messages: &[SessionMessage], meta: &ExportTaskMeta) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "# {}\n",
        meta.name.as_deref().unwrap_or("Agent session")
    );
    let _ = writeln!(out, "- Agent: `{}`", meta.agent);
    if !meta.prompt.is_empty() {
        let prompt_one_line = meta.prompt.lines().next().unwrap_or("").trim();
        if !prompt_one_line.is_empty() {
            let _ = writeln!(out, "- Prompt: {}", prompt_one_line);
        }
    }
    if let Some(sid) = &meta.session_id {
        let _ = writeln!(out, "- Session ID: `{}`", sid);
    }
    if meta.created_at > 0 {
        let _ = writeln!(out, "- Created: {}", meta.created_at);
    }
    let _ = writeln!(out, "\n---\n");

    for (idx, msg) in messages.iter().enumerate() {
        let role = if msg.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        let _ = writeln!(out, "## {}. {}\n", idx + 1, role);
        for chunk in &msg.content {
            match chunk {
                SessionContent::Text { text } => {
                    let _ = writeln!(out, "{}", text);
                }
                SessionContent::ToolUse { name, input, .. } => {
                    let _ = writeln!(out, "**Tool: `{}`**\n\n```json\n{}\n```", name, input);
                }
                SessionContent::Thinking { thinking } => {
                    let _ = writeln!(
                        out,
                        "<details><summary>Thinking</summary>\n\n{}\n\n</details>",
                        thinking
                    );
                }
            }
        }
        let _ = writeln!(out);
    }
    out
}

#[tauri::command]
pub async fn export_session_markdown(
    session_path: String,
    output_path: String,
    task_meta: ExportTaskMeta,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || -> Result<String, String> {
        let content = std::fs::read_to_string(&session_path).map_err(|e| e.to_string())?;
        let lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
        let messages = if is_codex_format(&lines) {
            parse_codex_session(&lines)
        } else {
            parse_claude_session(&lines)
        };

        let markdown = render_session_markdown(&messages, &task_meta);

        // Defensive path validation: ensure output_path is absolute. We don't
        // restrict to the project dir because users typically export to
        // ~/Downloads or similar.
        let out = std::path::PathBuf::from(&output_path);
        if !out.is_absolute() {
            return Err("output_path must be absolute".to_string());
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&out, markdown.as_bytes()).map_err(|e| e.to_string())?;
        Ok(output_path)
    })
    .await
    .map_err(|e| format!("export_session_markdown join error: {}", e))?
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn render_markdown_includes_metadata_header() {
        let meta = ExportTaskMeta {
            name: Some("My task".into()),
            prompt: "do something\nwith newline".into(),
            agent: "claude".into(),
            created_at: 1700000000,
            session_id: Some("sess-abc".into()),
        };
        let out = render_session_markdown(&[], &meta);
        assert!(out.starts_with("# My task"));
        assert!(out.contains("- Agent: `claude`"));
        assert!(out.contains("- Prompt: do something"));
        assert!(out.contains("- Session ID: `sess-abc`"));
        assert!(out.contains("- Created: 1700000000"));
    }

    #[test]
    fn render_markdown_text_chunk() {
        let meta = ExportTaskMeta {
            name: None,
            prompt: "".into(),
            agent: "codex".into(),
            created_at: 0,
            session_id: None,
        };
        let messages = vec![SessionMessage {
            role: "user".into(),
            content: vec![SessionContent::Text {
                text: "hello".into(),
            }],
        }];
        let out = render_session_markdown(&messages, &meta);
        assert!(out.contains("## 1. User"));
        assert!(out.contains("hello"));
    }

    #[test]
    fn render_markdown_tool_use_chunk_includes_json() {
        let meta = ExportTaskMeta {
            name: None,
            prompt: "".into(),
            agent: "claude".into(),
            created_at: 0,
            session_id: None,
        };
        let messages = vec![SessionMessage {
            role: "assistant".into(),
            content: vec![SessionContent::ToolUse {
                id: "toolu_1".into(),
                name: "Read".into(),
                input: "{\"file\":\"/a/b\"}".into(),
            }],
        }];
        let out = render_session_markdown(&messages, &meta);
        assert!(out.contains("**Tool: `Read`**"));
        assert!(out.contains("\"file\":\"/a/b\""));
    }

    #[test]
    fn render_markdown_thinking_chunk_in_details() {
        let meta = ExportTaskMeta {
            name: None,
            prompt: "".into(),
            agent: "claude".into(),
            created_at: 0,
            session_id: None,
        };
        let messages = vec![SessionMessage {
            role: "assistant".into(),
            content: vec![SessionContent::Thinking {
                thinking: "considering next move".into(),
            }],
        }];
        let out = render_session_markdown(&messages, &meta);
        assert!(out.contains("<details>"));
        assert!(out.contains("considering next move"));
        assert!(out.contains("</details>"));
    }

    #[test]
    fn render_markdown_uses_default_title_when_name_missing() {
        let meta = ExportTaskMeta {
            name: None,
            prompt: "".into(),
            agent: "claude".into(),
            created_at: 0,
            session_id: None,
        };
        let out = render_session_markdown(&[], &meta);
        assert!(out.starts_with("# Agent session"));
    }

    #[test]
    fn render_markdown_skips_empty_prompt_line() {
        let meta = ExportTaskMeta {
            name: None,
            prompt: "\n\n  \n".into(),
            agent: "claude".into(),
            created_at: 0,
            session_id: None,
        };
        let out = render_session_markdown(&[], &meta);
        assert!(!out.contains("- Prompt:"));
    }
}
