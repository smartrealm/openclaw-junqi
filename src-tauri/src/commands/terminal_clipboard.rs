//! Terminal clipboard assets.
//!
//! Image clipboard data is never written into a shell as base64. The desktop
//! stores it in an app-owned cache file and returns the same shell-escaped path
//! used for Finder file drops. This is the useful form for OpenClaw agents.

use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const MAX_IMAGE_BYTES: usize = 12 * 1024 * 1024;
const MAX_CACHE_FILES: usize = 96;
const MAX_CACHE_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

fn extension_for_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("terminal image cache path: {error}"))?
        .join("terminal-pastes");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("create terminal image cache: {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("set terminal image cache directory permissions: {error}"))?;
    }
    Ok(directory)
}

fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("set terminal image cache permissions: {error}"))?;
    }
    let _ = path;
    Ok(())
}

fn prune_cache(directory: &Path, reserve_slots: usize) {
    let now = SystemTime::now();
    let mut survivors: Vec<(SystemTime, PathBuf)> = Vec::new();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) if metadata.is_file() => metadata,
            _ => continue,
        };
        let modified = metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let expired = now
            .duration_since(modified)
            .map(|age| age > MAX_CACHE_AGE)
            .unwrap_or(false);
        if expired {
            let _ = fs::remove_file(path);
        } else {
            survivors.push((modified, path));
        }
    }

    survivors.sort_by_key(|(modified, _)| *modified);
    let excess = survivors
        .len()
        .saturating_add(reserve_slots)
        .saturating_sub(MAX_CACHE_FILES);
    for (_, path) in survivors.into_iter().take(excess) {
        let _ = fs::remove_file(path);
    }
}

fn write_image_atomically(
    directory: &Path,
    extension: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    let name = format!("clipboard-{}.{}", Uuid::new_v4(), extension);
    let destination = directory.join(name);
    let temporary = directory.join(format!(".{}.tmp", Uuid::new_v4()));
    fs::write(&temporary, bytes).map_err(|error| format!("write terminal image cache: {error}"))?;
    if let Err(error) = set_private_file_permissions(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary, &destination) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("activate terminal image cache: {error}"));
    }
    Ok(destination)
}

/// Stage a clipboard image and return a shell-safe path for the interactive
/// terminal's actual shell. Inputs are constrained before decoding to prevent
/// an accidental large clipboard from exhausting memory or filling disk.
#[tauri::command]
pub fn stage_terminal_paste_image(
    app: AppHandle,
    mime_type: String,
    base64_data: String,
) -> Result<String, String> {
    let extension = extension_for_mime(&mime_type)
        .ok_or_else(|| "unsupported terminal clipboard image type".to_string())?;
    // Base64 grows by 4/3; allow only a small padding margin before decode.
    let max_encoded = MAX_IMAGE_BYTES.saturating_mul(4) / 3 + 8;
    if base64_data.is_empty() || base64_data.len() > max_encoded {
        return Err("terminal clipboard image exceeds 12 MiB".to_string());
    }
    let bytes = STANDARD
        .decode(base64_data)
        .map_err(|_| "invalid terminal clipboard image data".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err("terminal clipboard image exceeds 12 MiB".to_string());
    }

    let directory = cache_dir(&app)?;
    // Keep one slot free for the image being written below.
    prune_cache(&directory, 1);
    let path = write_image_atomically(&directory, extension, &bytes)?;
    crate::commands::terminal_drop::escaped_paths_for_current_shell(&[path])
        .ok_or_else(|| "could not format terminal clipboard image path".to_string())
}

#[cfg(test)]
mod tests {
    use super::extension_for_mime;

    #[test]
    fn accepts_only_terminal_image_types() {
        assert_eq!(extension_for_mime("image/png"), Some("png"));
        assert_eq!(extension_for_mime(" IMAGE/JPEG "), Some("jpg"));
        assert_eq!(extension_for_mime("image/svg+xml"), None);
        assert_eq!(extension_for_mime("text/plain"), None);
    }
}
