use crate::paths;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigData {
    pub raw: String,
    pub path: String,
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
        });
    }
    Ok(ConfigData {
        raw: "{}".into(),
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn write_config(json: String) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(&json).map_err(|e| format!("Invalid JSON: {}", e))?;
    let path = paths::config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    // Atomic write: write to a sibling temp file, then rename over the target.
    // This prevents config corruption if the process is killed mid-write.
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json).map_err(|e| format!("Failed to write temp config: {}", e))?;
    std::fs::rename(&tmp_path, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to finalize config write: {}", e)
    })?;
    Ok("Config saved".into())
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

/// Read a provider's API key directly from the config file (unredacted).
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
