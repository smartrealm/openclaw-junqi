use crate::commands::{
    openclaw_cli::{output_error, parse_cli_json, run_openclaw, validate_cli_identifier},
    system,
};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

const CONFIG_VALIDATE_TIMEOUT: Duration = Duration::from_secs(30);
const READ_COMMAND_TIMEOUT: Duration = Duration::from_secs(45);
const PROBE_COMMAND_TIMEOUT: Duration = Duration::from_secs(75);

struct CandidateConfig {
    path: PathBuf,
}

impl CandidateConfig {
    fn create(value: &Value) -> Result<Self, String> {
        let directory = std::env::temp_dir().join("junqi-openclaw-provider");
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create provider validation directory: {error}"))?;
        let path = directory.join(format!("candidate-{}.json", uuid::Uuid::new_v4()));
        let raw = serde_json::to_string_pretty(value)
            .map_err(|error| format!("Failed to serialize candidate config: {error}"))?;
        std::fs::write(&path, raw)
            .map_err(|error| format!("Failed to write candidate config: {error}"))?;
        set_private_permissions(&path)?;
        Ok(Self { path })
    }
}

impl Drop for CandidateConfig {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let mut permissions = std::fs::metadata(path)
        .map_err(|error| format!("Failed to inspect candidate config: {error}"))?
        .permissions();
    permissions.set_mode(0o600);
    std::fs::set_permissions(path, permissions)
        .map_err(|error| format!("Failed to protect candidate config: {error}"))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn validation_error(payload: &Value) -> String {
    let issues = payload
        .get("issues")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|issue| {
            let path = issue
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or("<root>");
            let message = issue.get("message").and_then(Value::as_str)?;
            Some(format!("{path}: {message}"))
        })
        .collect::<Vec<_>>();
    if issues.is_empty() {
        "OpenClaw rejected the candidate config".to_string()
    } else {
        format!("Invalid OpenClaw config: {}", issues.join("; "))
    }
}

pub async fn validate_candidate_config(value: &Value) -> Result<(), String> {
    let candidate = CandidateConfig::create(value)?;
    let output = run_openclaw(
        &["config", "validate", "--json"],
        Some(&candidate.path),
        CONFIG_VALIDATE_TIMEOUT,
    )
    .await?;
    let payload = parse_cli_json(&output).map_err(|_| output_error("config validate", &output))?;
    let valid = payload.get("valid").and_then(Value::as_bool) == Some(true);
    if output.success && valid {
        Ok(())
    } else {
        Err(validation_error(&payload))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialCatalog {
    version: Option<String>,
    models: Vec<Value>,
}

#[tauri::command]
pub async fn get_openclaw_provider_catalog(
    provider: Option<String>,
) -> Result<OfficialCatalog, String> {
    // OpenClaw's --provider filter is runtime-dependent and can return an empty
    // set for providers that are present in the full official catalog. Read the
    // authoritative catalog once and apply the stable key-prefix filter here.
    let args = ["models", "list", "--all", "--json"];
    let normalized = provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let output = run_openclaw(&args, None, READ_COMMAND_TIMEOUT).await?;
    if !output.success {
        return Err(output_error("models list", &output));
    }
    let payload = parse_cli_json(&output)?;
    let mut models = payload
        .get("models")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(provider) = normalized {
        let prefix = format!("{provider}/");
        models.retain(|model| {
            model
                .get("key")
                .and_then(Value::as_str)
                .is_some_and(|key| key.to_lowercase().starts_with(&prefix))
        });
    }
    let version = if let Some(path) = system::resolve_openclaw_binary_async().await {
        system::validate_openclaw_binary(&path, &system::openclaw_search_path())
            .await
            .version
    } else {
        None
    };
    Ok(OfficialCatalog { version, models })
}

#[tauri::command]
pub async fn get_openclaw_config_schema() -> Result<Value, String> {
    let output = run_openclaw(&["config", "schema"], None, READ_COMMAND_TIMEOUT).await?;
    if !output.success {
        return Err(output_error("config schema", &output));
    }
    parse_cli_json(&output)
}

#[tauri::command]
pub async fn get_openclaw_auth_profiles(provider: Option<String>) -> Result<Value, String> {
    let mut args = vec!["models", "auth", "list", "--json"];
    let normalized = provider
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(provider) = normalized {
        validate_cli_identifier(provider, "provider ID")?;
        args.extend(["--provider", provider]);
    }
    let output = run_openclaw(&args, None, READ_COMMAND_TIMEOUT).await?;
    if !output.success {
        return Err(output_error("models auth list", &output));
    }
    parse_cli_json(&output)
}

#[tauri::command]
pub async fn probe_openclaw_provider(
    json: String,
    provider: String,
    profile_key: Option<String>,
) -> Result<Value, String> {
    let value: Value = serde_json::from_str(&json)
        .map_err(|error| format!("Invalid candidate config JSON: {error}"))?;
    validate_candidate_config(&value).await?;
    let candidate = CandidateConfig::create(&value)?;
    let provider = provider.trim();
    validate_cli_identifier(provider, "provider ID")?;
    let mut args = vec![
        "models",
        "status",
        "--probe",
        "--json",
        "--probe-provider",
        provider,
        "--probe-timeout",
        "15000",
        "--probe-concurrency",
        "1",
        "--probe-max-tokens",
        "1",
    ];
    let profile = profile_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(profile) = profile {
        validate_cli_identifier(profile, "profile ID")?;
        args.extend(["--probe-profile", profile]);
    }
    let output = run_openclaw(&args, Some(&candidate.path), PROBE_COMMAND_TIMEOUT).await?;
    let payload =
        parse_cli_json(&output).map_err(|_| output_error("models status --probe", &output))?;
    // A failed credential probe may intentionally use a non-zero exit status,
    // while its JSON still carries the structured auth/rate-limit reason needed
    // by the UI. Only execution or JSON parsing failures become command errors.
    Ok(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validation_errors_include_every_schema_path() {
        let payload = serde_json::json!({
            "valid": false,
            "issues": [
                {"path": "models.providers.demo.api", "message": "Invalid enum value"},
                {"path": "models.providers.demo.models.0.name", "message": "Required"}
            ]
        });
        let error = validation_error(&payload);
        assert!(error.contains("models.providers.demo.api"));
        assert!(error.contains("models.providers.demo.models.0.name"));
    }

    #[test]
    fn candidate_config_is_deleted_on_drop() {
        let path = {
            let candidate = CandidateConfig::create(&serde_json::json!({})).unwrap();
            assert!(candidate.path.exists());
            candidate.path.clone()
        };
        assert!(!path.exists());
    }
}
