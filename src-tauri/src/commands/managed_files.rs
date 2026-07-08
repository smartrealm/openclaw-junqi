//! Managed file operations — open, reveal, check existence, list, read
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

#[derive(Debug, Serialize)]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct ListDirResult {
    pub success: bool,
    pub entries: Vec<DirEntry>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ReadFileResult {
    pub success: bool,
    pub content: Option<String>,
    pub byte_size: u64,
    pub truncated: bool,
    pub error: Option<String>,
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
    Ok(ExistsResult {
        success: true,
        exists,
    })
}

/// List directory entries.
#[tauri::command]
pub async fn list_directory(path: String) -> Result<ListDirResult, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Ok(ListDirResult {
            success: false,
            entries: vec![],
            error: Some(format!("Not a directory: {}", path)),
        });
    }
    match std::fs::read_dir(dir) {
        Ok(read_dir) => {
            let mut entries: Vec<DirEntry> = Vec::new();
            for entry in read_dir.flatten() {
                let meta = entry.metadata().ok();
                let (is_dir, size) = match meta {
                    Some(m) => (m.is_dir(), m.len()),
                    None => (false, 0),
                };
                entries.push(DirEntry {
                    name: entry.file_name().to_string_lossy().to_string(),
                    is_dir,
                    size,
                });
            }
            entries.sort_by(|a, b| {
                if a.is_dir != b.is_dir {
                    return if a.is_dir {
                        std::cmp::Ordering::Less
                    } else {
                        std::cmp::Ordering::Greater
                    };
                }
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            });
            Ok(ListDirResult {
                success: true,
                entries,
                error: None,
            })
        }
        Err(e) => Ok(ListDirResult {
            success: false,
            entries: vec![],
            error: Some(format!("Failed to read directory: {}", e)),
        }),
    }
}

/// Read file content as UTF-8 text (truncated at 512KB).
#[tauri::command]
pub async fn read_file_text(path: String) -> Result<ReadFileResult, String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Ok(ReadFileResult {
            success: false,
            content: None,
            byte_size: 0,
            truncated: false,
            error: Some(format!("Not a file: {}", path)),
        });
    }
    let meta = p
        .metadata()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;
    let byte_size = meta.len();
    let max_bytes = 512 * 1024;
    let truncated = byte_size > max_bytes;
    let read_size = if truncated {
        max_bytes as usize
    } else {
        byte_size as usize
    };
    match std::fs::read_to_string(p) {
        Ok(full) => {
            let content = if truncated {
                full.chars().take(read_size).collect()
            } else {
                full
            };
            Ok(ReadFileResult {
                success: true,
                content: Some(content),
                byte_size,
                truncated,
                error: None,
            })
        }
        Err(_) => {
            let preview = format!(
                "[Binary file — {} bytes, cannot preview as text]",
                byte_size
            );
            Ok(ReadFileResult {
                success: true,
                content: Some(preview),
                byte_size,
                truncated,
                error: None,
            })
        }
    }
}

/// Reveal a file in Finder (macOS) / File Explorer.
#[tauri::command]
pub async fn managed_file_reveal(path: String) -> Result<RevealResult, String> {
    let p = Path::new(&path);
    let target = if p.is_file() || !p.exists() {
        p.parent()
            .map(|parent| parent.to_path_buf())
            .unwrap_or(p.to_path_buf())
    } else {
        p.to_path_buf()
    };
    open::that(target.to_str().unwrap_or(&path)).map_err(|e| format!("Failed to reveal: {}", e))?;
    Ok(RevealResult { success: true })
}
