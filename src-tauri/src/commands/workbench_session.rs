use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

mod storage;

#[cfg(test)]
mod storage_tests;

fn session_operation_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
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

fn session_path(app: &AppHandle, partition_id: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve workbench session directory: {error}"))?
        .join("workbench")
        .join("sessions");
    Ok(root.join(format!("{}.json", partition_key(partition_id)?)))
}

#[tauri::command]
pub fn load_workbench_session(
    app: AppHandle,
    partition_id: String,
) -> Result<WorkbenchSessionLoadResult, String> {
    let _operation = session_operation_gate()
        .lock()
        .map_err(|_| "workbench session operation lock poisoned".to_string())?;
    storage::load(&session_path(&app, &partition_id)?)
}

#[tauri::command]
pub fn save_workbench_session(
    app: AppHandle,
    partition_id: String,
    expected_generation: u64,
    payload: Value,
) -> Result<WorkbenchSessionSaveResult, String> {
    let _operation = session_operation_gate()
        .lock()
        .map_err(|_| "workbench session operation lock poisoned".to_string())?;
    storage::save(
        &session_path(&app, &partition_id)?,
        expected_generation,
        payload,
    )
}

#[tauri::command]
pub fn reset_workbench_session(app: AppHandle, partition_id: String) -> Result<bool, String> {
    let _operation = session_operation_gate()
        .lock()
        .map_err(|_| "workbench session operation lock poisoned".to_string())?;
    storage::reset(&session_path(&app, &partition_id)?)
}
