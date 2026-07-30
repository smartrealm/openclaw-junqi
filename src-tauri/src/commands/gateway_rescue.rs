use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

const MODEL_LIST_TIMEOUT: Duration = Duration::from_secs(30);
const MODEL_RUN_TIMEOUT: Duration = Duration::from_secs(90);
const MAX_MODEL_REF_CHARS: usize = 512;
const MAX_MESSAGES: usize = 12;
const MAX_MESSAGE_CHARS: usize = 2_000;
const MAX_ERROR_CHARS: usize = 2_000;
const MAX_LOG_CHARS: usize = 6_000;

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueChatRequest {
    model_ref: String,
    messages: Vec<RescueMessage>,
    context: RescueContext,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescueChatResponse {
    text: String,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RescueTarget {
    provider_id: String,
    model_id: String,
    model_ref: String,
    source: String,
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let total = value.chars().count();
    if total <= max_chars {
        return value.to_string();
    }
    value.chars().skip(total - max_chars).collect()
}

fn bounded_sanitized(value: &str, max_chars: usize) -> String {
    crate::commands::diagnostic_output::sanitize_diagnostic_text(
        &tail_chars(value, max_chars),
        max_chars,
    )
}

fn validate_model_ref(value: &str) -> Result<&str, String> {
    let model_ref = value.trim();
    let slash = model_ref.find('/');
    let valid = !model_ref.is_empty()
        && model_ref.chars().count() <= MAX_MODEL_REF_CHARS
        && slash.is_some_and(|index| index > 0 && index < model_ref.len() - 1)
        && !model_ref.chars().any(char::is_control);
    if valid {
        Ok(model_ref)
    } else {
        Err("The diagnostic model reference is invalid".to_string())
    }
}

fn parse_target(model: &Value) -> Option<RescueTarget> {
    let model_ref = model.get("key")?.as_str()?.trim();
    let slash = model_ref.find('/')?;
    if slash == 0 || slash >= model_ref.len() - 1 {
        return None;
    }
    let available = model
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let missing = model
        .get("missing")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tags = model
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    let is_default = tags.contains(&"default");
    let configured = is_default || tags.contains(&"configured");
    if !available || missing || !configured {
        return None;
    }
    Some(RescueTarget {
        provider_id: model_ref[..slash].to_string(),
        model_id: model_ref[slash + 1..].to_string(),
        model_ref: model_ref.to_string(),
        source: if is_default { "primary" } else { "configured" }.to_string(),
    })
}

fn targets_from_model_list(payload: &Value) -> Vec<RescueTarget> {
    let mut targets = payload
        .get("models")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(parse_target)
        .collect::<Vec<_>>();
    targets.sort_by_key(|target| target.source != "primary");
    let mut seen = HashSet::new();
    targets.retain(|target| seen.insert(target.model_ref.clone()));
    targets
}

fn rescue_prompt(request: &RescueChatRequest) -> Result<String, String> {
    if request.messages.is_empty() {
        return Err("The diagnostic conversation is empty".to_string());
    }
    let error = bounded_sanitized(&request.context.error, MAX_ERROR_CHARS);
    let logs = bounded_sanitized(
        request.context.logs.as_deref().unwrap_or_default(),
        MAX_LOG_CHARS,
    );
    let conversation = request
        .messages
        .iter()
        .rev()
        .take(MAX_MESSAGES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| {
            let role = match message.role.as_str() {
                "user" => "User",
                "assistant" => "Assistant",
                _ => "Message",
            };
            format!(
                "{role}: {}",
                bounded_sanitized(&message.content, MAX_MESSAGE_CHARS)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok([
        "You are the JunQi Desktop recovery assistant.",
        "The OpenClaw Gateway may be unavailable. Diagnose only from the supplied bounded, redacted context.",
        "Give concise and reversible recovery steps. Do not claim that an action succeeded unless the context proves it.",
        "Do not request or repeat API keys, tokens, passwords, or other credentials.",
        "",
        "Gateway or setup error:",
        if error.trim().is_empty() { "(none)" } else { error.as_str() },
        "",
        "Recent diagnostic logs:",
        if logs.trim().is_empty() { "(none)" } else { logs.as_str() },
        "",
        "Conversation:",
        conversation.as_str(),
    ]
    .join("\n"))
}

fn cli_failure(operation: &str, stdout: &str, stderr: &str) -> String {
    let detail = if stderr.trim().is_empty() {
        stdout
    } else {
        stderr
    };
    let detail = bounded_sanitized(detail, 1_500);
    if detail.trim().is_empty() {
        format!("OpenClaw {operation} failed without a usable diagnostic")
    } else {
        format!("OpenClaw {operation} failed: {detail}")
    }
}

fn response_text(payload: &Value) -> Option<String> {
    let text = payload
        .get("outputs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|output| output.get("text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
        .trim()
        .to_string();
    (!text.is_empty()).then_some(text)
}

fn selected_runtime_fence() -> (crate::paths::OpenClawRuntimeMode, std::path::PathBuf) {
    (
        crate::paths::active_runtime_mode(),
        crate::paths::active_config_path(),
    )
}

fn verify_runtime_fence(
    fence: &(crate::paths::OpenClawRuntimeMode, std::path::PathBuf),
) -> Result<(), String> {
    if crate::paths::active_runtime_mode() != fence.0
        || crate::paths::active_config_path() != fence.1
    {
        Err("The selected OpenClaw runtime changed during AI diagnostics".to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn list_gateway_rescue_targets() -> Result<Vec<RescueTarget>, String> {
    let fence = selected_runtime_fence();
    crate::paths::validate_runtime_mode(fence.0)?;
    let output = crate::commands::openclaw_cli::run_openclaw(
        &["models", "list", "--json"],
        Some(&fence.1),
        MODEL_LIST_TIMEOUT,
    )
    .await?;
    verify_runtime_fence(&fence)?;
    if !output.success {
        return Err(cli_failure(
            "model discovery",
            &output.stdout,
            &output.stderr,
        ));
    }
    let payload = crate::commands::openclaw_cli::parse_json_with_warnings(output.stdout.as_bytes())
        .map_err(|_| cli_failure("model discovery", &output.stdout, &output.stderr))?
        .value;
    Ok(targets_from_model_list(&payload))
}

#[tauri::command]
pub async fn gateway_rescue_chat(req: RescueChatRequest) -> Result<RescueChatResponse, String> {
    let model_ref = validate_model_ref(&req.model_ref)?;
    let prompt = rescue_prompt(&req)?;
    let fence = selected_runtime_fence();
    crate::paths::validate_runtime_mode(fence.0)?;
    let output = crate::commands::openclaw_cli::run_openclaw_redacted(
        &[
            "infer",
            "model",
            "run",
            "--local",
            "--json",
            "--thinking",
            "off",
            "--model",
            model_ref,
            "--prompt",
            &prompt,
        ],
        "local diagnostic model run",
        MODEL_RUN_TIMEOUT,
    )
    .await?;
    verify_runtime_fence(&fence)?;
    if !output.success {
        return Err(cli_failure(
            "local diagnostic model run",
            &output.stdout,
            &output.stderr,
        ));
    }
    let payload = crate::commands::openclaw_cli::parse_json_with_warnings(output.stdout.as_bytes())
        .map_err(|_| cli_failure("local diagnostic model run", &output.stdout, &output.stderr))?
        .value;
    let text = response_text(&payload)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| "OpenClaw local diagnostic model returned no text".to_string())?;
    Ok(RescueChatResponse { text })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn model_list_keeps_only_available_configured_models_and_primary_first() {
        let targets = targets_from_model_list(&json!({
            "models": [
                { "key": "other/catalog", "available": true, "missing": false, "tags": [] },
                { "key": "vllm/primary", "available": true, "missing": false, "tags": ["default", "configured"] },
                { "key": "vllm/fallback", "available": true, "missing": false, "tags": ["configured"] },
                { "key": "vllm/missing", "available": false, "missing": true, "tags": ["configured"] }
            ]
        }));
        assert_eq!(targets.len(), 2);
        assert_eq!(targets[0].model_ref, "vllm/primary");
        assert_eq!(targets[0].source, "primary");
        assert_eq!(targets[1].model_ref, "vllm/fallback");
    }

    #[test]
    fn rescue_prompt_is_bounded_and_redacts_credentials() {
        let prompt = rescue_prompt(&RescueChatRequest {
            model_ref: "vllm/model".to_string(),
            messages: vec![RescueMessage {
                role: "user".to_string(),
                content: "Check api_key=message-secret".to_string(),
            }],
            context: RescueContext {
                error: "Authorization: Bearer error-secret".to_string(),
                logs: Some(format!("{} api_key=log-secret", "x".repeat(8_000))),
            },
        })
        .unwrap();
        assert!(!prompt.contains("message-secret"));
        assert!(!prompt.contains("error-secret"));
        assert!(!prompt.contains("log-secret"));
        assert!(prompt.contains("[sensitive diagnostic redacted]"));
        assert!(prompt.chars().count() < 12_000);
    }

    #[test]
    fn response_text_collects_openclaw_model_outputs() {
        let text = response_text(&json!({
            "outputs": [{ "text": "first" }, { "text": "second" }]
        }));
        assert_eq!(text.as_deref(), Some("first\n\nsecond"));
    }

    #[test]
    fn invalid_model_reference_is_rejected() {
        assert!(validate_model_ref("missing-provider").is_err());
        assert!(validate_model_ref("/missing").is_err());
        assert!(validate_model_ref("provider/").is_err());
    }
}
