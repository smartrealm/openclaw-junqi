//! One-time migration support for the deprecated local session-label mirror.
//!
//! OpenClaw now persists session labels through `sessions.patch`. Older JunQi
//! builds also wrote `~/.openclaw/session-labels.json`; this module exposes the
//! file only as a migration source. It never creates or updates live labels.
//!
//! The renderer reads the legacy map after connecting, migrates each accepted
//! entry through the Gateway, then calls `remove_legacy_session_labels` with
//! only the keys the Gateway confirmed. Failed entries remain for a later
//! migration attempt.

use serde_json::{json, Map, Value};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

const LEGACY_LABELS_FILE: &str = "session-labels.json";

fn legacy_labels_path() -> PathBuf {
    crate::paths::desktop_dir().join(LEGACY_LABELS_FILE)
}

fn legacy_labels_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn read_legacy_labels_at(path: &Path) -> Result<Value, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(json!({})),
        Err(error) => return Err(format!("read legacy session labels: {error}")),
    };

    let document: Value = match serde_json::from_slice(&bytes) {
        Ok(document) => document,
        // Keep malformed files on disk for recovery. Returning an empty map
        // prevents a legacy artifact from blocking application startup.
        Err(_) => return Ok(json!({})),
    };
    let Some(entries) = document.as_object() else {
        return Ok(json!({}));
    };

    let mut labels = Map::new();
    for (key, value) in entries {
        let Some(label) = value.as_str() else {
            continue;
        };
        let key = key.trim();
        let label = label.trim();
        if !key.is_empty() && !label.is_empty() {
            labels.insert(key.to_string(), Value::String(label.to_string()));
        }
    }
    Ok(Value::Object(labels))
}

#[cfg(not(windows))]
fn replace_written_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn replace_written_file(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    replace_written_file_with_backup(temporary, destination)
}

/// Windows cannot reliably rename a file over an existing destination. Move
/// the old migration file aside first and restore it if installing the new
/// file fails. The caller holds `legacy_labels_lock` for the whole mutation.
#[cfg(any(windows, test))]
fn replace_written_file_with_backup(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    if !destination.exists() {
        return fs::rename(temporary, destination);
    }

    let parent = destination.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "legacy session labels path has no parent",
        )
    })?;
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(LEGACY_LABELS_FILE);
    let backup = parent.join(format!(".{file_name}.{}.backup", uuid::Uuid::new_v4()));

    fs::rename(destination, &backup)?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = fs::remove_file(backup);
            Ok(())
        }
        Err(replace_error) => match fs::rename(&backup, destination) {
            Ok(()) => Err(replace_error),
            Err(rollback_error) => Err(std::io::Error::new(
                replace_error.kind(),
                format!(
                    "{replace_error}; restoring previous legacy labels from {} failed: {rollback_error}",
                    backup.display()
                ),
            )),
        },
    }
}

fn set_private_permissions(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

fn write_legacy_document(path: &Path, document: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "legacy session labels path has no parent".to_string())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(LEGACY_LABELS_FILE);
    let temporary = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));
    let serialized = serde_json::to_vec_pretty(document)
        .map_err(|error| format!("serialize legacy session labels: {error}"))?;

    if let Err(error) = fs::write(&temporary, serialized) {
        return Err(format!("write legacy session labels: {error}"));
    }
    if let Err(error) = replace_written_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("replace legacy session labels: {error}"));
    }
    set_private_permissions(path);
    Ok(())
}

fn remove_legacy_labels_at(path: &Path, keys: &[String]) -> Result<(), String> {
    let keys: HashSet<&str> = keys
        .iter()
        .map(String::as_str)
        .filter(|key| !key.trim().is_empty())
        .collect();
    if keys.is_empty() {
        return Ok(());
    }

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("read legacy session labels: {error}")),
    };
    let mut document: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("parse legacy session labels: {error}"))?;
    let entries = document
        .as_object_mut()
        .ok_or_else(|| "legacy session labels must be a JSON object".to_string())?;

    let original_len = entries.len();
    entries.retain(|key, _| !keys.contains(key.as_str()) && !keys.contains(key.trim()));
    if entries.len() == original_len {
        return Ok(());
    }

    if entries.is_empty() {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!("remove migrated legacy session labels: {error}")),
        }
    } else {
        write_legacy_document(path, &document)
    }
}

/// Load valid user labels from the deprecated local mirror. This is intended
/// exclusively for the one-time Gateway migration; it is not a live cache.
#[tauri::command]
pub async fn load_legacy_session_labels() -> Result<Value, String> {
    let path = legacy_labels_path();
    tokio::task::spawn_blocking(move || {
        let _guard = legacy_labels_lock()
            .lock()
            .map_err(|_| "legacy session labels lock poisoned".to_string())?;
        read_legacy_labels_at(&path)
    })
    .await
    .map_err(|error| format!("load legacy session labels task failed: {error}"))?
}

/// Remove only labels that OpenClaw has already accepted. A failed or offline
/// Gateway migration must omit its key so it remains recoverable on next boot.
#[tauri::command]
pub async fn remove_legacy_session_labels(keys: Vec<String>) -> Result<(), String> {
    let path = legacy_labels_path();
    tokio::task::spawn_blocking(move || {
        let _guard = legacy_labels_lock()
            .lock()
            .map_err(|_| "legacy session labels lock poisoned".to_string())?;
        remove_legacy_labels_at(&path, &keys)
    })
    .await
    .map_err(|error| format!("remove legacy session labels task failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{read_legacy_labels_at, remove_legacy_labels_at, replace_written_file_with_backup};
    use serde_json::json;
    use std::{fs, path::PathBuf};

    fn scratch_directory(label: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "junqi-legacy-session-labels-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn loader_returns_only_valid_nonempty_label_entries() {
        let directory = scratch_directory("load");
        let path = directory.join("session-labels.json");
        fs::write(
            &path,
            r#"{
              "agent:main:a": "  Alpha  ",
              "agent:main:b": "   ",
              "agent:main:c": 42,
              "": "No key"
            }"#,
        )
        .unwrap();

        assert_eq!(
            read_legacy_labels_at(&path).unwrap(),
            json!({ "agent:main:a": "Alpha" })
        );
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn removal_keeps_unconfirmed_keys_and_deletes_the_file_when_empty() {
        let directory = scratch_directory("remove");
        let path = directory.join("session-labels.json");
        fs::write(&path, r#"{"agent:main:a":"Alpha","agent:main:b":"Beta"}"#).unwrap();

        remove_legacy_labels_at(&path, &["agent:main:a".to_string()]).unwrap();
        assert_eq!(
            read_legacy_labels_at(&path).unwrap(),
            json!({ "agent:main:b": "Beta" })
        );

        remove_legacy_labels_at(&path, &["agent:main:b".to_string()]).unwrap();
        assert!(!path.exists());
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn backup_replacement_overwrites_existing_legacy_file() {
        let directory = scratch_directory("replace");
        let destination = directory.join("session-labels.json");
        let temporary = directory.join("session-labels.json.tmp");
        fs::write(&destination, "old").unwrap();
        fs::write(&temporary, "new").unwrap();

        replace_written_file_with_backup(&temporary, &destination).unwrap();

        assert_eq!(fs::read_to_string(&destination).unwrap(), "new");
        assert!(!temporary.exists());
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        let _ = fs::remove_dir_all(directory);
    }
}
