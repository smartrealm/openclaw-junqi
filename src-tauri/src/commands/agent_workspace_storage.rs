use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::SystemTime;
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
    serde_json::from_str(&raw).map_err(|parse_error| {
        let seconds = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let backup = path.with_file_name(format!("{}.corrupt-{seconds}", path.file_name().and_then(|name| name.to_str()).unwrap_or("tasks.json")));
        match fs::rename(&path, &backup) {
            Ok(()) => format!(
                "AI workspace tasks are corrupted ({parse_error}); moved to {} for manual recovery",
                backup.display()
            ),
            Err(move_error) => format!(
                "AI workspace tasks are corrupted ({parse_error}); failed to move them aside: {move_error}"
            ),
        }
    })
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
    let raw = serde_json::to_string_pretty(&tasks)
        .map_err(|error| format!("serialize AI workspace tasks: {error}"))?;
    atomic_write(&path, raw.as_bytes())
        .map_err(|error| format!("write AI workspace tasks: {error}"))
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    let unique = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    );
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("tasks.json");
    let temp = path.with_file_name(format!(".{file_name}.{unique}.tmp"));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(content)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::atomic_write;

    #[test]
    fn atomic_write_replaces_content_without_leaving_temp_files() {
        let root = std::env::temp_dir().join(format!(
            "junqi-agent-workspace-storage-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("tasks.json");

        atomic_write(&path, br#"[{"id":"one"}]"#).unwrap();
        atomic_write(&path, b"[]").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[]");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
