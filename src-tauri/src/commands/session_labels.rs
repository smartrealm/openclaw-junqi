//! Session-label overrides — persistent local mirror of the user's
//! renamed session labels.
//!
//! The openclaw gateway may not persist the `label` field of `sessions.patch`
//! across restarts, so this module provides a Tauri-side store backed by a
//! JSON file in the app's data directory. The renderer writes to it
//! every time the user renames a session, and reads it on startup as the
//! canonical source of truth.
//!
//! Storage: `~/.openclaw/session-labels.json`
//! Format: `{ "<session-key>": "<user-rename>" }`
//!
//! Note: these are display labels, not secrets — no encryption. The file
//! is written with restrictive (0600) permissions as a baseline.

use serde_json::{json, Value};
use std::path::PathBuf;

/// Returns the on-disk path for the override store. The file is created
/// lazily on first write.
fn labels_path() -> PathBuf {
    crate::paths::desktop_dir().join("session-labels.json")
}

/// Reads the full label map. Returns an empty map if the file is missing
/// or malformed — the merge logic in the renderer treats "no override" and
/// "empty map" identically.
#[tauri::command]
pub async fn load_session_labels() -> Result<Value, String> {
    let path = labels_path();
    match tokio::fs::read(&path).await {
        Ok(bytes) => {
            let raw = String::from_utf8_lossy(&bytes);
            match serde_json::from_str::<Value>(&raw) {
                Ok(v) if v.is_object() => Ok(v),
                // Malformed or not-an-object: treat as empty so the caller
                // falls back to server-side labels. Don't surface a hard
                // error — a broken file should not break the chat UI.
                _ => Ok(json!({})),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({})),
        Err(e) => Err(format!("Failed to read session labels: {e}")),
    }
}

/// Inserts or removes a single label override. Pass `label: null` (or an
/// empty string) to remove the override for the given key.
///
/// Writes are serialized via a process-wide Mutex so concurrent renames
/// from different windows don't clobber each other. The whole file is
/// rewritten on every write — the map is small (a few entries) and
/// rewriting avoids read-modify-write races.
#[tauri::command]
pub async fn upsert_session_label(key: String, label: Option<String>) -> Result<(), String> {
    static WRITE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    let _guard = WRITE_LOCK.lock().await;

    let path = labels_path();
    // Ensure parent dir exists (idempotent).
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to ensure data dir: {e}"))?;
    }

    // Read current map; treat missing/malformed as empty.
    let mut map: Value = match tokio::fs::read(&path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|_| json!({})),
        Err(_) => json!({}),
    };
    if !map.is_object() {
        map = json!({});
    }

    // Apply the change.
    if let Some(l) = label {
        let trimmed = l.trim();
        if trimmed.is_empty() {
            map.as_object_mut().and_then(|o| o.remove(&key));
        } else {
            map.as_object_mut()
                .and_then(|o| o.insert(key.clone(), Value::String(trimmed.to_string())));
        }
    } else {
        map.as_object_mut().and_then(|o| o.remove(&key));
    }

    // Serialize and atomically replace the file. We use a tempfile +
    // rename so a partial write never leaves the user with a corrupt
    // override store.
    let serialized =
        serde_json::to_string_pretty(&map).map_err(|e| format!("Serialize failed: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, serialized.as_bytes())
        .await
        .map_err(|e| format!("Write tmp failed: {e}"))?;
    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| format!("Rename failed: {e}"))?;

    // Best-effort 0600 permissions on Unix. Windows ignores this.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(&path)
            .await
            .map_err(|e| format!("Stat failed: {e}"))?
            .permissions();
        perms.set_mode(0o600);
        let _ = tokio::fs::set_permissions(&path, perms).await;
    }

    Ok(())
}
