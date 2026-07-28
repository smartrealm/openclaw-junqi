use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const SCHEMA_VERSION: u32 = 1;
const MAX_SESSION_BYTES: usize = 8 * 1024 * 1024;
const BACKUP_SLOTS: u64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionEnvelope {
    schema_version: u32,
    generation: u64,
    payload_hash: String,
    payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSessionLoadResult {
    found: bool,
    recovered: bool,
    generation: u64,
    payload_hash: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSessionSaveResult {
    generation: u64,
    payload_hash: String,
    unchanged: bool,
}

fn partition_key(partition_id: &str) -> Result<String, String> {
    let value = partition_id.trim();
    if value.is_empty() || value.len() > 512 {
        return Err("invalid workbench session partition".into());
    }
    Ok(value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn session_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve workbench session directory: {error}"))?
        .join("workbench")
        .join("sessions"))
}

fn session_path(app: &AppHandle, partition_id: &str) -> Result<PathBuf, String> {
    Ok(session_root(app)?.join(format!("{}.json", partition_key(partition_id)?)))
}

fn payload_bytes(payload: &Value) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(payload)
        .map_err(|error| format!("serialize workbench session: {error}"))?;
    if bytes.len() > MAX_SESSION_BYTES {
        return Err(format!(
            "workbench session exceeds {MAX_SESSION_BYTES} bytes"
        ));
    }
    Ok(bytes)
}

fn payload_hash(payload: &Value) -> Result<String, String> {
    let bytes = payload_bytes(payload)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn read_envelope(path: &Path) -> Result<SessionEnvelope, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("inspect workbench session {}: {error}", path.display()))?;
    if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
        return Err("workbench session must be a regular file".into());
    }
    if metadata.len() as usize > MAX_SESSION_BYTES + 64 * 1024 {
        return Err("workbench session file is oversized".into());
    }
    let raw = fs::read(path).map_err(|error| format!("read workbench session: {error}"))?;
    let envelope: SessionEnvelope = serde_json::from_slice(&raw)
        .map_err(|error| format!("parse workbench session: {error}"))?;
    if envelope.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported workbench session schema {}",
            envelope.schema_version
        ));
    }
    let actual_hash = payload_hash(&envelope.payload)?;
    if actual_hash != envelope.payload_hash {
        return Err("workbench session payload hash mismatch".into());
    }
    Ok(envelope)
}

fn backup_path(path: &Path, slot: u64) -> PathBuf {
    path.with_extension(format!("backup-{slot}.json"))
}

fn rotate_backup(path: &Path, generation: u64) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let slot = generation % BACKUP_SLOTS;
    let backup = backup_path(path, slot);
    if backup.exists() {
        fs::remove_file(&backup).map_err(|error| format!("remove workbench backup: {error}"))?;
    }
    fs::copy(path, &backup).map_err(|error| format!("backup workbench session: {error}"))?;
    let file =
        fs::File::open(&backup).map_err(|error| format!("open workbench backup: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("sync workbench backup: {error}"))
}

fn sync_parent(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid workbench session path")?;
    let directory = fs::File::open(parent)
        .map_err(|error| format!("open workbench session directory: {error}"))?;
    directory
        .sync_all()
        .map_err(|error| format!("sync workbench session directory: {error}"))
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("replace workbench session: {error}"))
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|error| format!("replace workbench session: {error}"));
    }
    let parent = destination
        .parent()
        .ok_or("invalid workbench session path")?;
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("session.json");
    let previous = parent.join(format!(".{name}.{}.replace", uuid::Uuid::new_v4()));
    fs::rename(destination, &previous)
        .map_err(|error| format!("stage previous workbench session: {error}"))?;
    match fs::rename(temporary, destination) {
        Ok(()) => {
            let _ = fs::remove_file(previous);
            Ok(())
        }
        Err(error) => match fs::rename(&previous, destination) {
            Ok(()) => Err(format!("replace workbench session: {error}")),
            Err(rollback) => Err(format!(
                "replace workbench session: {error}; restore previous session {}: {rollback}",
                previous.display()
            )),
        },
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid workbench session path")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create workbench session directory: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("session.json");
    let temporary = parent.join(format!(".{name}.{}-{nonce}.tmp", std::process::id()));
    let result = (|| -> Result<(), String> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("create workbench session temporary file: {error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("write workbench session: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("sync workbench session: {error}"))?;
        replace_file(&temporary, path)?;
        sync_parent(path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn quarantine_corrupt(path: &Path) {
    if !path.exists() {
        return;
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("session.json");
    let corrupt = path.with_file_name(format!("{name}.corrupt-{seconds}"));
    let _ = fs::rename(path, corrupt);
}

fn load_at(path: &Path) -> Result<WorkbenchSessionLoadResult, String> {
    if !path.exists() {
        return Ok(WorkbenchSessionLoadResult {
            found: false,
            recovered: false,
            generation: 0,
            payload_hash: None,
            payload: None,
        });
    }
    match read_envelope(path) {
        Ok(envelope) => Ok(WorkbenchSessionLoadResult {
            found: true,
            recovered: false,
            generation: envelope.generation,
            payload_hash: Some(envelope.payload_hash),
            payload: Some(envelope.payload),
        }),
        Err(primary_error) => {
            let mut recovered: Option<SessionEnvelope> = None;
            for slot in 0..BACKUP_SLOTS {
                let candidate = backup_path(path, slot);
                if let Ok(envelope) = read_envelope(&candidate) {
                    if recovered
                        .as_ref()
                        .is_none_or(|current| envelope.generation > current.generation)
                    {
                        recovered = Some(envelope);
                    }
                }
            }
            let Some(envelope) = recovered else {
                quarantine_corrupt(path);
                return Err(format!(
                    "workbench session is corrupted and no valid backup exists: {primary_error}"
                ));
            };
            quarantine_corrupt(path);
            let raw = serde_json::to_vec_pretty(&envelope).map_err(|error| error.to_string())?;
            atomic_write(path, &raw)?;
            Ok(WorkbenchSessionLoadResult {
                found: true,
                recovered: true,
                generation: envelope.generation,
                payload_hash: Some(envelope.payload_hash),
                payload: Some(envelope.payload),
            })
        }
    }
}

fn save_at(
    path: &Path,
    expected_generation: u64,
    payload: Value,
) -> Result<WorkbenchSessionSaveResult, String> {
    let hash = payload_hash(&payload)?;
    let current = if path.exists() {
        Some(read_envelope(path)?)
    } else {
        None
    };
    let current_generation = current.as_ref().map_or(0, |value| value.generation);
    if current_generation != expected_generation {
        return Err(format!("workbench session generation conflict: expected {expected_generation}, current {current_generation}"));
    }
    if current
        .as_ref()
        .is_some_and(|value| value.payload_hash == hash)
    {
        return Ok(WorkbenchSessionSaveResult {
            generation: current_generation,
            payload_hash: hash,
            unchanged: true,
        });
    }
    let generation = current_generation
        .checked_add(1)
        .ok_or("workbench session generation overflow")?;
    rotate_backup(path, generation)?;
    let envelope = SessionEnvelope {
        schema_version: SCHEMA_VERSION,
        generation,
        payload_hash: hash.clone(),
        payload,
    };
    let raw = serde_json::to_vec_pretty(&envelope)
        .map_err(|error| format!("serialize workbench envelope: {error}"))?;
    atomic_write(path, &raw)?;
    Ok(WorkbenchSessionSaveResult {
        generation,
        payload_hash: hash,
        unchanged: false,
    })
}

#[tauri::command]
pub fn load_workbench_session(
    app: AppHandle,
    partition_id: String,
) -> Result<WorkbenchSessionLoadResult, String> {
    load_at(&session_path(&app, &partition_id)?)
}

#[tauri::command]
pub fn save_workbench_session(
    app: AppHandle,
    partition_id: String,
    expected_generation: u64,
    payload: Value,
) -> Result<WorkbenchSessionSaveResult, String> {
    save_at(
        &session_path(&app, &partition_id)?,
        expected_generation,
        payload,
    )
}

#[cfg(test)]
mod tests {
    use super::{backup_path, load_at, save_at};
    use serde_json::json;

    fn root(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-workbench-session-{name}-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn generation_and_hash_noop_are_enforced() {
        let root = root("generation");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("session.json");
        let first = save_at(&path, 0, json!({"active":"a"})).unwrap();
        assert_eq!(first.generation, 1);
        assert!(!first.unchanged);
        let noop = save_at(&path, 1, json!({"active":"a"})).unwrap();
        assert_eq!(noop.generation, 1);
        assert!(noop.unchanged);
        assert!(save_at(&path, 0, json!({"active":"b"}))
            .unwrap_err()
            .contains("generation conflict"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupted_primary_recovers_the_newest_valid_backup() {
        let root = root("recovery");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("session.json");
        save_at(&path, 0, json!({"value":1})).unwrap();
        save_at(&path, 1, json!({"value":2})).unwrap();
        assert!(backup_path(&path, 2).exists());
        std::fs::write(&path, b"broken").unwrap();
        let loaded = load_at(&path).unwrap();
        assert!(loaded.recovered);
        assert_eq!(loaded.generation, 1);
        assert_eq!(loaded.payload.unwrap(), json!({"value":1}));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn writes_replace_existing_content_and_leave_no_temporary_files() {
        let root = root("atomic");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("session.json");
        save_at(&path, 0, json!({"value":1})).unwrap();
        save_at(&path, 1, json!({"value":2})).unwrap();
        assert_eq!(load_at(&path).unwrap().payload.unwrap(), json!({"value":2}));
        assert!(std::fs::read_dir(&root).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
        std::fs::remove_dir_all(root).unwrap();
    }
}
