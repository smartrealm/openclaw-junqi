//! Gateway device-token storage.
//!
//! This path intentionally differs from provider secrets: Gateway credentials
//! may only be persisted in an OS-backed credential store. When no secure
//! backend is available, the frontend is told to keep the token in memory for
//! the current session; this module never writes a plaintext fallback file.

use crate::commands::secret_store::{
    delete_system_credential, get_system_credential, store_system_credential,
    system_credential_store_available,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const GATEWAY_CREDENTIAL_SERVICE: &str = "junqi-desktop-gateway-device-tokens";
const GATEWAY_CREDENTIAL_LABEL: &str = "JunQi Gateway device token";
const MAX_RUNTIME_KEY_BYTES: usize = 2_048;
const MAX_DEVICE_ID_BYTES: usize = 512;
const MAX_TOKEN_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GatewayCredentialPersistence {
    System,
    SessionOnly,
    Unsupported,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCredentialResult {
    pub runtime_key: String,
    pub persistence: GatewayCredentialPersistence,
    /// Returned only when the caller needs the value for the current session.
    pub token: Option<String>,
    pub migrated: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCredentialKeyParams {
    runtime_key: String,
    device_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreGatewayCredentialParams {
    runtime_key: String,
    device_id: String,
    token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrateGatewayCredentialParams {
    runtime_key: String,
    device_id: String,
    legacy_token: String,
}

fn validate_component(value: &str, name: &str, max_bytes: usize) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("{name} must not be empty"));
    }
    if normalized.len() > max_bytes {
        return Err(format!("{name} is too large"));
    }
    if normalized.chars().any(char::is_control) {
        return Err(format!("{name} contains control characters"));
    }
    Ok(normalized.to_string())
}

fn validate_key(runtime_key: &str, device_id: &str) -> Result<(String, String), String> {
    Ok((
        validate_component(runtime_key, "runtimeKey", MAX_RUNTIME_KEY_BYTES)?,
        validate_component(device_id, "deviceId", MAX_DEVICE_ID_BYTES)?,
    ))
}

fn validate_token(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("token must not be empty".to_string());
    }
    if token.len() > MAX_TOKEN_BYTES {
        return Err("token is too large".to_string());
    }
    if token.chars().any(char::is_control) {
        return Err("token contains control characters".to_string());
    }
    Ok(token.to_string())
}

fn credential_account(runtime_key: &str, device_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"junqi-gateway-device-token-v1\0");
    hasher.update(runtime_key.as_bytes());
    hasher.update(b"\0");
    hasher.update(device_id.as_bytes());
    format!("gateway-v1:{:x}", hasher.finalize())
}

fn result(
    runtime_key: String,
    persistence: GatewayCredentialPersistence,
    token: Option<String>,
    migrated: bool,
) -> GatewayCredentialResult {
    GatewayCredentialResult {
        runtime_key,
        persistence,
        token,
        migrated,
    }
}

#[tauri::command]
pub async fn get_gateway_credential(
    params: GatewayCredentialKeyParams,
) -> Result<GatewayCredentialResult, String> {
    let (runtime_key, device_id) = validate_key(&params.runtime_key, &params.device_id)?;
    if !system_credential_store_available() {
        return Ok(result(
            runtime_key,
            GatewayCredentialPersistence::Unsupported,
            None,
            false,
        ));
    }

    let account = credential_account(&runtime_key, &device_id);
    let token = get_system_credential(GATEWAY_CREDENTIAL_SERVICE, &account).await?;
    Ok(result(
        runtime_key,
        GatewayCredentialPersistence::System,
        token,
        false,
    ))
}

#[tauri::command]
pub async fn store_gateway_credential(
    params: StoreGatewayCredentialParams,
) -> Result<GatewayCredentialResult, String> {
    let (runtime_key, device_id) = validate_key(&params.runtime_key, &params.device_id)?;
    let token = validate_token(&params.token)?;
    if !system_credential_store_available() {
        return Ok(result(
            runtime_key,
            GatewayCredentialPersistence::SessionOnly,
            None,
            false,
        ));
    }

    let account = credential_account(&runtime_key, &device_id);
    store_system_credential(
        GATEWAY_CREDENTIAL_SERVICE,
        &account,
        GATEWAY_CREDENTIAL_LABEL,
        &token,
    )
    .await?;
    Ok(result(
        runtime_key,
        GatewayCredentialPersistence::System,
        None,
        false,
    ))
}

#[tauri::command]
pub async fn delete_gateway_credential(
    params: GatewayCredentialKeyParams,
) -> Result<GatewayCredentialResult, String> {
    let (runtime_key, device_id) = validate_key(&params.runtime_key, &params.device_id)?;
    if !system_credential_store_available() {
        return Ok(result(
            runtime_key,
            GatewayCredentialPersistence::Unsupported,
            None,
            false,
        ));
    }

    let account = credential_account(&runtime_key, &device_id);
    delete_system_credential(GATEWAY_CREDENTIAL_SERVICE, &account).await?;
    Ok(result(
        runtime_key,
        GatewayCredentialPersistence::System,
        None,
        false,
    ))
}

/// Idempotently adopts a browser-stored legacy token. Existing secure state
/// wins, so a stale browser value can never overwrite a newer device token.
#[tauri::command]
pub async fn migrate_gateway_credential(
    params: MigrateGatewayCredentialParams,
) -> Result<GatewayCredentialResult, String> {
    let (runtime_key, device_id) = validate_key(&params.runtime_key, &params.device_id)?;
    let legacy_token = validate_token(&params.legacy_token)?;
    if !system_credential_store_available() {
        return Ok(result(
            runtime_key,
            GatewayCredentialPersistence::SessionOnly,
            Some(legacy_token),
            true,
        ));
    }

    let account = credential_account(&runtime_key, &device_id);
    if let Some(existing) = get_system_credential(GATEWAY_CREDENTIAL_SERVICE, &account).await? {
        return Ok(result(
            runtime_key,
            GatewayCredentialPersistence::System,
            Some(existing),
            false,
        ));
    }

    store_system_credential(
        GATEWAY_CREDENTIAL_SERVICE,
        &account,
        GATEWAY_CREDENTIAL_LABEL,
        &legacy_token,
    )
    .await?;
    Ok(result(
        runtime_key,
        GatewayCredentialPersistence::System,
        Some(legacy_token),
        true,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_account_is_runtime_and_device_scoped() {
        let first = credential_account("runtime-a", "device-a");
        assert_eq!(first, credential_account("runtime-a", "device-a"));
        assert_ne!(first, credential_account("runtime-b", "device-a"));
        assert_ne!(first, credential_account("runtime-a", "device-b"));
        assert!(first.starts_with("gateway-v1:"));
        assert!(!first.contains("runtime-a"));
        assert!(!first.contains("device-a"));
    }

    #[test]
    fn validation_rejects_empty_and_control_characters() {
        assert!(validate_key("", "device").is_err());
        assert!(validate_key("runtime", "\n").is_err());
        assert!(validate_token(" ").is_err());
        assert!(validate_token("token\nvalue").is_err());
    }

    #[test]
    fn session_only_result_never_echoes_a_stored_token() {
        let response = result(
            "runtime".to_string(),
            GatewayCredentialPersistence::SessionOnly,
            None,
            false,
        );
        assert_eq!(
            response.persistence,
            GatewayCredentialPersistence::SessionOnly
        );
        assert!(response.token.is_none());
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "mutates the current user's macOS login Keychain"]
    async fn macos_keychain_round_trip() {
        let runtime_key = format!("test-runtime-{}", uuid::Uuid::new_v4());
        let device_id = "test-device".to_string();
        let token = "test-token".to_string();
        let stored = store_gateway_credential(StoreGatewayCredentialParams {
            runtime_key: runtime_key.clone(),
            device_id: device_id.clone(),
            token: token.clone(),
        })
        .await
        .expect("store credential");
        assert_eq!(stored.persistence, GatewayCredentialPersistence::System);

        let loaded = get_gateway_credential(GatewayCredentialKeyParams {
            runtime_key: runtime_key.clone(),
            device_id: device_id.clone(),
        })
        .await;

        let deleted = delete_gateway_credential(GatewayCredentialKeyParams {
            runtime_key,
            device_id,
        })
        .await;
        assert_eq!(
            loaded.expect("get credential").token.as_deref(),
            Some(token.as_str())
        );
        deleted.expect("delete credential");
    }
}
