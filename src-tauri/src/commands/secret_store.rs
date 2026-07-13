//! Provider secret store backed by the operating system credential vault.
//!
//! Stores API keys and OAuth tokens outside `openclaw.json` so the
//! config file never contains credentials in plaintext. Matches
//! JunQi's `electron/services/secrets/` pattern.
//!
//! macOS uses Keychain, Windows uses Credential Manager, and Linux uses
//! Secret Service. There is deliberately no plaintext file fallback.
//!
//! Frontend calls:
//!   store_secret   — save a credential for an account
//!   get_secret     — retrieve a credential (UI shows masked)
//!   delete_secret  — remove a credential
//!   list_secrets   — enumerate stored credential labels

use serde::{Deserialize, Serialize};

/// A secret stored in the keychain. The id is the ProviderAccount id;
/// the label is a human-readable name shown in the macOS Keychain UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredSecret {
    pub account_id: String,
    pub label: String,
    /// Masked key shown in the UI (last 4 chars, e.g. "…abcd").
    pub masked: String,
}

/// In-memory cache of stored secrets so the frontend can list them
/// without hitting the keychain on every render. Refreshed on each
/// mutation (store/delete).
static SECRETS_CACHE: std::sync::OnceLock<std::sync::Mutex<Vec<StoredSecret>>> =
    std::sync::OnceLock::new();

fn secrets_cache() -> &'static std::sync::Mutex<Vec<StoredSecret>> {
    SECRETS_CACHE.get_or_init(|| std::sync::Mutex::new(Vec::new()))
}

fn mask_secret(value: &str) -> String {
    if value.len() <= 4 {
        return "••••".to_string();
    }
    format!("…{}", &value[value.len() - 4..])
}

fn keychain_service_name() -> &'static str {
    "junqi-desktop-provider-secrets"
}

fn credential_entry(account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(keychain_service_name(), account_id)
        .map_err(|error| format!("open system credential store: {error}"))
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

async fn rebuild_cache() -> Vec<StoredSecret> {
    // List all known secrets from the frontend store + keychain.
    // For now we return the in-memory cache; a full implementation
    // would walk the keychain entries by account_id prefix.
    let cache = secrets_cache().lock().unwrap().clone();
    cache
}

#[tauri::command]
pub async fn store_provider_secret(
    account_id: String,
    label: String,
    value: String,
) -> Result<StoredSecret, String> {
    store_in_keychain(&account_id, &label, &value).await?;
    let secret = StoredSecret {
        account_id: account_id.clone(),
        label,
        masked: mask_secret(&value),
    };
    // Update in-memory cache.
    let mut cache = secrets_cache().lock().unwrap();
    cache.retain(|s| s.account_id != *account_id);
    cache.push(secret.clone());
    Ok(secret)
}

#[tauri::command]
pub async fn get_provider_secret(account_id: String) -> Result<String, String> {
    get_from_keychain(&account_id).await
}

#[tauri::command]
pub async fn delete_provider_secret(account_id: String) -> Result<(), String> {
    delete_from_keychain(&account_id).await?;
    let mut cache = secrets_cache().lock().unwrap();
    cache.retain(|s| s.account_id != *account_id);
    Ok(())
}

#[tauri::command]
pub async fn list_provider_secrets() -> Result<Vec<StoredSecret>, String> {
    Ok(rebuild_cache().await)
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
}
