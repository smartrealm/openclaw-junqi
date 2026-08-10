//! Managed file operations — open, reveal, check existence, list, read
use serde::Serialize;
use std::{io::Read, path::Path};

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

/// Read file content as UTF-8 text (truncated at 512KB).
///
/// Binary files deliberately return an explicit failure rather than a fake
/// placeholder string. Callers can then offer the appropriate native preview
/// or external-open path without presenting unreadable data as content.
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
    let handle = match std::fs::File::open(p) {
        Ok(file) => file,
        Err(error) => {
            return Ok(ReadFileResult {
                success: false,
                content: None,
                byte_size,
                truncated,
                error: Some(format!("Failed to read file: {error}")),
            })
        }
    };
    let mut bytes = Vec::with_capacity((byte_size.min(max_bytes)) as usize);
    if let Err(error) = handle.take(max_bytes).read_to_end(&mut bytes) {
        return Ok(ReadFileResult {
            success: false,
            content: None,
            byte_size,
            truncated,
            error: Some(format!("Failed to read file: {error}")),
        });
    }

    let content = match std::str::from_utf8(&bytes) {
        Ok(value) => value.to_owned(),
        Err(error) if truncated && error.error_len().is_none() => {
            // The 512KB cap may land inside a multi-byte UTF-8 character.
            std::str::from_utf8(&bytes[..error.valid_up_to()])
                .unwrap_or_default()
                .to_owned()
        }
        Err(_) => {
            return Ok(ReadFileResult {
                success: false,
                content: None,
                byte_size,
                truncated,
                error: Some("The file is not valid UTF-8 text".to_string()),
            })
        }
    };

    Ok(ReadFileResult {
        success: true,
        content: Some(content),
        byte_size,
        truncated,
        error: None,
    })
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
