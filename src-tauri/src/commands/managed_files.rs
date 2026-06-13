//! Managed file operations — open, reveal, check existence
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct OpenResult {
    pub success: bool,
}

#[derive(Debug, Serialize)]
pub struct ExistsResult {
    pub success: bool,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
pub struct RevealResult {
    pub success: bool,
}

/// Open a file with the default OS application.
#[tauri::command]
pub async fn managed_file_open(path: String) -> Result<OpenResult, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Ok(OpenResult { success: false });
    }
    open::that(&path).map_err(|e| format!("Failed to open: {}", e))?;
    Ok(OpenResult { success: true })
}

/// Check if a file exists.
#[tauri::command]
pub async fn managed_file_exists(path: String) -> Result<ExistsResult, String> {
    let exists = Path::new(&path).exists();
    Ok(ExistsResult { success: true, exists })
}

/// Reveal a file in Finder (macOS) / File Explorer.
#[tauri::command]
pub async fn managed_file_reveal(path: String) -> Result<RevealResult, String> {
    let p = Path::new(&path);
    let target = if p.is_file() || !p.exists() {
        p.parent().map(|parent| parent.to_path_buf()).unwrap_or(p.to_path_buf())
    } else {
        p.to_path_buf()
    };
    open::that(target.to_str().unwrap_or(&path))
        .map_err(|e| format!("Failed to reveal: {}", e))?;
    Ok(RevealResult { success: true })
}
