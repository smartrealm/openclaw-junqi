use super::{WorkbenchSessionLoadResult, WorkbenchSessionSaveResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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
    Ok(format!("{:x}", Sha256::digest(payload_bytes(payload)?)))
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
    if payload_hash(&envelope.payload)? != envelope.payload_hash {
        return Err("workbench session payload hash mismatch".into());
    }
    Ok(envelope)
}

pub(super) fn backup_path(path: &Path, slot: u64) -> PathBuf {
    path.with_extension(format!("backup-{slot}.json"))
}

fn rotate_backup(path: &Path, generation: u64) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let backup = backup_path(path, generation % BACKUP_SLOTS);
    if backup.exists() {
        fs::remove_file(&backup).map_err(|error| format!("remove workbench backup: {error}"))?;
    }
    fs::copy(path, &backup).map_err(|error| format!("backup workbench session: {error}"))?;
    fs::OpenOptions::new()
        .write(true)
        .open(&backup)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("sync workbench backup: {error}"))
}

#[cfg(unix)]
fn sync_parent_metadata(path: &Path) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid workbench session path")?;
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("sync workbench session directory: {error}"))
}

#[cfg(not(unix))]
fn sync_parent_metadata(path: &Path) -> Result<(), String> {
    // Windows does not document FlushFileBuffers for directory handles. The
    // file is already flushed before its write-through replacement.
    path.parent()
        .ok_or_else(|| "invalid workbench session path".to_string())
        .map(|_| ())
}

#[cfg(not(windows))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("replace workbench session: {error}"))
}

#[cfg(windows)]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let temporary: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let moved = unsafe {
        MoveFileExW(
            temporary.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(format!(
            "replace workbench session: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
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
        sync_parent_metadata(path)
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

pub(super) fn load(path: &Path) -> Result<WorkbenchSessionLoadResult, String> {
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
        Err(primary_error) => recover_from_backup(path, primary_error),
    }
}

fn recover_from_backup(
    path: &Path,
    primary_error: String,
) -> Result<WorkbenchSessionLoadResult, String> {
    let recovered = (0..BACKUP_SLOTS)
        .filter_map(|slot| read_envelope(&backup_path(path, slot)).ok())
        .max_by_key(|envelope| envelope.generation);
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

pub(super) fn reset(path: &Path) -> Result<bool, String> {
    let mut sources = Vec::new();
    if path.exists() {
        sources.push(path.to_path_buf());
    }
    for slot in 0..BACKUP_SLOTS {
        let backup = backup_path(path, slot);
        if backup.exists() {
            sources.push(backup);
        }
    }
    if sources.is_empty() {
        return Ok(false);
    }
    validate_recovery_sources(&sources)?;
    archive_recovery_sources(path, sources)?;
    sync_parent_metadata(path)?;
    Ok(true)
}

fn validate_recovery_sources(sources: &[PathBuf]) -> Result<(), String> {
    for source in sources {
        let metadata = fs::symlink_metadata(source)
            .map_err(|error| format!("inspect workbench recovery source: {error}"))?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("workbench recovery source must be a regular file".into());
        }
    }
    Ok(())
}

fn archive_recovery_sources(path: &Path, sources: Vec<PathBuf>) -> Result<(), String> {
    let parent = path.parent().ok_or("invalid workbench session path")?;
    let recovery = parent.join(format!("recovery-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&recovery)
        .map_err(|error| format!("create workbench recovery directory: {error}"))?;
    let mut moved: Vec<(PathBuf, PathBuf)> = Vec::new();
    for source in sources {
        let name = source
            .file_name()
            .ok_or("invalid workbench recovery source")?;
        let destination = recovery.join(name);
        let move_result = fs::rename(&source, &destination)
            .map_err(|error| format!("archive workbench session {}: {error}", source.display()));
        if let Err(error) = move_result {
            return rollback_recovery(error, &recovery, moved);
        }
        moved.push((source, destination));
    }
    Ok(())
}

fn rollback_recovery(
    error: String,
    recovery: &Path,
    moved: Vec<(PathBuf, PathBuf)>,
) -> Result<(), String> {
    let rollback_errors: Vec<String> = moved
        .into_iter()
        .rev()
        .filter_map(|(original, archived)| {
            fs::rename(&archived, &original)
                .err()
                .map(|rollback| format!("{}: {rollback}", original.display()))
        })
        .collect();
    if rollback_errors.is_empty() {
        let _ = fs::remove_dir(recovery);
        Err(error)
    } else {
        Err(format!(
            "{error}; recovery rollback incomplete at {}: {}",
            recovery.display(),
            rollback_errors.join("; ")
        ))
    }
}

pub(super) fn save(
    path: &Path,
    expected_generation: u64,
    payload: Value,
) -> Result<WorkbenchSessionSaveResult, String> {
    let hash = payload_hash(&payload)?;
    let current = path.exists().then(|| read_envelope(path)).transpose()?;
    let current_generation = current.as_ref().map_or(0, |value| value.generation);
    if current_generation != expected_generation {
        return Err(format!(
            "workbench session generation conflict: expected {expected_generation}, current {current_generation}"
        ));
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
