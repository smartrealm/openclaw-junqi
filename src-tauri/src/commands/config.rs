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
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_file())
                .unwrap_or(false)
                && entry.file_name().to_string_lossy().starts_with("openclaw.")
        })
        .collect();
    files.sort_by_key(|entry| {
        let file_name = entry.file_name();
        let timestamp = file_name
            .to_string_lossy()
            .strip_suffix(".json")
            .and_then(|stem| stem.rsplit('.').next())
            .and_then(|value| value.parse::<u128>().ok())
            .unwrap_or(0);
        (timestamp, file_name)
    });
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

fn extract_token_from_config(raw: &str) -> Option<String> {
    let config = parse_openclaw_config(raw).ok()?;
    literal_gateway_token_from_config(&config)
}

fn extract_port_from_config(raw: &str) -> Option<u16> {
    let config = parse_openclaw_config(raw).ok()?;
    gateway_port_from_config(&config)
}

#[tauri::command]
pub async fn detect_gateway_config() -> Result<GatewayConfigInfo, String> {
    let mode = paths::active_runtime_mode();
    paths::validate_runtime_mode(mode)?;
    let path = paths::active_config_path();
    let mut token: Option<String> = None;
    let mut port = default_gateway_port();
    let mut found_path: Option<String> = None;

    if path.exists() {
        found_path = Some(path.to_string_lossy().to_string());
        if let Ok(raw) = std::fs::read_to_string(&path) {
            token = extract_token_from_config(&raw);
            if let Some(p) = extract_port_from_config(&raw) {
                port = p;
            }
        }
    }

    Ok(GatewayConfigInfo {
        token,
        port,
        ws_url: format!("ws://{}:{}", default_gateway_host(), port),
        http_url: format!("http://{}:{}", default_gateway_host(), port),
        config_path: found_path,
        runtime_mode: mode,
    })
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

        assert_eq!(extract_port_from_config(raw), Some(18790));
        assert_eq!(
            extract_token_from_config(raw),
            Some("gateway-token".to_string())
        );
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

    #[test]
    fn backup_pruning_keeps_the_newest_timestamps_across_processes() {
        let path = isolated_config_path("backup-pruning");
        let backup_dir = backup_dir_for(&path);
        fs::create_dir_all(&backup_dir).unwrap();

        for timestamp in 1..=12 {
            let process_id = if timestamp <= 2 { 9999 } else { 1 };
            fs::write(
                backup_dir.join(format!("openclaw.{process_id}.{timestamp}.json")),
                timestamp.to_string(),
            )
            .unwrap();
        }

        prune_config_backups(&backup_dir, 10);

        let retained: Vec<_> = fs::read_dir(&backup_dir)
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(retained.len(), 10);
        assert!(!retained.contains(&"openclaw.9999.1.json".to_string()));
        assert!(!retained.contains(&"openclaw.9999.2.json".to_string()));
        for timestamp in 3..=12 {
            assert!(retained.contains(&format!("openclaw.1.{timestamp}.json")));
        }

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
