use crate::paths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigData {
    pub raw: String,
    pub path: String,
    pub exists: bool,
}

#[tauri::command]
pub async fn read_config() -> Result<ConfigData, String> {
    let path = paths::config_path();
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
pub async fn write_config(json: String) -> Result<String, String> {
    let value = parse_openclaw_config_json(&json)?;
    let path = paths::config_path();
    write_openclaw_config_value(&path, &value)?;
    Ok("Config saved".into())
}

fn parse_openclaw_config_json(raw: &str) -> Result<serde_json::Value, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|e| format!("Invalid JSON: {}", e))?;
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
        if let Ok(existing_value) = serde_json::from_str::<serde_json::Value>(&existing_raw) {
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
}

fn extract_token_from_config(raw: &str) -> Option<String> {
    let config: serde_json::Value = serde_json::from_str(raw).ok()?;
    config
        .get("gateway")?
        .get("auth")?
        .get("token")?
        .as_str()
        .map(|s| s.to_string())
}

fn extract_port_from_config(raw: &str) -> Option<u16> {
    let config: serde_json::Value = serde_json::from_str(raw).ok()?;
    config
        .get("gateway")?
        .get("port")?
        .as_u64()
        .map(|v| v as u16)
}

#[tauri::command]
pub async fn detect_gateway_config() -> Result<GatewayConfigInfo, String> {
    let path = paths::config_path();
    let mut token: Option<String> = None;
    let mut port: u16 = 18789;
    let mut found_path: Option<String> = None;

    if path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            token = extract_token_from_config(&raw);
            if let Some(p) = extract_port_from_config(&raw) {
                port = p;
            }
            if token.is_some() {
                found_path = Some(path.to_string_lossy().to_string());
            }
        }
    }

    Ok(GatewayConfigInfo {
        token,
        port,
        ws_url: format!("ws://127.0.0.1:{}", port),
        http_url: format!("http://127.0.0.1:{}", port),
        config_path: found_path,
    })
}

/// 直接从配置文件读取供应商 API Key（未脱敏）。
#[tauri::command]
pub async fn read_provider_api_key(provider_key: String) -> Result<Option<String>, String> {
    let path = paths::config_path();
    if !path.exists() {
        return Ok(None);
    }

    let raw =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;

    let config: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse config: {}", e))?;

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
        let err = parse_openclaw_config_json("[]").unwrap_err();
        assert!(err.contains("root must be an object"));
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
            let err = parse_openclaw_config_json(raw).unwrap_err();
            assert!(
                err.contains(expected),
                "expected `{}` in `{}`",
                expected,
                err
            );
        }
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
