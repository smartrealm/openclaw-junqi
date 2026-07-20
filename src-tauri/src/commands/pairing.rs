use crate::paths;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn pairing_file_path() -> PathBuf {
    paths::desktop_dir()
        .join("credentials")
        .join("telegram-pairing.json")
}

fn allow_from_file_path_in(creds: &Path, account_id: Option<&str>) -> Result<PathBuf, String> {
    match account_id {
        Some(id)
            if !id.is_empty()
                && id.len() <= 128
                && id.chars().all(|value| {
                    value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.')
                }) =>
        {
            Ok(creds.join(format!("telegram-{id}-allowFrom.json")))
        }
        Some(_) => Err("Invalid Telegram pairing account ID".into()),
        None => Ok(creds.join("telegram-allowFrom.json")),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairingRequest {
    pub id: String,
    pub code: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
    #[serde(default)]
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PairingStore {
    version: u32,
    requests: Vec<PairingRequest>,
}

fn pairing_operation() -> &'static tokio::sync::Mutex<()> {
    static OPERATION: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
    OPERATION.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn parse_iso_timestamp(s: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .and_then(|value| u64::try_from(value.timestamp()).ok())
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?;
    paths::atomic_write_text(path, &raw)
        .map_err(|error| format!("Failed to write {}: {error}", path.display()))
}

/// List pending Telegram pairing requests
#[tauri::command]
pub async fn list_pairing_requests() -> Result<Vec<PairingRequest>, String> {
    let _guard = pairing_operation().lock().await;
    let path = pairing_file_path();
    if !path.exists() {
        return Ok(vec![]);
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read pairing file: {}", e))?;
    let store: PairingStore =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse pairing file: {}", e))?;

    // Filter out expired requests (1 hour TTL)
    let now = now_secs();
    let valid: Vec<PairingRequest> = store
        .requests
        .into_iter()
        .filter(|r| {
            if let Some(created) = parse_iso_timestamp(&r.created_at) {
                now.saturating_sub(created) < 3600
            } else {
                false
            }
        })
        .collect();

    Ok(valid)
}

/// Approve a Telegram pairing request by code.
/// This removes the request from the pairing store and adds the user ID to the allowFrom list.
#[tauri::command]
pub async fn approve_pairing_request(code: String) -> Result<String, String> {
    let _guard = pairing_operation().lock().await;
    let path = pairing_file_path();
    approve_pairing_request_in(&code, &path, &paths::desktop_dir().join("credentials"))
}

fn approve_pairing_request_in(
    code: &str,
    path: &Path,
    credentials_dir: &Path,
) -> Result<String, String> {
    if !path.exists() {
        return Err("No pairing requests found".into());
    }

    let raw =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read pairing file: {}", e))?;
    let mut store: PairingStore =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse pairing file: {}", e))?;

    // Find the request by code (case-insensitive, matching OpenClaw behavior)
    let idx = store
        .requests
        .iter()
        .position(|r| r.code.eq_ignore_ascii_case(code))
        .ok_or_else(|| format!("No pairing request found with code: {}", code))?;

    let request = store.requests[idx].clone();
    let user_id = request.id.clone();

    // Extract accountId from request meta (e.g., Telegram bot account)
    let account_id = request
        .meta
        .as_ref()
        .and_then(|m| m.get("accountId"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Commit authorization first. If removing the request subsequently fails,
    // retrying is idempotent and cannot strand the user without authorization.
    let allow_path = allow_from_file_path_in(credentials_dir, account_id.as_deref())?;
    let mut allow_list: Vec<String> = if allow_path.exists() {
        let raw = std::fs::read_to_string(&allow_path)
            .map_err(|e| format!("Failed to read allowFrom file: {e}"))?;
        let store: serde_json::Value = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse allowFrom file: {e}"))?;
        store
            .get("allowFrom")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![]
    };

    if !allow_list.contains(&user_id) {
        allow_list.push(user_id.clone());
    }

    let allow_store = serde_json::json!({
        "version": 1,
        "allowFrom": allow_list,
    });
    write_json_atomic(&allow_path, &allow_store)?;

    store.requests.remove(idx);
    write_json_atomic(path, &store)?;

    Ok(user_id)
}

/// Reject a Telegram pairing request by code (just removes it from pending).
#[tauri::command]
pub async fn reject_pairing_request(code: String) -> Result<(), String> {
    let _guard = pairing_operation().lock().await;
    let path = pairing_file_path();
    if !path.exists() {
        return Ok(());
    }

    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read pairing file: {}", e))?;
    let mut store: PairingStore =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse pairing file: {}", e))?;

    store
        .requests
        .retain(|r| !r.code.eq_ignore_ascii_case(&code));
    write_json_atomic(&path, &store)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-pairing-{name}-{}-{}",
            std::process::id(),
            now_secs()
        ))
    }

    fn request_store() -> PairingStore {
        PairingStore {
            version: 1,
            requests: vec![PairingRequest {
                id: "user-1".into(),
                code: "ABC123".into(),
                created_at: "2026-07-14T10:00:00Z".into(),
                last_seen_at: "2026-07-14T10:00:00Z".into(),
                meta: Some(serde_json::json!({"accountId": "main"})),
            }],
        }
    }

    #[test]
    fn approval_authorizes_before_removing_the_request() {
        let root = test_root("approve");
        let pairing_path = root.join("telegram-pairing.json");
        let credentials = root.join("credentials");
        write_json_atomic(&pairing_path, &request_store()).unwrap();

        assert_eq!(
            approve_pairing_request_in("abc123", &pairing_path, &credentials).unwrap(),
            "user-1"
        );
        let remaining: PairingStore =
            serde_json::from_str(&std::fs::read_to_string(&pairing_path).unwrap()).unwrap();
        assert!(remaining.requests.is_empty());
        let allow_path = credentials.join("telegram-main-allowFrom.json");
        let allow: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(allow_path).unwrap()).unwrap();
        assert_eq!(allow["allowFrom"], serde_json::json!(["user-1"]));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn approval_failure_keeps_the_request_retryable() {
        let root = test_root("retry");
        let pairing_path = root.join("telegram-pairing.json");
        let credentials = root.join("credentials");
        write_json_atomic(&pairing_path, &request_store()).unwrap();
        std::fs::write(&credentials, "blocks directory creation").unwrap();

        assert!(approve_pairing_request_in("ABC123", &pairing_path, &credentials).is_err());
        let remaining: PairingStore =
            serde_json::from_str(&std::fs::read_to_string(&pairing_path).unwrap()).unwrap();
        assert_eq!(remaining.requests.len(), 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn timestamp_parser_rejects_invalid_dates_without_panicking() {
        assert!(parse_iso_timestamp("2026-07-14T10:00:00Z").is_some());
        assert_eq!(parse_iso_timestamp("1969-01-01T00:00:00Z"), None);
        assert_eq!(parse_iso_timestamp("not-a-date"), None);
    }

    #[test]
    fn account_id_cannot_escape_the_credentials_directory() {
        let root = Path::new("/tmp/credentials");
        assert!(allow_from_file_path_in(root, Some("main-account_1")).is_ok());
        assert!(allow_from_file_path_in(root, Some("../../outside")).is_err());
        assert!(allow_from_file_path_in(root, Some("windows\\outside")).is_err());
    }
}
