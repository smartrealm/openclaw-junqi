//! Provider secret store backed by the operating system credential vault.
//!
//! Stores API keys and OAuth tokens outside `openclaw.json` so the
//! config file never contains credentials in plaintext. Matches
//! JunQi's `electron/services/secrets/` pattern.
//!
//! macOS uses Keychain, Windows uses Credential Manager, and Linux uses
//! Secret Service. There is deliberately no plaintext file fallback.
//!
//! Only non-sensitive labels and masked suffixes are persisted locally so
//! credentials remain enumerable after an application restart.

use crate::paths;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

/// A secret stored in the keychain. The id is the ProviderAccount id;
/// the label is a human-readable name shown in the macOS Keychain UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSecret {
    pub account_id: String,
    pub label: String,
    /// Masked key shown in the UI (last 4 chars, e.g. "…abcd").
    pub masked: String,
}

fn secret_operation() -> &'static tokio::sync::Mutex<()> {
    static OPERATION: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    OPERATION.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn mask_secret(value: &str) -> String {
    let suffix: String = value
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if value.chars().count() <= 4 {
        return "••••".to_string();
    }
    format!("…{suffix}")
}

fn metadata_path() -> std::path::PathBuf {
    paths::app_config_dir().join("provider-secrets.json")
}

fn load_metadata_from(path: &std::path::Path) -> Result<Vec<StoredSecret>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("read provider secret metadata: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("parse provider secret metadata: {error}"))
}

fn save_metadata_to(path: &std::path::Path, entries: &[StoredSecret]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(entries)
        .map_err(|error| format!("serialize provider secret metadata: {error}"))?;
    paths::atomic_write_text(path, &raw)
        .map_err(|error| format!("write provider secret metadata: {error}"))
}

fn upsert_metadata(entries: &mut Vec<StoredSecret>, secret: StoredSecret) {
    entries.retain(|entry| entry.account_id != secret.account_id);
    entries.push(secret);
    entries.sort_by(|left, right| left.account_id.cmp(&right.account_id));
}

fn validate_secret_input(account_id: &str, value: &str) -> Result<(), String> {
    if account_id.trim().is_empty()
        || account_id.len() > 256
        || account_id.chars().any(char::is_control)
    {
        return Err("Provider secret account ID is invalid".into());
    }
    if value.trim().is_empty() {
        return Err("Provider secret value cannot be empty".into());
    }
    Ok(())
}

fn keychain_service_name() -> &'static str {
    "junqi-desktop-provider-secrets"
}

fn gateway_keychain_service_name() -> &'static str {
    "junqi-desktop-gateway-credentials"
}

fn credential_entry_for(service: &str, account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account_id)
        .map_err(|error| format!("open system credential store: {error}"))
}

fn credential_entry(account_id: &str) -> Result<keyring::Entry, String> {
    credential_entry_for(keychain_service_name(), account_id)
}

fn canonical_gateway_endpoint(endpoint: &str) -> Result<String, String> {
    let mut url = url::Url::parse(endpoint.trim())
        .map_err(|error| format!("Gateway endpoint is invalid: {error}"))?;
    let canonical_scheme = match url.scheme() {
        "http" | "ws" => "ws",
        "https" | "wss" => "wss",
        scheme => return Err(format!("Unsupported Gateway endpoint scheme: {scheme}")),
    };
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Gateway endpoint must not contain embedded credentials".into());
    }
    url.set_scheme(canonical_scheme)
        .map_err(|_| "Failed to normalize Gateway endpoint scheme".to_string())?;
    url.set_query(None);
    url.set_fragment(None);
    let host = url
        .host_str()
        .ok_or_else(|| "Gateway endpoint must include a host".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Gateway endpoint must include a port".to_string())?;
    let host = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_ascii_lowercase()
    };
    let path = url.path().trim_end_matches('/');
    Ok(format!("{canonical_scheme}://{host}:{port}{path}"))
}

fn gateway_credential_account(endpoint: &str, scope: Option<&str>) -> Result<String, String> {
    let canonical = canonical_gateway_endpoint(endpoint)?;
    let scope = scope
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("endpoint");
    let digest = Sha256::digest(format!("{scope}\0{canonical}").as_bytes());
    Ok(format!("endpoint:{digest:x}"))
}

/// This build includes an OS-backed keyring backend on every supported target.
/// Runtime availability is still checked by each operation and never falls
/// back to a plaintext file.
pub(crate) fn system_credential_store_available() -> bool {
    true
}

pub(crate) async fn store_system_credential(
    service: &str,
    account_id: &str,
    _label: &str,
    value: &str,
) -> Result<(), String> {
    let service = service.to_string();
    let account_id = account_id.to_string();
    let value = value.to_string();
    tokio::task::spawn_blocking(move || {
        credential_entry_for(&service, &account_id)?
            .set_password(&value)
            .map_err(|error| format!("store credential in system vault: {error}"))
    })
    .await
    .map_err(|error| format!("credential store task failed: {error}"))?
}

pub(crate) async fn get_system_credential(
    service: &str,
    account_id: &str,
) -> Result<Option<String>, String> {
    let service = service.to_string();
    let account_id = account_id.to_string();
    tokio::task::spawn_blocking(move || {
        match credential_entry_for(&service, &account_id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!("read credential from system vault: {error}")),
        }
    })
    .await
    .map_err(|error| format!("credential read task failed: {error}"))?
}

pub(crate) async fn delete_system_credential(
    service: &str,
    account_id: &str,
) -> Result<(), String> {
    let service = service.to_string();
    let account_id = account_id.to_string();
    tokio::task::spawn_blocking(move || {
        match credential_entry_for(&service, &account_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("delete credential from system vault: {error}")),
        }
    })
    .await
    .map_err(|error| format!("credential delete task failed: {error}"))?
}

async fn store_in_keychain(account_id: &str, _label: &str, value: &str) -> Result<(), String> {
    let account_id = account_id.to_string();
    let value = value.to_string();
    tokio::task::spawn_blocking(move || {
        credential_entry(&account_id)?
            .set_password(&value)
            .map_err(|error| format!("store credential in system vault: {error}"))
    })
    .await
    .map_err(|error| format!("credential store task failed: {error}"))?
}

async fn get_from_keychain(account_id: &str) -> Result<String, String> {
    let account_id = account_id.to_string();
    tokio::task::spawn_blocking(move || {
        credential_entry(&account_id)?
            .get_password()
            .map_err(|error| format!("read credential from system vault: {error}"))
    })
    .await
    .map_err(|error| format!("credential read task failed: {error}"))?
}

async fn delete_from_keychain(account_id: &str) -> Result<(), String> {
    let account_id = account_id.to_string();
    tokio::task::spawn_blocking(
        move || match credential_entry(&account_id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("delete credential from system vault: {error}")),
        },
    )
    .await
    .map_err(|error| format!("credential delete task failed: {error}"))?
}

// ── Tauri commands ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn store_provider_secret(
    account_id: String,
    label: String,
    value: String,
) -> Result<StoredSecret, String> {
    validate_secret_input(&account_id, &value)?;
    let _guard = secret_operation().lock().await;
    let path = metadata_path();
    let mut entries = load_metadata_from(&path)?;
    let previous_value = get_from_keychain(&account_id).await.ok();
    store_in_keychain(&account_id, &label, &value).await?;
    let secret = StoredSecret {
        account_id: account_id.clone(),
        label: label.clone(),
        masked: mask_secret(&value),
    };
    upsert_metadata(&mut entries, secret.clone());
    if let Err(error) = save_metadata_to(&path, &entries) {
        if let Some(previous) = previous_value {
            let _ = store_in_keychain(&account_id, &label, &previous).await;
        } else {
            let _ = delete_from_keychain(&account_id).await;
        }
        return Err(error);
    }
    Ok(secret)
}

#[tauri::command]
pub async fn get_provider_secret(account_id: String) -> Result<String, String> {
    if account_id.trim().is_empty() {
        return Err("Provider secret account ID is invalid".into());
    }
    let _guard = secret_operation().lock().await;
    let value = get_from_keychain(&account_id).await?;
    let path = metadata_path();
    let mut entries = load_metadata_from(&path)?;
    if !entries.iter().any(|entry| entry.account_id == account_id) {
        upsert_metadata(
            &mut entries,
            StoredSecret {
                account_id: account_id.clone(),
                label: account_id.clone(),
                masked: mask_secret(&value),
            },
        );
        save_metadata_to(&path, &entries)?;
    }
    Ok(value)
}

#[tauri::command]
pub async fn delete_provider_secret(account_id: String) -> Result<(), String> {
    let _guard = secret_operation().lock().await;
    let path = metadata_path();
    let previous = load_metadata_from(&path)?;
    let mut updated = previous.clone();
    updated.retain(|entry| entry.account_id != account_id);
    save_metadata_to(&path, &updated)?;
    if let Err(error) = delete_from_keychain(&account_id).await {
        let _ = save_metadata_to(&path, &previous);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn list_provider_secrets() -> Result<Vec<StoredSecret>, String> {
    let _guard = secret_operation().lock().await;
    load_metadata_from(&metadata_path())
}

#[tauri::command]
pub async fn get_legacy_gateway_credential(
    endpoint: String,
    scope: Option<String>,
) -> Result<Option<String>, String> {
    let account_id = gateway_credential_account(&endpoint, scope.as_deref())?;
    let _guard = secret_operation().lock().await;
    tokio::task::spawn_blocking(move || {
        match credential_entry_for(gateway_keychain_service_name(), &account_id)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(format!(
                "read Gateway credential from system vault: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("Gateway credential read task failed: {error}"))?
}

#[tauri::command]
pub async fn delete_legacy_gateway_credential(
    endpoint: String,
    scope: Option<String>,
) -> Result<(), String> {
    let account_id = gateway_credential_account(&endpoint, scope.as_deref())?;
    let _guard = secret_operation().lock().await;
    tokio::task::spawn_blocking(move || {
        match credential_entry_for(gateway_keychain_service_name(), &account_id)?
            .delete_credential()
        {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!(
                "delete Gateway credential from system vault: {error}"
            )),
        }
    })
    .await
    .map_err(|error| format!("Gateway credential delete task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_secret_handles_short_value() {
        assert_eq!(mask_secret("ab"), "••••");
    }

    #[test]
    fn mask_secret_shows_last_4() {
        assert_eq!(mask_secret("sk-abc123def456"), "…f456");
    }

    #[test]
    fn mask_secret_handles_unicode_boundaries() {
        assert_eq!(mask_secret("token-密钥甲乙丙丁"), "…甲乙丙丁");
    }

    #[test]
    fn metadata_is_persisted_and_sorted_without_secret_values() {
        let path = std::env::temp_dir().join(format!(
            "junqi-secret-metadata-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let mut entries = Vec::new();
        upsert_metadata(
            &mut entries,
            StoredSecret {
                account_id: "z".into(),
                label: "Zed".into(),
                masked: "…1234".into(),
            },
        );
        upsert_metadata(
            &mut entries,
            StoredSecret {
                account_id: "a".into(),
                label: "Alpha".into(),
                masked: "…5678".into(),
            },
        );
        save_metadata_to(&path, &entries).unwrap();

        let loaded = load_metadata_from(&path).unwrap();
        assert_eq!(loaded[0].account_id, "a");
        assert_eq!(loaded[1].account_id, "z");
        assert!(!std::fs::read_to_string(&path).unwrap().contains("token-"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn secret_input_rejects_empty_and_control_values() {
        assert!(validate_secret_input("", "token").is_err());
        assert!(validate_secret_input("account\nname", "token").is_err());
        assert!(validate_secret_input("account", "   ").is_err());
        assert!(validate_secret_input("account", "token").is_ok());
    }

    #[test]
    fn mask_secret_exactly_4_shows_ellipsis() {
        assert_eq!(mask_secret("abcd"), "••••");
    }

    #[test]
    fn stored_secret_serializes() {
        let s = StoredSecret {
            account_id: "acc-1".into(),
            label: "OpenAI Work".into(),
            masked: "…f456".into(),
        };
        let json = serde_json::to_string(&s).unwrap();
        assert!(json.contains("acc-1"));
        assert!(json.contains("OpenAI Work"));
        assert!(!json.contains("sk-")); // masked never contains raw key
    }

    #[test]
    fn gateway_endpoint_normalization_matches_http_and_websocket_surfaces() {
        assert_eq!(
            canonical_gateway_endpoint("http://LOCALHOST:18789/").unwrap(),
            "ws://localhost:18789"
        );
        assert_eq!(
            gateway_credential_account(
                "http://localhost:18789",
                Some("native:/state/openclaw.json")
            )
            .unwrap(),
            gateway_credential_account(
                "ws://localhost:18789/",
                Some("native:/state/openclaw.json")
            )
            .unwrap()
        );
        assert_eq!(
            gateway_credential_account("https://gateway.example/base/", None).unwrap(),
            gateway_credential_account("wss://gateway.example:443/base", None).unwrap()
        );
        assert_ne!(
            gateway_credential_account("ws://localhost:18789", Some("native:/state/openclaw.json"))
                .unwrap(),
            gateway_credential_account("ws://localhost:18789", Some("docker:/state/openclaw.json"))
                .unwrap()
        );
    }

    #[test]
    fn gateway_endpoint_rejects_embedded_credentials_and_unknown_schemes() {
        assert!(canonical_gateway_endpoint("ws://token@example.com:18789").is_err());
        assert!(canonical_gateway_endpoint("file:///tmp/gateway.sock").is_err());
    }
}
