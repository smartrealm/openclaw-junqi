//! Gateway device signing backed by the operating-system credential store.
//!
//! The renderer never receives the private key. A newly created identity is a
//! new OpenClaw device and therefore may require normal OpenClaw pairing.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::{
    rand::SystemRandom,
    signature::{Ed25519KeyPair, KeyPair},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

use crate::commands::secret_store::{get_system_credential, store_system_credential};

const DEVICE_IDENTITY_SERVICE: &str = "junqi-desktop-gateway-device-identity";
const DEVICE_IDENTITY_ACCOUNT: &str = "default";
const DEVICE_IDENTITY_LABEL: &str = "JunQi Gateway device identity";
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

fn identity_operation() -> &'static tokio::sync::Mutex<()> {
    static OPERATION: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    OPERATION.get_or_init(|| tokio::sync::Mutex::new(()))
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

async fn load_or_create_key_pair() -> Result<Ed25519KeyPair, String> {
    let _guard = identity_operation().lock().await;
    if let Some(encoded) =
        get_system_credential(DEVICE_IDENTITY_SERVICE, DEVICE_IDENTITY_ACCOUNT).await?
    {
        return load_key_pair(&encoded);
    }

    let pkcs8 = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new())
        .map_err(|error| format!("generate device identity: {error}"))?;
    let encoded = URL_SAFE_NO_PAD.encode(pkcs8.as_ref());
    store_system_credential(
        DEVICE_IDENTITY_SERVICE,
        DEVICE_IDENTITY_ACCOUNT,
        DEVICE_IDENTITY_LABEL,
        &encoded,
    )
    .await?;
    load_key_pair(&encoded)
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
    Ok(identity_reference(&load_or_create_key_pair().await?))
}

#[tauri::command]
pub async fn sign_gateway_device_challenge(
    params: GatewayDeviceChallengeParams,
) -> Result<GatewayDeviceChallengeSignature, String> {
    let params = validate_params(params)?;
    let key_pair = load_or_create_key_pair().await?;
    let identity = identity_reference(&key_pair);
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
