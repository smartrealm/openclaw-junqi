//! 由应用私有状态持久化支持的 Gateway 设备签名。
//!
//! 渲染进程永远不会取得私钥。设备身份文件只由 Rust 命令读取，Unix 平台使用
//! 私有文件权限。新建身份代表一个新的 OpenClaw 设备，仍可能需要按官方流程完成配对。

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::{
    rand::SystemRandom,
    signature::{Ed25519KeyPair, KeyPair},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{future::Future, sync::OnceLock};

use crate::paths;

const DEVICE_IDENTITY_FILE: &str = "gateway-device-identity.json";
const MAX_TEXT_BYTES: usize = 512;
const MAX_TOKEN_BYTES: usize = 64 * 1024;
const MAX_SCOPES: usize = 16;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDeviceIdentityReference {
    pub device_id: String,
    pub public_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDeviceChallengeParams {
    nonce: String,
    signed_at: u64,
    client_id: String,
    client_mode: String,
    role: String,
    scopes: Vec<String>,
    token: String,
    platform: String,
    device_family: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayDeviceChallengeSignature {
    pub device_id: String,
    pub public_key: String,
    pub signature: String,
    pub signed_at: u64,
    pub nonce: String,
}

struct DeviceIdentityCache {
    key_pair: tokio::sync::OnceCell<Ed25519KeyPair>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDeviceIdentity {
    version: u8,
    private_key: String,
}

impl DeviceIdentityCache {
    async fn load_or_try_initialize<F, Fut>(&self, initialize: F) -> Result<&Ed25519KeyPair, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Ed25519KeyPair, String>>,
    {
        self.key_pair.get_or_try_init(initialize).await
    }
}

fn device_identity_cache() -> &'static DeviceIdentityCache {
    static CACHE: OnceLock<DeviceIdentityCache> = OnceLock::new();
    CACHE.get_or_init(|| DeviceIdentityCache {
        key_pair: tokio::sync::OnceCell::new(),
    })
}

fn validate_text(value: &str, field: &str, max_bytes: usize) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty()
        || normalized.len() > max_bytes
        || normalized.chars().any(char::is_control)
    {
        return Err(format!("{field} is invalid"));
    }
    Ok(normalized.to_string())
}

fn validate_optional_text(value: &str, field: &str, max_bytes: usize) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.len() > max_bytes || normalized.chars().any(char::is_control) {
        return Err(format!("{field} is invalid"));
    }
    Ok(normalized.to_string())
}

fn normalize_device_metadata(value: &str) -> String {
    value
        .trim()
        .chars()
        .map(|character| {
            if character.is_ascii_uppercase() {
                character.to_ascii_lowercase()
            } else {
                character
            }
        })
        .collect()
}

fn validate_params(
    params: GatewayDeviceChallengeParams,
) -> Result<GatewayDeviceChallengeParams, String> {
    if params.scopes.is_empty() || params.scopes.len() > MAX_SCOPES {
        return Err("scopes are invalid".to_string());
    }
    let scopes = params
        .scopes
        .iter()
        .map(|scope| validate_text(scope, "scope", MAX_TEXT_BYTES))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(GatewayDeviceChallengeParams {
        nonce: validate_text(&params.nonce, "nonce", MAX_TEXT_BYTES)?,
        signed_at: (params.signed_at <= MAX_SAFE_INTEGER)
            .then_some(params.signed_at)
            .ok_or_else(|| "signedAt is invalid".to_string())?,
        client_id: validate_text(&params.client_id, "clientId", MAX_TEXT_BYTES)?,
        client_mode: validate_text(&params.client_mode, "clientMode", MAX_TEXT_BYTES)?,
        role: validate_text(&params.role, "role", MAX_TEXT_BYTES)?,
        scopes,
        token: validate_optional_text(&params.token, "token", MAX_TOKEN_BYTES)?,
        platform: validate_text(&params.platform, "platform", MAX_TEXT_BYTES)?,
        device_family: params
            .device_family
            .as_deref()
            .map(|value| validate_optional_text(value, "deviceFamily", MAX_TEXT_BYTES))
            .transpose()?,
    })
}

fn device_id(public_key: &[u8]) -> String {
    format!("{:x}", Sha256::digest(public_key))
}

fn load_key_pair(encoded: &str) -> Result<Ed25519KeyPair, String> {
    let pkcs8 = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|error| format!("decode device identity: {error}"))?;
    Ed25519KeyPair::from_pkcs8(&pkcs8).map_err(|error| format!("read device identity: {error}"))
}

async fn load_or_create_key_pair_from_app_data() -> Result<Ed25519KeyPair, String> {
    let path = paths::app_config_dir().join(DEVICE_IDENTITY_FILE);
    if path.exists() {
        let raw = std::fs::read_to_string(&path)
            .map_err(|error| format!("read device identity: {error}"))?;
        let stored: StoredDeviceIdentity = serde_json::from_str(&raw)
            .map_err(|error| format!("parse device identity: {error}"))?;
        if stored.version != 1 {
            return Err("device identity version is unsupported".to_string());
        }
        return load_key_pair(&stored.private_key);
    }

    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|error| format!("generate device identity: {error}"))?;
    let encoded = URL_SAFE_NO_PAD.encode(pkcs8.as_ref());
    let record = serde_json::json!({ "version": 1, "privateKey": encoded });
    paths::atomic_write_text(
        &path,
        &serde_json::to_string(&record)
            .map_err(|error| format!("serialize device identity: {error}"))?,
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("protect device identity: {error}"))?;
    }
    load_key_pair(&encoded)
}

async fn load_or_create_key_pair() -> Result<&'static Ed25519KeyPair, String> {
    device_identity_cache()
        .load_or_try_initialize(load_or_create_key_pair_from_app_data)
        .await
}

fn identity_reference(key_pair: &Ed25519KeyPair) -> GatewayDeviceIdentityReference {
    let public_key = key_pair.public_key().as_ref();
    GatewayDeviceIdentityReference {
        device_id: device_id(public_key),
        public_key: URL_SAFE_NO_PAD.encode(public_key),
    }
}

fn build_gateway_device_auth_payload_v3(
    device_id: &str,
    params: &GatewayDeviceChallengeParams,
) -> String {
    format!(
        "v3|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        device_id,
        params.client_id,
        params.client_mode,
        params.role,
        params.scopes.join(","),
        params.signed_at,
        params.token,
        params.nonce,
        normalize_device_metadata(&params.platform),
        normalize_device_metadata(params.device_family.as_deref().unwrap_or("")),
    )
}

#[tauri::command]
pub async fn get_gateway_device_identity_reference(
) -> Result<GatewayDeviceIdentityReference, String> {
    Ok(identity_reference(load_or_create_key_pair().await?))
}

#[tauri::command]
pub async fn sign_gateway_device_challenge(
    params: GatewayDeviceChallengeParams,
) -> Result<GatewayDeviceChallengeSignature, String> {
    let params = validate_params(params)?;
    let key_pair = load_or_create_key_pair().await?;
    let identity = identity_reference(key_pair);
    let payload = build_gateway_device_auth_payload_v3(&identity.device_id, &params);
    let signature = URL_SAFE_NO_PAD.encode(key_pair.sign(payload.as_bytes()).as_ref());
    Ok(GatewayDeviceChallengeSignature {
        device_id: identity.device_id,
        public_key: identity.public_key,
        signature,
        signed_at: params.signed_at,
        nonce: params.nonce,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn successful_device_identity_load_is_reused_within_the_process() {
        let cache = DeviceIdentityCache {
            key_pair: tokio::sync::OnceCell::new(),
        };
        let calls = AtomicUsize::new(0);

        let first = cache
            .load_or_try_initialize(|| async {
                calls.fetch_add(1, Ordering::SeqCst);
                let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
                    .map_err(|error| format!("generate test device identity: {error}"))?;
                Ed25519KeyPair::from_pkcs8(pkcs8.as_ref())
                    .map_err(|error| format!("read test device identity: {error}"))
            })
            .await
            .expect("first identity load succeeds");
        let first_public_key = first.public_key().as_ref().to_vec();

        let second = cache
            .load_or_try_initialize(|| async {
                calls.fetch_add(1, Ordering::SeqCst);
                unreachable!("已成功加载的身份不得再次读取持久化状态")
            })
            .await
            .expect("cached identity load succeeds");

        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(second.public_key().as_ref(), first_public_key.as_slice());
    }

    #[test]
    fn validation_rejects_empty_or_controlled_challenge_fields() {
        assert!(validate_params(GatewayDeviceChallengeParams {
            nonce: "nonce".to_string(),
            signed_at: 1,
            client_id: "junqi".to_string(),
            client_mode: "desktop".to_string(),
            role: "operator".to_string(),
            scopes: vec!["operator.read".to_string()],
            token: "token".to_string(),
            platform: "linux".to_string(),
            device_family: None,
        })
        .is_ok());
        assert!(validate_params(GatewayDeviceChallengeParams {
            nonce: "\n".to_string(),
            signed_at: 1,
            client_id: "junqi".to_string(),
            client_mode: "desktop".to_string(),
            role: "operator".to_string(),
            scopes: vec!["operator.read".to_string()],
            token: "token".to_string(),
            platform: "linux".to_string(),
            device_family: None,
        })
        .is_err());
    }

    #[test]
    fn v3_payload_uses_challenge_time_and_normalized_metadata() {
        let params = validate_params(GatewayDeviceChallengeParams {
            nonce: "challenge-nonce".to_string(),
            signed_at: 1_735_000_000_123,
            client_id: "openclaw-control-ui".to_string(),
            client_mode: "ui".to_string(),
            role: "operator".to_string(),
            scopes: vec!["operator.read".to_string(), "operator.write".to_string()],
            token: "".to_string(),
            platform: "Windows".to_string(),
            device_family: Some(" Desktop ".to_string()),
        })
        .expect("valid v3 device auth params");

        assert_eq!(
            build_gateway_device_auth_payload_v3("device-id", &params),
            "v3|device-id|openclaw-control-ui|ui|operator|operator.read,operator.write|1735000000123||challenge-nonce|windows|desktop",
        );
    }

    #[test]
    fn validation_allows_empty_signature_token_but_rejects_invalid_time() {
        let valid = GatewayDeviceChallengeParams {
            nonce: "nonce".to_string(),
            signed_at: 0,
            client_id: "junqi".to_string(),
            client_mode: "ui".to_string(),
            role: "operator".to_string(),
            scopes: vec!["operator.read".to_string()],
            token: "".to_string(),
            platform: "linux".to_string(),
            device_family: None,
        };
        assert!(validate_params(valid.clone()).is_ok());
        assert!(validate_params(GatewayDeviceChallengeParams {
            signed_at: MAX_SAFE_INTEGER + 1,
            ..valid
        })
        .is_err());
    }

    #[test]
    fn public_identity_does_not_expose_pkcs8_material() {
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).unwrap();
        let reference = identity_reference(&key_pair);
        assert_eq!(reference.device_id.len(), 64);
        assert_ne!(reference.public_key, URL_SAFE_NO_PAD.encode(pkcs8.as_ref()));
    }
}
