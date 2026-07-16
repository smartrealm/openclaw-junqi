use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueContext {
    error: String,
    logs: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueChatRequest {
    api: String,
    base_url: String,
    api_key: String,
    model_id: String,
    messages: Vec<RescueMessage>,
    context: RescueContext,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueChatResponse {
    text: String,
}

fn trim_slash(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

fn endpoint(base_url: &str, suffix: &str) -> Result<String, String> {
    let base = trim_slash(base_url);
    if base.is_empty() {
        return Err("Missing provider endpoint".into());
    }
    let last = base
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if last == "v1beta" || last == "v1" {
        Ok(format!("{}/{}", base, suffix))
    } else if last.starts_with('v') && last[1..].chars().all(|c| c.is_ascii_digit()) {
        Ok(format!("{}/{}", base, suffix))
    } else {
        Ok(format!("{}/v1/{}", base, suffix))
    }
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let total = value.chars().count();
    if total <= max_chars {
        return value.to_string();
    }
    value.chars().skip(total - max_chars).collect()
}

fn rescue_system_prompt(ctx: &RescueContext) -> String {
    let logs = ctx.logs.clone().unwrap_or_default();
    // Logs stay local until this exact boundary. Sanitize again here even
    // though Gateway ingestion also redacts, because callers can send an
    // arbitrary diagnostic context through the IPC command.
    let error = crate::commands::diagnostic_output::sanitize_diagnostic_text(&ctx.error, 2_000);
    let tail = crate::commands::diagnostic_output::sanitize_diagnostic_text(
        &tail_chars(&logs, 8_000),
        8_000,
    );
    [
        "You are JunQi Desktop local recovery assistant.",
        "The OpenClaw Gateway cannot start, so the user is talking to you through a direct provider fallback.",
        "Diagnose from the supplied error/logs. Be concise, practical, and avoid destructive steps unless explicitly requested.",
        "Prefer safe actions: explain likely cause, suggest doctor --fix, config backup/restore, port checks, and provider config validation.",
        "",
        "Gateway error:",
        error.as_str(),
        "",
        "Gateway logs:",
        if tail.trim().is_empty() { "(none)" } else { tail.as_str() },
    ]
    .join("\n")
}

fn openai_body(req: &RescueChatRequest) -> serde_json::Value {
    let mut messages = vec![json!({
        "role": "system",
        "content": rescue_system_prompt(&req.context),
    })];
    for msg in &req.messages {
        messages.push(json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }
    json!({
        "model": req.model_id,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 900,
    })
}

fn anthropic_body(req: &RescueChatRequest) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = req
        .messages
        .iter()
        .map(|msg| json!({ "role": msg.role, "content": msg.content }))
        .collect();
    json!({
        "model": req.model_id,
        "system": rescue_system_prompt(&req.context),
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 900,
    })
}

fn assistant_text(payload: &serde_json::Value) -> String {
    if let Some(text) = payload
        .get("choices")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.as_str())
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if let Some(parts) = payload.get("content").and_then(|v| v.as_array()) {
        let text = parts
            .iter()
            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        if !text.is_empty() {
            return text;
        }
    }

    serde_json::to_string_pretty(payload)
        .unwrap_or_else(|_| "(empty response)".into())
        .chars()
        .take(2000)
        .collect()
}

fn provider_error_message(payload: &serde_json::Value) -> String {
    let message = payload
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("message").and_then(|value| value.as_str()))
        .map(str::to_owned)
        .unwrap_or_else(|| assistant_text(payload));
    let sanitized = crate::commands::diagnostic_output::sanitize_diagnostic_text(&message, 1_000);
    if sanitized.trim().is_empty() {
        "Provider returned an empty error response".to_string()
    } else {
        sanitized
    }
}

fn rescue_transport_error(context: &str, error: impl std::fmt::Display) -> String {
    let message = format!("{context}: {error}");
    let sanitized = crate::commands::diagnostic_output::sanitize_diagnostic_text(&message, 1_000);
    if sanitized.trim().is_empty() {
        "Rescue request failed without a usable diagnostic".to_string()
    } else {
        sanitized
    }
}

#[tauri::command]
pub async fn gateway_rescue_chat(req: RescueChatRequest) -> Result<RescueChatResponse, String> {
    let api = req.api.trim();
    let url = match api {
        "anthropic-messages" => endpoint(&req.base_url, "messages")?,
        "openai-compatible" => endpoint(&req.base_url, "chat/completions")?,
        _ => return Err(format!("Unsupported rescue provider API: {}", api)),
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|error| rescue_transport_error("Failed to create HTTP client", error))?;

    let mut builder = client.post(url).header("content-type", "application/json");
    let body = if api == "anthropic-messages" {
        builder = builder
            .header("x-api-key", req.api_key.trim())
            .header("anthropic-version", "2023-06-01");
        anthropic_body(&req)
    } else {
        builder = builder.header("authorization", format!("Bearer {}", req.api_key.trim()));
        openai_body(&req)
    };

    let response = builder
        .json(&body)
        .send()
        .await
        .map_err(|error| rescue_transport_error("Rescue request failed", error))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| rescue_transport_error("Failed to read rescue response", error))?;
    let payload: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| json!({ "text": text }));

    if !status.is_success() {
        let message = provider_error_message(&payload);
        return Err(format!("{} {}", status.as_u16(), message));
    }

    Ok(RescueChatResponse {
        text: assistant_text(&payload),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tail_chars_keeps_utf8_boundary() {
        let logs = format!("{}{}", "启动失败：端口被占用。".repeat(1200), "final");
        let tail = tail_chars(&logs, 8000);
        assert!(tail.ends_with("final"));
        assert!(tail.chars().count() <= 8000);
    }

    #[test]
    fn endpoint_adds_v1_for_plain_base_url() {
        assert_eq!(
            endpoint("https://api.example.com", "chat/completions").unwrap(),
            "https://api.example.com/v1/chat/completions"
        );
    }

    #[test]
    fn rescue_prompt_never_contains_credentials_from_error_or_logs() {
        let prompt = rescue_system_prompt(&RescueContext {
            error: "Gateway failed with api_key=super-secret".to_string(),
            logs: Some(
                "Authorization: Bearer hidden-token\nsk-visible-token-123456789".to_string(),
            ),
        });
        assert!(!prompt.contains("super-secret"));
        assert!(!prompt.contains("hidden-token"));
        assert!(!prompt.contains("sk-visible-token-123456789"));
        assert!(prompt.contains("[sensitive diagnostic redacted]"));
    }

    #[test]
    fn provider_failure_message_is_bounded_and_redacted_before_ipc() {
        let message = provider_error_message(&json!({
            "error": {
                "message": "Authorization: Bearer hidden-token\\nrequest api_key=super-secret"
            }
        }));
        assert!(!message.contains("hidden-token"));
        assert!(!message.contains("super-secret"));
        assert!(message.contains("[sensitive diagnostic redacted]"));
    }

    #[test]
    fn transport_failure_message_is_bounded_and_redacted_before_ipc() {
        let message = rescue_transport_error(
            "Rescue request failed",
            "proxy rejected Authorization: Bearer hidden-token; api_key=super-secret",
        );
        assert!(!message.contains("hidden-token"));
        assert!(!message.contains("super-secret"));
        assert!(message.contains("[sensitive diagnostic redacted]"));
    }
}
