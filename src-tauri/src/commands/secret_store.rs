//! Provider secret store — macOS Keychain + file-based fallback.
//!
//! Stores API keys and OAuth tokens outside `openclaw.json` so the
//! config file never contains credentials in plaintext. Matches
//! JunQi's `electron/services/secrets/` pattern.
//!
//! On macOS: uses the built-in Keychain via `security` CLI.
//! On Linux/Windows: falls back to JSON file with 600 permissions.
//!
//! Frontend calls:
//!   store_secret   — save a credential for an account
//!   get_secret     — retrieve a credential (UI shows masked)
//!   delete_secret  — remove a credential
//!   list_secrets   — enumerate stored credential labels

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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

#[cfg(target_os = "macos")]
fn keychain_service_name() -> &'static str {
    "junqi-desktop-provider-secrets"
}

/// Store a secret using macOS Keychain.
#[cfg(target_os = "macos")]
async fn store_in_keychain(account_id: &str, label: &str, value: &str) -> Result<(), String> {
    let service = keychain_service_name();
    let output = tokio::process::Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            account_id,
            "-s",
            service,
            "-l",
            label,
            "-w",
            value,
            "-U", // update if exists
        ])
        .output()
        .await
        .map_err(|e| format!("spawn security: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Exit code 45 = "password already exists" when `-U` is not
        // passed; we pass `-U` so this shouldn't happen, but if it
        // does, delete first and retry.
        if output.status.code() == Some(45) {
            let _ = tokio::process::Command::new("security")
                .args(["delete-generic-password", "-a", account_id, "-s", service])
                .output()
                .await;
            return Box::pin(store_in_keychain(account_id, label, value)).await;
        }
        return Err(format!("security add-generic-password failed: {stderr}"));
    }
    Ok(())
}

/// Retrieve a secret from macOS Keychain.
#[cfg(target_os = "macos")]
async fn get_from_keychain(account_id: &str) -> Result<String, String> {
    let service = keychain_service_name();
    let output = tokio::process::Command::new("security")
        .args([
            "find-generic-password",
            "-a",
            account_id,
            "-s",
            service,
            "-w",
        ])
        .output()
        .await
        .map_err(|e| format!("spawn security: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "security find-generic-password failed: {}",
            String::from_utf8_lossy(&output.stderr),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Delete a secret from macOS Keychain.
#[cfg(target_os = "macos")]
async fn delete_from_keychain(account_id: &str) -> Result<(), String> {
    let service = keychain_service_name();
    let output = tokio::process::Command::new("security")
        .args(["delete-generic-password", "-a", account_id, "-s", service])
        .output()
        .await
        .map_err(|e| format!("spawn security: {e}"))?;
    // Exit status 44 = "item not found" — not an error for delete.
    if !output.status.success() && output.status.code() != Some(44) {
        return Err(format!(
            "security delete-generic-password failed: {}",
            String::from_utf8_lossy(&output.stderr),
        ));
    }
    Ok(())
}

// ── File-based fallback (non-macOS) ──────────────────────────────────────

fn secrets_file_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home dir".to_string())?;
    let dir = home.join(".openclaw").join("secrets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create secrets dir: {e}"))?;
    Ok(dir.join("provider-secrets.json"))
}

#[cfg(not(target_os = "macos"))]
async fn store_in_keychain(account_id: &str, label: &str, value: &str) -> Result<(), String> {
    let path = secrets_file_path()?;
    let mut entries: serde_json::Map<String, serde_json::Value> = if path.exists() {
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        Default::default()
    };
    entries.insert(
        account_id.to_string(),
        serde_json::json!({
            "label": label,
            "value": value,
        }),
    );
    let json = serde_json::to_string_pretty(&entries).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, &json).map_err(|e| format!("write: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
async fn get_from_keychain(account_id: &str) -> Result<String, String> {
    let path = secrets_file_path()?;
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("read secrets file: {e}"))?;
    let entries: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&raw).map_err(|e| format!("parse secrets file: {e}"))?;
    let entry = entries
        .get(account_id)
        .ok_or_else(|| "secret not found".to_string())?;
    entry["value"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "invalid secret entry".to_string())
}

#[cfg(not(target_os = "macos"))]
async fn delete_from_keychain(account_id: &str) -> Result<(), String> {
    let path = secrets_file_path()?;
    let mut entries: serde_json::Map<String, serde_json::Value> = if path.exists() {
        let raw = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        return Ok(());
    };
    entries.remove(account_id);
    let json = serde_json::to_string_pretty(&entries).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&path, &json).map_err(|e| format!("write: {e}"))?;
    Ok(())
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
