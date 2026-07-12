use serde_json::Value;
use std::fs;
use tauri::{AppHandle, Manager};

fn project_key(project_id: &str) -> Result<String, String> {
    let trimmed = project_id.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        return Err("invalid AI workspace project id".to_string());
    }
    Ok(trimmed
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn tasks_path(app: &AppHandle, project_id: &str) -> Result<std::path::PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve AI workspace data directory: {error}"))?
        .join("agent-workspace")
        .join("projects");
    Ok(root.join(format!("{}.json", project_key(project_id)?)))
}

#[tauri::command]
pub fn load_agent_workspace_tasks(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<Value>, String> {
    let path = tasks_path(&app, &project_id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw =
        fs::read_to_string(&path).map_err(|error| format!("read AI workspace tasks: {error}"))?;
    serde_json::from_str(&raw).map_err(|error| format!("parse AI workspace tasks: {error}"))
}

#[tauri::command]
pub fn save_agent_workspace_tasks(
    app: AppHandle,
    project_id: String,
    tasks: Vec<Value>,
) -> Result<(), String> {
    let path = tasks_path(&app, &project_id)?;
    let parent = path.parent().ok_or("invalid AI workspace tasks path")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create AI workspace task directory: {error}"))?;
    if tasks.is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|error| format!("remove AI workspace tasks: {error}"))?;
        }
        return Ok(());
    }
    let raw = serde_json::to_string_pretty(&tasks)
        .map_err(|error| format!("serialize AI workspace tasks: {error}"))?;
    let temp = parent.join(format!(
        ".tasks-{}-{}.tmp",
        std::process::id(),
        project_key(&project_id)?
    ));
    fs::write(&temp, raw).map_err(|error| format!("write AI workspace tasks: {error}"))?;
    fs::rename(&temp, &path).map_err(|error| format!("activate AI workspace tasks: {error}"))
}
