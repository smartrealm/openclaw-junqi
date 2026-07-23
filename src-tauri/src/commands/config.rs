use crate::{paths, state::GatewayProcess};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::State;

#[derive(Deserialize)]
struct RuntimeDefaults {
    gateway: GatewayRuntimeDefaults,
}

#[derive(Deserialize)]
struct GatewayRuntimeDefaults {
    host: String,
    port: u16,
}

fn runtime_defaults() -> &'static RuntimeDefaults {
    static DEFAULTS: OnceLock<RuntimeDefaults> = OnceLock::new();
    DEFAULTS.get_or_init(|| {
        let defaults: RuntimeDefaults = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../src/config/runtime-defaults.json"
        )))
        .expect("runtime-defaults.json must contain valid JSON");
        assert!(
            defaults.gateway.port > 0,
            "runtime-defaults.json gateway.port must be a valid TCP port"
        );
        assert!(
            defaults
                .gateway
                .host
                .parse::<std::net::Ipv4Addr>()
                .is_ok_and(|host| host.is_loopback()),
            "runtime-defaults.json gateway.host must be an IPv4 loopback address"
        );
        defaults
    })
}

pub(crate) fn default_gateway_port() -> u16 {
    runtime_defaults().gateway.port
}

pub(crate) fn default_gateway_host() -> &'static str {
    runtime_defaults().gateway.host.as_str()
}

pub(crate) fn gateway_port_from_config(value: &serde_json::Value) -> Option<u16> {
    value
        .get("gateway")?
        .get("port")?
        .as_u64()
        .filter(|port| (1..=u16::MAX as u64).contains(port))
        .map(|port| port as u16)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigData {
    pub raw: String,
    pub path: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConfigValidation {
    pub valid: bool,
    pub path: String,
    pub exists: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn read_config() -> Result<ConfigData, String> {
    let mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(mode)?;
    let path = paths::active_config_path();
    if path.exists() {
        let raw =
            std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
        return Ok(ConfigData {
            raw,
            path: path.to_string_lossy().to_string(),
            exists: true,
        });
    }
    Ok(ConfigData {
        raw: "{}".into(),
        path: path.to_string_lossy().to_string(),
        exists: false,
    })
}

#[tauri::command]
pub async fn validate_openclaw_config() -> ConfigValidation {
    let mode = paths::active_runtime_mode();
    if let Err(error) = paths::validate_runtime_mode(mode) {
        return ConfigValidation {
            valid: false,
            path: String::new(),
            exists: false,
            error: Some(error),
        };
    }
    let path = paths::active_config_path();
    validate_openclaw_config_path(&path)
}

fn validate_openclaw_config_path(path: &Path) -> ConfigValidation {
    if !path.exists() {
        return ConfigValidation {
            valid: true,
            path: path.to_string_lossy().to_string(),
            exists: false,
            error: None,
        };
    }
    match std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read config: {error}"))
        .and_then(|raw| parse_openclaw_config(&raw).map(|_| ()))
    {
        Ok(()) => ConfigValidation {
            valid: true,
            path: path.to_string_lossy().to_string(),
            exists: true,
            error: None,
        },
        Err(error) => ConfigValidation {
            valid: false,
            path: path.to_string_lossy().to_string(),
            exists: true,
            error: Some(error),
        },
    }
}

#[tauri::command]
pub async fn write_config(
    state: State<'_, GatewayProcess>,
    json: String,
) -> Result<String, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.try_lock_owned().map_err(|_| {
        "Gateway or storage maintenance is running; try saving again shortly".to_string()
    })?;
    let mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(mode)?;
    let value = parse_openclaw_config(&json)?;
    crate::commands::openclaw_provider::validate_candidate_config(&value).await?;
    let path = paths::active_config_path();
    write_openclaw_config_value(&path, &value)?;
    Ok("Config saved".into())
}

/// Parse an OpenClaw configuration according to the JSON5 syntax accepted by
/// OpenClaw. Keeping this contract in one place prevents readers, validators,
/// and writers from disagreeing about otherwise valid user configuration.
pub(crate) fn parse_openclaw_config(raw: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        json5::from_str(raw).map_err(|error| format!("Invalid JSON5 config: {error}"))?;
    validate_openclaw_config_shape(&value)?;
    Ok(value)
}

fn validate_object_field(value: &serde_json::Value, key: &str) -> Result<(), String> {
    if let Some(field) = value.get(key) {
        if !field.is_object() {
            return Err(format!(
                "Invalid openclaw.json: `{}` must be an object",
                key
            ));
        }
    }
    Ok(())
}

fn validate_openclaw_config_shape(value: &serde_json::Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("Invalid openclaw.json: root must be an object".into());
    }
    for key in [
        "agents", "auth", "models", "gateway", "env", "channels", "tools",
    ] {
        validate_object_field(value, key)?;
    }
    if value
        .get("gateway")
        .and_then(|gateway| gateway.get("port"))
        .is_some()
        && gateway_port_from_config(value).is_none()
    {
        return Err(
            "Invalid openclaw.json: `gateway.port` must be an integer from 1 to 65535".into(),
        );
    }
    if let Some(env_vars) = value.get("env").and_then(|env| env.get("vars")) {
        if !env_vars.is_object() {
            return Err("Invalid openclaw.json: `env.vars` must be an object".into());
        }
    }
    if let Some(profiles) = value.get("auth").and_then(|auth| auth.get("profiles")) {
        if !profiles.is_object() {
            return Err("Invalid openclaw.json: `auth.profiles` must be an object".into());
        }
    }
    if let Some(providers) = value
        .get("models")
        .and_then(|models| models.get("providers"))
    {
        if !providers.is_object() {
            return Err("Invalid openclaw.json: `models.providers` must be an object".into());
        }
    }
    Ok(())
}

pub(crate) fn write_openclaw_config_value(
    path: &Path,
    value: &serde_json::Value,
) -> Result<(), String> {
    validate_openclaw_config_shape(value)?;
    if let Ok(existing_raw) = std::fs::read_to_string(path) {
        if let Ok(existing_value) = parse_openclaw_config(&existing_raw) {
            if existing_value == *value {
                return Ok(());
            }
        }
    }
    backup_existing_config(path)?;
    let raw = serde_json::to_string_pretty(value)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    atomic_write_text(path, &raw)
}

fn backup_existing_config(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let backup_dir = path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("config-backups");
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Failed to create config backup dir: {}", e))?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let backup_path = backup_dir.join(format!("openclaw.{}.{}.json", std::process::id(), suffix));
    std::fs::copy(path, &backup_path)
        .map_err(|e| format!("Failed to backup current config before write: {}", e))?;
    prune_config_backups(&backup_dir, 10);
    Ok(Some(backup_path))
}

fn prune_config_backups(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<_> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("openclaw."))
        .collect();
    files.sort_by_key(|entry| entry.file_name());
    let remove_count = files.len().saturating_sub(keep);
    for entry in files.into_iter().take(remove_count) {
        let _ = std::fs::remove_file(entry.path());
    }
}

/// 原子写文本文件：先写同目录临时文件，再 rename 覆盖目标。
///
/// 任何会改写 `openclaw.json` 的路径都应复用这里，避免进程退出、
/// 断电或并发保存时把主配置截断成半个 JSON。
pub(crate) fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    paths::atomic_write_text(path, content)
}

#[derive(Debug, Clone, Serialize)]
pub struct GatewayConfigInfo {
    pub token: Option<String>,
    pub port: u16,
    pub ws_url: String,
    pub http_url: String,
    pub config_path: Option<String>,
    pub runtime_mode: paths::OpenClawRuntimeMode,
    pub connection_mode: GatewayConnectionMode,
}

/// The setup route asks this backend-owned contract whether the selected
/// OpenClaw configuration still needs the official `openclaw onboard` flow.
/// It deliberately does not attempt to create or repair configuration itself.
#[derive(Debug, Clone, Serialize)]
pub struct OpenclawOnboardingReadiness {
    pub required: bool,
    pub reason: Option<String>,
    pub runtime_mode: paths::OpenClawRuntimeMode,
    pub connection_mode: GatewayConnectionMode,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GatewayConnectionMode {
    Local,
    Remote,
}

pub(crate) fn gateway_token_string_is_reference(value: &str) -> bool {
    let value = value.trim();
    (value.starts_with("${") && value.ends_with('}'))
        || (value.starts_with('$') && value.len() > 1 && !value.contains(char::is_whitespace))
        || value.starts_with("secretref-env:")
        || value.starts_with("__env__:")
}

pub(crate) fn literal_gateway_token_from_config(config: &serde_json::Value) -> Option<String> {
    config
        .get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .map(str::trim)
        .filter(|token| !token.is_empty() && !gateway_token_string_is_reference(token))
        .map(str::to_string)
}

pub(crate) fn literal_remote_gateway_token_from_config(
    config: &serde_json::Value,
) -> Option<String> {
    config
        .get("gateway")?
        .get("remote")?
        .get("token")?
        .as_str()
        .map(str::trim)
        .filter(|token| !token.is_empty() && !gateway_token_string_is_reference(token))
        .map(str::to_string)
        .or_else(|| literal_gateway_token_from_config(config))
}

pub(crate) fn gateway_connection_mode_from_config(
    config: &serde_json::Value,
) -> GatewayConnectionMode {
    explicit_gateway_connection_mode(config).unwrap_or(GatewayConnectionMode::Local)
}

fn explicit_gateway_connection_mode(config: &serde_json::Value) -> Option<GatewayConnectionMode> {
    match config
        .get("gateway")
        .and_then(|gateway| gateway.get("mode"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
    {
        Some("local") => Some(GatewayConnectionMode::Local),
        Some("remote") => Some(GatewayConnectionMode::Remote),
        _ => None,
    }
}

/// Best-effort intent detection for the fixed official onboarding command.
/// Invalid configuration is still handed back to OpenClaw for repair; this
/// helper only preserves an explicit remote choice when the JSON5 shape is
/// otherwise readable.
pub(crate) fn gateway_connection_mode_from_path(path: &Path) -> GatewayConnectionMode {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| parse_openclaw_config(&raw).ok())
        .map(|config| gateway_connection_mode_from_config(&config))
        .unwrap_or(GatewayConnectionMode::Local)
}

fn has_default_model(config: &serde_json::Value) -> bool {
    let Some(model) = config
        .get("agents")
        .and_then(|agents| agents.get("defaults"))
        .and_then(|defaults| defaults.get("model"))
    else {
        return false;
    };

    match model {
        serde_json::Value::String(value) => !value.trim().is_empty(),
        serde_json::Value::Object(value) => value
            .get("primary")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|primary| !primary.trim().is_empty()),
        _ => false,
    }
}

pub(crate) fn onboarding_readiness_from_config(
    runtime_mode: paths::OpenClawRuntimeMode,
    config: Option<&serde_json::Value>,
) -> OpenclawOnboardingReadiness {
    let Some(config) = config else {
        return OpenclawOnboardingReadiness {
            required: true,
            reason: Some("OpenClaw configuration is missing".to_string()),
            runtime_mode,
            connection_mode: GatewayConnectionMode::Local,
        };
    };

    let Some(connection_mode) = explicit_gateway_connection_mode(config) else {
        return OpenclawOnboardingReadiness {
            required: true,
            reason: Some("gateway.mode must be explicitly set to local or remote".to_string()),
            runtime_mode,
            connection_mode: GatewayConnectionMode::Local,
        };
    };

    match connection_mode {
        GatewayConnectionMode::Remote => match remote_gateway_urls(config) {
            Ok(_) => OpenclawOnboardingReadiness {
                required: false,
                reason: None,
                runtime_mode,
                connection_mode,
            },
            Err(error) => OpenclawOnboardingReadiness {
                required: true,
                reason: Some(error),
                runtime_mode,
                connection_mode,
            },
        },
        GatewayConnectionMode::Local if has_default_model(config) => OpenclawOnboardingReadiness {
            required: false,
            reason: None,
            runtime_mode,
            connection_mode,
        },
        GatewayConnectionMode::Local => OpenclawOnboardingReadiness {
            required: true,
            reason: Some("agents.defaults.model is required for a local Gateway".to_string()),
            runtime_mode,
            connection_mode,
        },
    }
}

pub(crate) fn remote_gateway_urls(
    config: &serde_json::Value,
) -> Result<(String, String, u16), String> {
    let raw = config
        .get("gateway")
        .and_then(|gateway| gateway.get("remote"))
        .and_then(|remote| remote.get("url"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|url| !url.is_empty())
        .ok_or("gateway.remote.url is required when gateway.mode is remote")?;
    let mut url =
        url::Url::parse(raw).map_err(|error| format!("gateway.remote.url is invalid: {error}"))?;
    if !matches!(url.scheme(), "ws" | "wss") || url.host_str().is_none() {
        return Err("gateway.remote.url must be an absolute ws:// or wss:// URL".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("gateway.remote.url must not contain credentials".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or("gateway.remote.url must include a valid port")?;
    let ws_url = url.to_string();
    let http_scheme = if url.scheme() == "wss" {
        "https"
    } else {
        "http"
    };
    url.set_scheme(http_scheme)
        .map_err(|_| "gateway.remote.url uses an unsupported scheme".to_string())?;
    Ok((ws_url, url.to_string(), port))
}

#[tauri::command]
pub async fn detect_gateway_config() -> Result<GatewayConfigInfo, String> {
    let mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(mode)?;
    let path = paths::active_config_path();
    let mut token: Option<String> = None;
    let mut port = default_gateway_port();
    let mut found_path: Option<String> = None;
    let mut connection_mode = GatewayConnectionMode::Local;
    let mut ws_url = format!("ws://{}:{}", default_gateway_host(), port);
    let mut http_url = format!("http://{}:{}", default_gateway_host(), port);

    if path.exists() {
        found_path = Some(path.to_string_lossy().to_string());
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(config) = parse_openclaw_config(&raw) {
                connection_mode = gateway_connection_mode_from_config(&config);
                if connection_mode == GatewayConnectionMode::Remote {
                    let (configured_ws_url, configured_http_url, configured_port) =
                        remote_gateway_urls(&config)?;
                    token = literal_remote_gateway_token_from_config(&config);
                    port = configured_port;
                    ws_url = configured_ws_url;
                    http_url = configured_http_url;
                } else {
                    token = literal_gateway_token_from_config(&config);
                    if let Some(configured_port) = gateway_port_from_config(&config) {
                        port = configured_port;
                    }
                    ws_url = format!("ws://{}:{}", default_gateway_host(), port);
                    http_url = format!("http://{}:{}", default_gateway_host(), port);
                }
            }
        }
    }

    Ok(GatewayConfigInfo {
        token,
        port,
        ws_url,
        http_url,
        config_path: found_path,
        runtime_mode: mode,
        connection_mode,
    })
}

/// Return the selected runtime's structural onboarding status. The frontend
/// uses this as the single source of truth before it starts a Gateway or opens
/// the official interactive CLI, so JSON5 parsing and remote URL validation
/// cannot drift between Rust and the renderer.
#[tauri::command]
pub async fn get_openclaw_onboarding_readiness() -> Result<OpenclawOnboardingReadiness, String> {
    let runtime_mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(runtime_mode)?;
    let path = paths::active_config_path();
    if !path.exists() {
        return Ok(onboarding_readiness_from_config(runtime_mode, None));
    }

    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            return Ok(OpenclawOnboardingReadiness {
                required: true,
                reason: Some(format!("OpenClaw configuration cannot be read: {error}")),
                runtime_mode,
                connection_mode: GatewayConnectionMode::Local,
            });
        }
    };
    let config = match parse_openclaw_config(&raw) {
        Ok(config) => config,
        Err(error) => {
            return Ok(OpenclawOnboardingReadiness {
                required: true,
                reason: Some(format!("OpenClaw configuration is invalid: {error}")),
                runtime_mode,
                connection_mode: GatewayConnectionMode::Local,
            });
        }
    };
    Ok(onboarding_readiness_from_config(
        runtime_mode,
        Some(&config),
    ))
}

/// Commit the user's explicit Native/Docker selection before any Gateway work
/// begins. The operation gate prevents storage migration and runtime selection
/// from racing over the same bootstrap file.
#[tauri::command]
pub async fn set_active_gateway_runtime(
    state: State<'_, GatewayProcess>,
    mode: paths::OpenClawRuntimeMode,
) -> Result<(), String> {
    paths::validate_runtime_mode(mode)?;
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.try_lock_owned().map_err(|_| {
        "Gateway or storage maintenance is running; choose the runtime after it completes"
            .to_string()
    })?;
    paths::begin_active_runtime_mode_switch(mode)
}

#[tauri::command]
pub async fn commit_active_gateway_runtime(
    state: State<'_, GatewayProcess>,
    mode: paths::OpenClawRuntimeMode,
) -> Result<(), String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.try_lock_owned().map_err(|_| {
        "Gateway or storage maintenance is running; commit the runtime after it completes"
            .to_string()
    })?;
    paths::commit_active_runtime_mode_switch(mode)
}

#[tauri::command]
pub async fn rollback_active_gateway_runtime(
    state: State<'_, GatewayProcess>,
    mode: paths::OpenClawRuntimeMode,
) -> Result<(), String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.try_lock_owned().map_err(|_| {
        "Gateway or storage maintenance is running; roll back the runtime after it completes"
            .to_string()
    })?;
    paths::rollback_active_runtime_mode_switch(mode)
}

/// 直接从配置文件读取供应商 API Key（未脱敏）。
#[tauri::command]
pub async fn read_provider_api_key(provider_key: String) -> Result<Option<String>, String> {
    let mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(mode)?;
    let path = paths::active_config_path();
    if !path.exists() {
        return Ok(None);
    }

    let raw =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;

    let config =
        parse_openclaw_config(&raw).map_err(|error| format!("Failed to parse config: {error}"))?;

    let api_key = config
        .get("models")
        .and_then(|m| m.get("providers"))
        .and_then(|p| p.get(&provider_key))
        .and_then(|prov| prov.get("apiKey"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(api_key)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn isolated_config_path(name: &str) -> PathBuf {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir()
            .join(format!(
                "junqi-config-test-{}-{}-{}",
                name,
                std::process::id(),
                suffix
            ))
            .join("openclaw.json")
    }

    fn backup_dir_for(path: &Path) -> PathBuf {
        path.parent().unwrap().join("config-backups")
    }

    #[test]
    fn rejects_non_object_config_root() {
        let err = parse_openclaw_config("[]").unwrap_err();
        assert!(err.contains("root must be an object"));
    }

    #[test]
    fn parses_openclaw_json5_configuration() {
        let value = parse_openclaw_config(
            r#"
            // OpenClaw permits JSON5 configuration files.
            {
              gateway: {
                port: 18789,
                auth: { token: 'test-token', },
              },
              models: {
                providers: {
                  demo: { apiKey: 'test-key', },
                },
              },
            }
            "#,
        )
        .unwrap();

        assert_eq!(gateway_port_from_config(&value), Some(18789));
        assert_eq!(
            value
                .get("gateway")
                .and_then(|gateway| gateway.get("auth"))
                .and_then(|auth| auth.get("token"))
                .and_then(|token| token.as_str()),
            Some("test-token")
        );
    }

    #[test]
    fn config_read_helpers_accept_json5_syntax() {
        let raw = r#"
        {
          // Both values are read through the shared JSON5 contract.
          gateway: {
            port: 18790,
            auth: { token: 'gateway-token', },
          },
        }
        "#;

        let config = parse_openclaw_config(raw).unwrap();
        assert_eq!(gateway_port_from_config(&config), Some(18790));
        assert_eq!(
            literal_gateway_token_from_config(&config),
            Some("gateway-token".to_string())
        );
    }

    #[test]
    fn remote_gateway_connection_uses_its_official_endpoint_and_credential() {
        let config = json!({
            "gateway": {
                "mode": "remote",
                "remote": {
                    "url": "wss://gateway.example.test:24443/control",
                    "token": "remote-token"
                }
            }
        });

        assert_eq!(
            gateway_connection_mode_from_config(&config),
            GatewayConnectionMode::Remote,
        );
        assert_eq!(
            remote_gateway_urls(&config).unwrap(),
            (
                "wss://gateway.example.test:24443/control".to_string(),
                "https://gateway.example.test:24443/control".to_string(),
                24443,
            ),
        );
        assert_eq!(
            literal_remote_gateway_token_from_config(&config),
            Some("remote-token".to_string()),
        );
    }

    #[test]
    fn onboarding_readiness_uses_the_same_remote_url_validation_as_gateway_detection() {
        let missing = onboarding_readiness_from_config(paths::OpenClawRuntimeMode::Native, None);
        assert!(missing.required);
        assert_eq!(missing.connection_mode, GatewayConnectionMode::Local);

        let local_without_model = json!({"gateway": {"mode": "local"}});
        let local_without_model = onboarding_readiness_from_config(
            paths::OpenClawRuntimeMode::Native,
            Some(&local_without_model),
        );
        assert!(local_without_model.required);

        let local_ready = json!({
            "gateway": {"mode": "local"},
            "agents": {"defaults": {"model": {"primary": "openai/gpt-5"}}}
        });
        let local_ready = onboarding_readiness_from_config(
            paths::OpenClawRuntimeMode::Native,
            Some(&local_ready),
        );
        assert!(!local_ready.required);
        assert_eq!(local_ready.connection_mode, GatewayConnectionMode::Local);

        let remote_ready = json!({
            "gateway": {
                "mode": "remote",
                "remote": {"url": "wss://gateway.example.test:24443"}
            }
        });
        let remote_ready = onboarding_readiness_from_config(
            paths::OpenClawRuntimeMode::Native,
            Some(&remote_ready),
        );
        assert!(!remote_ready.required);
        assert_eq!(remote_ready.connection_mode, GatewayConnectionMode::Remote);

        let remote_invalid = json!({
            "gateway": {
                "mode": "remote",
                "remote": {"url": "https://gateway.example.test"}
            }
        });
        let remote_invalid = onboarding_readiness_from_config(
            paths::OpenClawRuntimeMode::Native,
            Some(&remote_invalid),
        );
        assert!(remote_invalid.required);
        assert_eq!(
            remote_invalid.connection_mode,
            GatewayConnectionMode::Remote
        );
        assert!(remote_invalid.reason.unwrap().contains("ws:// or wss://"));
    }

    #[test]
    fn rejects_wrong_nested_config_shapes() {
        for (raw, expected) in [
            (r#"{"models":[]}"#, "`models` must be an object"),
            (
                r#"{"models":{"providers":[]}}"#,
                "`models.providers` must be an object",
            ),
            (
                r#"{"auth":{"profiles":[]}}"#,
                "`auth.profiles` must be an object",
            ),
            (r#"{"env":{"vars":[]}}"#, "`env.vars` must be an object"),
        ] {
            let err = parse_openclaw_config(raw).unwrap_err();
            assert!(
                err.contains(expected),
                "expected `{}` in `{}`",
                expected,
                err
            );
        }
    }

    #[test]
    fn gateway_port_requires_a_valid_tcp_port() {
        for invalid in [
            json!(0),
            json!(65536),
            json!(70000),
            json!("18789"),
            json!(1.5),
        ] {
            let value = json!({"gateway": {"port": invalid}});
            assert_eq!(gateway_port_from_config(&value), None);
            assert!(validate_openclaw_config_shape(&value)
                .unwrap_err()
                .contains("gateway.port"));
        }

        let value = json!({"gateway": {"port": 65535}});
        assert_eq!(gateway_port_from_config(&value), Some(65535));
        validate_openclaw_config_shape(&value).unwrap();
    }

    #[test]
    fn validation_reports_malformed_and_wrong_shape_configs() {
        let path = isolated_config_path("validation");
        fs::create_dir_all(path.parent().unwrap()).unwrap();

        fs::write(&path, "{not-json").unwrap();
        let malformed = validate_openclaw_config_path(&path);
        assert!(!malformed.valid);
        assert!(malformed.exists);
        assert!(malformed.error.unwrap().contains("Invalid JSON"));

        fs::write(&path, r#"{"gateway":{"port":"18789"}}"#).unwrap();
        let wrong_shape = validate_openclaw_config_path(&path);
        assert!(!wrong_shape.valid);
        assert!(wrong_shape.error.unwrap().contains("gateway.port"));

        fs::write(&path, r#"{"gateway":{"port":18789}}"#).unwrap();
        assert!(validate_openclaw_config_path(&path).valid);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn validation_accepts_json5_configuration_syntax() {
        let path = isolated_config_path("validation-json5");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"
            {
              // OpenClaw's JSON5 config supports comments and unquoted keys.
              gateway: { port: 18789, },
            }
            "#,
        )
        .unwrap();

        let validation = validate_openclaw_config_path(&path);
        assert!(validation.valid, "{validation:?}");
        assert!(validation.exists);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn shared_runtime_defaults_provide_a_valid_gateway_port() {
        assert!(default_gateway_port() > 0);
        assert!(!default_gateway_host().trim().is_empty());
    }

    #[test]
    fn unchanged_config_does_not_create_backup() {
        let path = isolated_config_path("unchanged");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"models":{"providers":{}}}"#).unwrap();

        write_openclaw_config_value(&path, &json!({"models":{"providers":{}}})).unwrap();

        assert!(!backup_dir_for(&path).exists());
        let raw = fs::read_to_string(&path).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&raw).unwrap(),
            json!({"models":{"providers":{}}})
        );

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn unchanged_json5_config_does_not_create_backup_or_rewrite_source() {
        let path = isolated_config_path("unchanged-json5");
        let original = r#"
        {
          // Preserve user formatting when the value has not changed.
          models: { providers: {}, },
        }
        "#;
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, original).unwrap();

        write_openclaw_config_value(&path, &json!({"models":{"providers":{}}})).unwrap();

        assert!(!backup_dir_for(&path).exists());
        assert_eq!(fs::read_to_string(&path).unwrap(), original);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn changed_config_creates_backup_before_write() {
        let path = isolated_config_path("changed");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"gateway":{"port":18789}}"#).unwrap();

        write_openclaw_config_value(&path, &json!({"gateway":{"port":18790}})).unwrap();

        let backups: Vec<_> = fs::read_dir(backup_dir_for(&path))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(backups[0].path()).unwrap(),
            r#"{"gateway":{"port":18789}}"#
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path).unwrap()).unwrap(),
            json!({"gateway":{"port":18790}})
        );

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn invalid_existing_config_is_backed_up_before_overwrite() {
        let path = isolated_config_path("invalid-existing");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{not-json").unwrap();

        write_openclaw_config_value(&path, &json!({"auth":{"profiles":{}}})).unwrap();

        let backups: Vec<_> = fs::read_dir(backup_dir_for(&path))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(fs::read_to_string(backups[0].path()).unwrap(), "{not-json");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&fs::read_to_string(&path).unwrap()).unwrap(),
            json!({"auth":{"profiles":{}}})
        );

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
