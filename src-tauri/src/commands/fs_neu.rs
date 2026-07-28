//! File-system commands ported from the junqi subsystem.
//!
//! Adapted crate references:
//!   crate::junqi::subprocess::configure_background_command
//!     → crate::platform::suppress_console_window
//!
//! Provides: read_dir_entries, read_file_preview,
//! write_file_content, write_file_content_if_unchanged, create_file,
//! create_directory, rename_path, delete_path,
//! open_in_system_file_manager, list_project_files, search_project_files.

use base64::Engine;
use std::path::Path;
use std::process::Command;

#[derive(serde::Serialize)]
pub(crate) struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_symlink: bool,
    extension: Option<String>,
    is_gitignored: bool,
}

#[derive(serde::Serialize)]
pub(crate) struct ProjectFileSearchResult {
    path: String,
    name: String,
    dir: String,
    extension: Option<String>,
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreviewData {
    kind: FilePreviewKind,
    text: Option<String>,
    base64: Option<String>,
    mime_type: Option<String>,
    byte_length: u64,
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum FilePreviewKind {
    Text,
    Image,
    Pdf,
    Binary,
}

const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    ".next",
    ".nuxt",
    "dist",
    "build",
    "target",
    "__pycache__",
    ".cache",
    "coverage",
    ".turbo",
    ".expo",
    "out",
    ".output",
    ".venv",
    "venv",
    ".tox",
];

const MAX_TEXT_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const MAX_BINARY_PREVIEW_BYTES: u64 = 10 * 1024 * 1024;
const MAX_FILE_SEARCH_RESULTS: usize = 200;

/// Validate that `target` is an absolute path within `allowed_root` (prevents directory traversal).
///
/// When `allow_symlink_escape` is false, the target is fully canonicalized and
/// must land inside the root — symlinks pointing outside the project are rejected
/// (use this for writes, so a planted symlink can't clobber external files).
///
/// When true, a symlink whose *location* is inside the project but whose target
/// is outside is also accepted (e.g. a symlinked CLAUDE.md / AGENTS.md). `../`
/// traversal in the path itself stays rejected in both modes.
pub(crate) fn validate_path_within(
    target: &str,
    allowed_root: &str,
    allow_symlink_escape: bool,
) -> Result<std::path::PathBuf, String> {
    let target_path = Path::new(target);

    if !target_path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let canonical_root = Path::new(allowed_root)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve root directory: {}", e))?;

    // Fast path: fully resolve the target (following symlinks). If it still lands
    // inside the project root, accept it as-is.
    if let Ok(canonical_target) = target_path.canonicalize() {
        if canonical_target.starts_with(&canonical_root) {
            return Ok(canonical_target);
        }
    }

    if !allow_symlink_escape {
        return Err("Path is outside the allowed directory".to_string());
    }

    // Fall back to validating the *location* of the path: canonicalize only the
    // parent directory (which resolves intermediate symlinks and `..` segments,
    // so directory traversal is still rejected) and keep the final component
    // un-resolved. This lets symlinks that live inside the project but point
    // outside it — e.g. a symlinked CLAUDE.md / AGENTS.md — remain readable.
    let file_name = target_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;
    let parent = target_path
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve path: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path is outside the allowed directory".to_string());
    }

    Ok(canonical_parent.join(file_name))
}

fn validate_project_root(project_path: &str) -> Result<std::path::PathBuf, String> {
    let path = Path::new(project_path);
    if !path.is_absolute() {
        return Err("Project path must be absolute".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Cannot resolve project path: {}", e))?;
    if !canonical.is_dir() {
        return Err("Project path is not a directory".to_string());
    }
    Ok(canonical)
}

pub(crate) fn is_filesystem_link(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn git_check_ignore_input_path(path: &str) -> String {
    #[cfg(windows)]
    {
        if path
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
        {
            return format!(r"\\{}", path.get(8..).unwrap_or_default());
        }
        if let Some(path) = path.strip_prefix(r"\\?\") {
            return path.to_string();
        }
    }
    path.to_string()
}

fn git_check_ignore_key(path: &str) -> String {
    let path = git_check_ignore_input_path(path);
    #[cfg(windows)]
    {
        return path.replace('\\', "/").to_ascii_lowercase();
    }
    #[cfg(not(windows))]
    path
}

fn parse_git_check_ignore_z(stdout: &[u8]) -> std::collections::HashSet<String> {
    stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| git_check_ignore_key(&String::from_utf8_lossy(path)))
        .collect()
}

/// Names whose stem (the substring before the first `.`) are reserved on Windows.
#[cfg(target_os = "windows")]
const WINDOWS_RESERVED_STEMS: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Validate a single path component that the user wants to create.
fn validate_entry_name(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("File name cannot be empty".to_string());
    }
    if name.len() > 255 {
        return Err("File name is too long (max 255 bytes)".to_string());
    }
    if name == "." || name == ".." {
        return Err("Invalid file name".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err("File name contains forbidden characters".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        for ch in name.chars() {
            if matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*') {
                return Err("File name contains forbidden characters".to_string());
            }
            if (ch as u32) < 0x20 {
                return Err("File name contains control characters".to_string());
            }
        }
        if name.ends_with(' ') || name.ends_with('.') {
            return Err("File name cannot end with a space or a dot".to_string());
        }
        let stem = name.split_once('.').map(|(s, _)| s).unwrap_or(name);
        if !stem.is_empty() {
            let stem_upper = stem.to_ascii_uppercase();
            if WINDOWS_RESERVED_STEMS.iter().any(|r| *r == stem_upper) {
                return Err(format!("File name '{}' is reserved on Windows", stem));
            }
        }
    }

    Ok(())
}

/// Validate a not-yet-existing `target` path. Returns the canonicalized parent directory and the
/// raw basename.
fn validate_new_path_within(
    target: &str,
    allowed_root: &str,
) -> Result<(std::path::PathBuf, String), String> {
    let target_path = Path::new(target);

    if !target_path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let file_name = target_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?
        .to_string();

    validate_entry_name(&file_name)?;

    let parent = target_path
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve parent directory: {}", e))?;
    let canonical_root = Path::new(allowed_root)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve root directory: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path is outside the allowed directory".to_string());
    }

    Ok((canonical_parent, file_name))
}

fn previewable_binary_type(path: &Path) -> Option<(FilePreviewKind, &'static str)> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some((FilePreviewKind::Image, "image/png")),
        "jpg" | "jpeg" => Some((FilePreviewKind::Image, "image/jpeg")),
        "gif" => Some((FilePreviewKind::Image, "image/gif")),
        "webp" => Some((FilePreviewKind::Image, "image/webp")),
        "bmp" => Some((FilePreviewKind::Image, "image/bmp")),
        "svg" => Some((FilePreviewKind::Image, "image/svg+xml")),
        "ico" => Some((FilePreviewKind::Image, "image/x-icon")),
        "pdf" => Some((FilePreviewKind::Pdf, "application/pdf")),
        _ => None,
    }
}

fn read_file_preview_data(path: &Path) -> Result<FilePreviewData, String> {
    use std::io::Read;

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    let binary_type = previewable_binary_type(path);
    let size_limit = if binary_type.is_some() {
        MAX_BINARY_PREVIEW_BYTES
    } else {
        MAX_TEXT_PREVIEW_BYTES
    };
    if meta.len() > size_limit {
        return Err(format!(
            "File too large ({:.1} MB; limit {:.0} MB)",
            meta.len() as f64 / 1024.0 / 1024.0,
            size_limit as f64 / 1024.0 / 1024.0,
        ));
    }

    let mut bytes = Vec::with_capacity(meta.len() as usize);
    std::io::BufReader::new(file)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;

    if let Some((kind, mime_type)) = binary_type {
        return Ok(FilePreviewData {
            kind,
            text: None,
            base64: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
            mime_type: Some(mime_type.to_string()),
            byte_length: meta.len(),
        });
    }

    match String::from_utf8(bytes) {
        Ok(text) => Ok(FilePreviewData {
            kind: FilePreviewKind::Text,
            text: Some(text),
            base64: None,
            mime_type: Some("text/plain; charset=utf-8".to_string()),
            byte_length: meta.len(),
        }),
        Err(_) => Ok(FilePreviewData {
            kind: FilePreviewKind::Binary,
            text: None,
            base64: None,
            mime_type: None,
            byte_length: meta.len(),
        }),
    }
}

// ── Tauri Commands ──────────────────────────────────────────────────────────

fn reveal_in_system_file_manager(
    path: &str,
    project_path: &str,
    allow_symlink_escape: bool,
) -> Result<(), String> {
    let target = validate_path_within(path, project_path, allow_symlink_escape)?;
    let is_dir = target.is_dir();

    #[cfg(target_os = "macos")]
    let status = {
        let mut command = Command::new("open");
        if is_dir {
            command.arg(&target);
        } else {
            command.arg("-R").arg(&target);
        }
        command.status()
    };

    #[cfg(target_os = "windows")]
    let status = {
        let mut command = Command::new("explorer");
        if is_dir {
            command.arg(&target);
        } else {
            command.arg(format!("/select,{}", target.display()));
        }
        command.status()
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let status = {
        let folder = if is_dir {
            target.as_path()
        } else {
            target
                .parent()
                .ok_or_else(|| "Cannot resolve parent directory".to_string())?
        };
        Command::new("xdg-open").arg(folder).status()
    };

    let status = status.map_err(|e| format!("Failed to launch system file manager: {}", e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("System file manager exited with status {}", status))
    }
}

#[tauri::command]
pub async fn open_in_system_file_manager(path: String, project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        reveal_in_system_file_manager(&path, &project_path, true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Reveal a terminal workspace entry in the system file manager without
/// following a workspace symlink outside of the selected workspace.
#[tauri::command]
pub async fn reveal_terminal_workspace_path(
    path: String,
    project_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        reveal_in_system_file_manager(&path, &project_path, false)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open a workspace file with the operating system's default application.
/// Unlike the global `open_folder` helper, this command keeps the target
/// inside the active terminal workspace before handing it to the OS.
#[tauri::command]
pub async fn open_path_with_system_default(
    path: String,
    project_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let target = validate_path_within(&path, &project_path, false)?;
        open::that(&target)
            .map_err(|error| format!("Failed to open path with system default: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn read_directory_entries(
    path: &str,
    project_path: &str,
    allow_symlink_escape: bool,
) -> Result<Vec<FsEntry>, String> {
    let directory = validate_path_within(path, project_path, allow_symlink_escape)?;
    let strict_root = (!allow_symlink_escape)
        .then(|| validate_project_root(project_path))
        .transpose()?;
    let entries = std::fs::read_dir(&directory).map_err(|e| e.to_string())?;
    let mut result: Vec<FsEntry> = entries
        .flatten()
        .filter(|entry| {
            let path = entry.path();
            if let Some(root) = strict_root.as_ref() {
                let Ok(resolved) = path.canonicalize() else {
                    return false;
                };
                if !resolved.starts_with(root) {
                    return false;
                }
            }
            if path.is_dir() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                !IGNORED_DIRS.contains(&name_str.as_ref())
            } else {
                true
            }
        })
        .map(|entry| {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            // Windows junctions are reparse points but not always reported by
            // FileType::is_symlink. Treat every reparse point as leaf-only so
            // a junction back to an ancestor cannot create an expandable loop.
            let is_symlink = std::fs::symlink_metadata(&path)
                .map(|metadata| is_filesystem_link(&metadata))
                .unwrap_or(false);
            // The agent file browser retains its legacy symlink traversal
            // behavior. The terminal tree treats links as leaves, matching
            // the strict boundary and making recursive link cycles impossible.
            let is_dir = path.is_dir() && (allow_symlink_escape || !is_symlink);
            let extension = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase());
            FsEntry {
                name,
                path: path.to_string_lossy().into_owned(),
                is_dir,
                is_symlink,
                extension,
                is_gitignored: false,
            }
        })
        .collect();
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    // Mark gitignored entries via `git check-ignore --stdin`.
    if !result.is_empty() {
        let ignored_set: std::collections::HashSet<String> = {
            use std::io::Write;
            let mut cmd = std::process::Command::new(crate::platform::resolve_spawn_program("git"));
            crate::platform::suppress_console_window(&mut cmd);
            cmd.args(["check-ignore", "-z", "--stdin"])
                .current_dir(project_path)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null());
            match cmd.spawn() {
                Ok(mut child) => {
                    let paths: Vec<String> = result
                        .iter()
                        .map(|entry| git_check_ignore_input_path(&entry.path))
                        .collect();
                    let writer = child.stdin.take().map(|mut stdin| {
                        std::thread::spawn(move || {
                            for path in paths {
                                if stdin.write_all(path.as_bytes()).is_err()
                                    || stdin.write_all(&[0]).is_err()
                                {
                                    break;
                                }
                            }
                        })
                    });
                    let output = child.wait_with_output();
                    if let Some(writer) = writer {
                        let _ = writer.join();
                    }
                    match output {
                        Ok(output) => parse_git_check_ignore_z(&output.stdout),
                        Err(_) => std::collections::HashSet::new(),
                    }
                }
                Err(_) => std::collections::HashSet::new(),
            }
        };
        for entry in &mut result {
            entry.is_gitignored = ignored_set.contains(&git_check_ignore_key(&entry.path));
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn read_dir_entries(path: String, project_path: String) -> Result<Vec<FsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || read_directory_entries(&path, &project_path, true))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_compact_dir_entries(
    path: String,
    project_path: String,
) -> Result<Vec<FsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let entries = read_directory_entries(&path, &project_path, true)?;
        entries
            .into_iter()
            .map(|entry| compact_directory_entry(entry, &project_path))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

fn compact_directory_entry(mut entry: FsEntry, project_path: &str) -> Result<FsEntry, String> {
    if !entry.is_dir || entry.is_gitignored {
        return Ok(entry);
    }
    let mut names = vec![entry.name.clone()];
    loop {
        let mut children = read_directory_entries(&entry.path, project_path, true)?;
        if children.len() != 1 || !children[0].is_dir || children[0].is_gitignored {
            entry.name = names.join("/");
            return Ok(entry);
        }
        let child = children.remove(0);
        names.push(child.name.clone());
        entry.path = child.path;
        entry.extension = child.extension;
        entry.is_symlink = child.is_symlink;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compact_directory_entry, git_check_ignore_key, parse_git_check_ignore_z,
        read_directory_entries, read_file_preview_data, FilePreviewKind,
    };
    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    #[test]
    fn git_check_ignore_z_preserves_unicode_and_backslashes() {
        let paths = parse_git_check_ignore_z("/tmp/项目.txt\0C:\\Work\\ignored.txt\0".as_bytes());
        assert!(paths.contains(&git_check_ignore_key("/tmp/项目.txt")));
        assert!(paths.contains(&git_check_ignore_key("C:\\Work\\ignored.txt")));
    }

    #[test]
    fn compact_directory_entry_stops_at_the_first_branch() {
        let root = std::env::temp_dir().join(format!("junqi-compact-dir-{}", uuid::Uuid::new_v4()));
        let first = root.join("src");
        let second = first.join("features");
        std::fs::create_dir_all(&second).unwrap();
        std::fs::write(second.join("index.ts"), "export {};").unwrap();
        std::fs::write(second.join("types.ts"), "export {};").unwrap();

        let entry = read_directory_entries(&root.to_string_lossy(), &root.to_string_lossy(), true)
            .unwrap()
            .remove(0);
        let compacted = compact_directory_entry(entry, &root.to_string_lossy()).unwrap();

        assert_eq!(compacted.name, "src/features");
        assert_eq!(
            std::path::Path::new(&compacted.path)
                .canonicalize()
                .unwrap(),
            second.canonicalize().unwrap(),
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn file_preview_classifies_text_previewable_binary_and_unknown_binary() {
        let root = std::env::temp_dir().join(format!("junqi-preview-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();

        let text_path = root.join("notes.mmd");
        std::fs::write(&text_path, "graph TD; A-->B\n").unwrap();
        let text = read_file_preview_data(&text_path).unwrap();
        assert_eq!(text.kind, FilePreviewKind::Text);
        assert_eq!(text.text.as_deref(), Some("graph TD; A-->B\n"));
        assert_eq!(text.base64, None);

        let pdf_path = root.join("report.PDF");
        std::fs::write(&pdf_path, b"%PDF-1.7\0").unwrap();
        let pdf = read_file_preview_data(&pdf_path).unwrap();
        assert_eq!(pdf.kind, FilePreviewKind::Pdf);
        assert_eq!(pdf.mime_type.as_deref(), Some("application/pdf"));
        assert!(pdf.base64.is_some());

        let icon_path = root.join("favicon.ico");
        std::fs::write(&icon_path, [0_u8, 0, 1, 0]).unwrap();
        let icon = read_file_preview_data(&icon_path).unwrap();
        assert_eq!(icon.kind, FilePreviewKind::Image);
        assert_eq!(icon.mime_type.as_deref(), Some("image/x-icon"));

        let archive_path = root.join("archive.bin");
        std::fs::write(&archive_path, [0xff_u8, 0xfe, 0xfd]).unwrap();
        let archive = read_file_preview_data(&archive_path).unwrap();
        assert_eq!(archive.kind, FilePreviewKind::Binary);
        assert_eq!(archive.text, None);
        assert_eq!(archive.base64, None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn git_check_ignore_normalizes_windows_verbatim_paths() {
        use super::git_check_ignore_input_path;

        assert_eq!(
            git_check_ignore_input_path(r"\\?\C:\Work\JunQi"),
            r"C:\Work\JunQi"
        );
        assert_eq!(
            git_check_ignore_input_path(r"\\?\UNC\server\share\JunQi"),
            r"\\server\share\JunQi"
        );
    }

    #[cfg(unix)]
    #[test]
    fn terminal_directory_listing_hides_external_symlink_entries() {
        let root = std::env::temp_dir().join(format!("junqi-fs-root-{}", uuid::Uuid::new_v4()));
        let outside =
            std::env::temp_dir().join(format!("junqi-fs-outside-{}", uuid::Uuid::new_v4()));
        let link = root.join("outside-link");
        let internal_dir = root.join("inside-dir");
        let internal_link = root.join("inside-link");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::create_dir_all(&internal_dir).unwrap();
        std::fs::write(root.join("inside.txt"), "inside").unwrap();
        std::fs::write(outside.join("outside.txt"), "outside").unwrap();
        symlink(&outside, &link).unwrap();
        symlink(&internal_dir, &internal_link).unwrap();

        let entries =
            read_directory_entries(&root.to_string_lossy(), &root.to_string_lossy(), false)
                .unwrap();
        assert!(entries.iter().any(|entry| entry.name == "inside.txt"));
        assert!(entries.iter().all(|entry| entry.name != "outside-link"));
        assert!(entries
            .iter()
            .any(|entry| entry.name == "inside-link" && entry.is_symlink && !entry.is_dir));
        assert!(
            read_directory_entries(&link.to_string_lossy(), &root.to_string_lossy(), false,)
                .is_err()
        );

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }

    #[cfg(windows)]
    #[test]
    fn terminal_directory_listing_keeps_junction_cycles_leaf_only() {
        let root = std::env::temp_dir().join(format!("junqi-fs-root-{}", uuid::Uuid::new_v4()));
        let junction = root.join("loop");
        std::fs::create_dir_all(&root).unwrap();
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(&root)
            .status()
            .unwrap();
        assert!(status.success(), "failed to create test junction");

        let entries =
            read_directory_entries(&root.to_string_lossy(), &root.to_string_lossy(), false)
                .unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.name == "loop" && entry.is_symlink && !entry.is_dir));

        let _ = std::fs::remove_dir(&junction);
        let _ = std::fs::remove_dir_all(root);
    }
}

/// Read terminal sidebar entries under a strict workspace boundary. This is
/// intentionally separate from the agent file browser, which can read known
/// project-local symlinks such as AGENTS.md.
#[tauri::command]
pub async fn read_terminal_workspace_dir_entries(
    path: String,
    project_path: String,
) -> Result<Vec<FsEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_directory_entries(&path, &project_path, false)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn read_file_preview(
    path: String,
    project_path: String,
) -> Result<FilePreviewData, String> {
    let validated_path = validate_path_within(&path, &project_path, true)?;
    tauri::async_runtime::spawn_blocking(move || read_file_preview_data(&validated_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_file_content(
    path: String,
    content: String,
    project_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_path_within(&path, &project_path, false)?;
        std::fs::write(&path, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn write_file_content_if_unchanged_in_workspace(
    path: &str,
    content: &str,
    expected_content: &str,
    project_path: &str,
) -> Result<bool, String> {
    use std::io::{Read, Seek, Write};

    let validated_path = validate_path_within(path, project_path, false)?;
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(validated_path)
        .map_err(|e| e.to_string())?;

    let mut current_content = String::new();
    file.read_to_string(&mut current_content)
        .map_err(|e| e.to_string())?;
    if current_content != expected_content {
        return Ok(false);
    }

    file.rewind().map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    file.set_len(content.len() as u64)
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn write_file_content_if_unchanged(
    path: String,
    content: String,
    expected_content: String,
    project_path: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        write_file_content_if_unchanged_in_workspace(
            &path,
            &content,
            &expected_content,
            &project_path,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_file(path: String, project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (parent, file_name) = validate_new_path_within(&path, &project_path)?;
        let target = parent.join(&file_name);
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map(|_| ())
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::AlreadyExists => {
                    "A file or folder with that name already exists".to_string()
                }
                _ => e.to_string(),
            })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_directory(path: String, project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (parent, file_name) = validate_new_path_within(&path, &project_path)?;
        let target = parent.join(&file_name);
        std::fs::create_dir(&target).map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => {
                "A file or folder with that name already exists".to_string()
            }
            _ => e.to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// First-segment names under the project root that are never deletable through this command.
const PROTECTED_FIRST_SEGMENTS: &[&str] = &[".git", ".junqi"];

fn protected_first_segment<'a>(path: &'a Path, root: &Path) -> Option<&'a str> {
    path.strip_prefix(root)
        .ok()?
        .components()
        .next()?
        .as_os_str()
        .to_str()
        .filter(|name| {
            PROTECTED_FIRST_SEGMENTS
                .iter()
                .any(|protected| protected.eq_ignore_ascii_case(name))
        })
}

fn rename_path_in_workspace(
    path: &str,
    new_name: &str,
    project_path: &str,
) -> Result<String, String> {
    validate_entry_name(new_name)?;

    let target_path = Path::new(path);
    if !target_path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let parent = target_path
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve parent directory: {}", e))?;
    let canonical_root = Path::new(project_path)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve root directory: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path is outside the allowed directory".to_string());
    }

    let old_name = target_path
        .file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;
    let source = canonical_parent.join(old_name);
    if source == canonical_root {
        return Err("Cannot rename the project root".to_string());
    }
    if source.symlink_metadata().is_err() {
        return Err("Path does not exist".to_string());
    }
    if let Some(name) = protected_first_segment(&source, &canonical_root) {
        return Err(format!("Cannot rename protected directory: {}", name));
    }

    let destination = canonical_parent.join(new_name);
    if let Some(name) = protected_first_segment(&destination, &canonical_root) {
        return Err(format!("Cannot create protected directory: {}", name));
    }
    if destination != source && destination.symlink_metadata().is_ok() {
        return Err("A file or folder with that name already exists".to_string());
    }
    if destination == source {
        return Ok(destination.to_string_lossy().into_owned());
    }

    std::fs::rename(&source, &destination).map_err(|e| e.to_string())?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn rename_path(
    path: String,
    new_name: String,
    project_path: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rename_path_in_workspace(&path, &new_name, &project_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Validate a deletion target.
fn validate_existing_path_for_delete(
    target: &str,
    allowed_root: &str,
) -> Result<std::path::PathBuf, String> {
    let target_path = Path::new(target);

    if !target_path.is_absolute() {
        return Err("Path must be absolute".to_string());
    }

    let file_name = target_path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid file name".to_string())?;

    let parent = target_path
        .parent()
        .ok_or_else(|| "Cannot resolve parent directory".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Cannot resolve parent directory: {}", e))?;
    let canonical_root = Path::new(allowed_root)
        .canonicalize()
        .map_err(|e| format!("Cannot resolve root directory: {}", e))?;

    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Path is outside the allowed directory".to_string());
    }

    let resolved = canonical_parent.join(file_name);

    if resolved == canonical_root {
        return Err("Cannot delete the project root".to_string());
    }

    if resolved.symlink_metadata().is_err() {
        return Err("Path does not exist".to_string());
    }

    if let Some(name) = protected_first_segment(&resolved, &canonical_root) {
        return Err(format!("Cannot delete protected directory: {}", name));
    }

    Ok(resolved)
}

#[cfg(test)]
mod rename_tests {
    use super::rename_path_in_workspace;
    use std::path::PathBuf;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-fs-rename-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn rename_stays_inside_workspace_and_does_not_overwrite() {
        let root = temp_root("success");
        std::fs::create_dir_all(root.join("docs")).unwrap();
        std::fs::write(root.join("docs/old.md"), "content").unwrap();

        let renamed = rename_path_in_workspace(
            &root.join("docs/old.md").to_string_lossy(),
            "guide.md",
            &root.to_string_lossy(),
        )
        .unwrap();
        assert_eq!(
            PathBuf::from(renamed),
            root.canonicalize().unwrap().join("docs/guide.md")
        );
        assert_eq!(
            std::fs::read_to_string(root.join("docs/guide.md")).unwrap(),
            "content"
        );

        std::fs::write(root.join("docs/existing.md"), "keep").unwrap();
        let collision = rename_path_in_workspace(
            &root.join("docs/guide.md").to_string_lossy(),
            "existing.md",
            &root.to_string_lossy(),
        )
        .unwrap_err();
        assert!(collision.contains("already exists"));
        assert_eq!(
            std::fs::read_to_string(root.join("docs/existing.md")).unwrap(),
            "keep"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rename_rejects_protected_entries_and_path_escape() {
        let root = temp_root("protected");
        let outside = temp_root("outside");
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("outside.txt"), "outside").unwrap();

        let protected = rename_path_in_workspace(
            &root.join(".git/objects").to_string_lossy(),
            "moved",
            &root.to_string_lossy(),
        )
        .unwrap_err();
        assert!(protected.contains("protected"));

        let escaped = rename_path_in_workspace(
            &outside.join("outside.txt").to_string_lossy(),
            "renamed.txt",
            &root.to_string_lossy(),
        )
        .unwrap_err();
        assert!(escaped.contains("outside"));
        assert!(outside.join("outside.txt").exists());

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
    }
}

#[cfg(test)]
mod guarded_write_tests {
    use super::write_file_content_if_unchanged_in_workspace;
    use std::path::PathBuf;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-fs-guarded-write-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn writes_only_when_the_disk_content_matches_the_expected_baseline() {
        let root = temp_root("match");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("notes.md");
        std::fs::write(&path, "original content that is longer").unwrap();

        let written = write_file_content_if_unchanged_in_workspace(
            &path.to_string_lossy(),
            "short",
            "original content that is longer",
            &root.to_string_lossy(),
        )
        .unwrap();

        assert!(written);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "short");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_a_stale_baseline_without_modifying_the_disk_file() {
        let root = temp_root("conflict");
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("notes.md");
        std::fs::write(&path, "agent update").unwrap();

        let written = write_file_content_if_unchanged_in_workspace(
            &path.to_string_lossy(),
            "my draft",
            "original",
            &root.to_string_lossy(),
        )
        .unwrap();

        assert!(!written);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "agent update");
        let _ = std::fs::remove_dir_all(root);
    }
}

#[tauri::command]
pub async fn delete_path(path: String, project_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let resolved = validate_existing_path_for_delete(&path, &project_path)?;
        trash::delete(&resolved).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_project_files(project_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(crate::platform::resolve_spawn_program("git"));
        crate::platform::suppress_console_window(&mut cmd);
        let output = cmd
            .args([
                "-c",
                "core.quotePath=false",
                "ls-files",
                "-c",
                "-o",
                "--exclude-standard",
            ])
            .current_dir(&project_path)
            .output()
            .map_err(|e| e.to_string())?;

        let mut files: Vec<String> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();

        files.sort();
        files.dedup();
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn relative_git_path_is_safe(path: &str) -> bool {
    let path = Path::new(path);
    path.components().all(|component| {
        matches!(
            component,
            std::path::Component::Normal(_) | std::path::Component::CurDir
        )
    })
}

fn split_relative_file_path(path: &str) -> (String, String) {
    match path.rsplit_once('/') {
        Some((dir, name)) => (dir.to_string(), name.to_string()),
        None => ("".to_string(), path.to_string()),
    }
}

fn file_extension_lower(name: &str) -> Option<String> {
    name.rsplit_once('.')
        .and_then(|(_, ext)| (!ext.is_empty()).then(|| ext.to_ascii_lowercase()))
}

#[tauri::command]
pub async fn search_project_files(
    project_path: String,
    query: String,
    extensions: Vec<String>,
    limit: Option<usize>,
) -> Result<Vec<ProjectFileSearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = validate_project_root(&project_path)?;
        let query = query.trim().to_ascii_lowercase();
        let extension_filters: std::collections::HashSet<String> = extensions
            .into_iter()
            .map(|ext| ext.trim().trim_start_matches('.').to_ascii_lowercase())
            .filter(|ext| !ext.is_empty())
            .collect();
        let limit = limit.unwrap_or(80).clamp(1, MAX_FILE_SEARCH_RESULTS);

        let mut cmd = Command::new(crate::platform::resolve_spawn_program("git"));
        crate::platform::suppress_console_window(&mut cmd);
        let output = cmd
            .args(["-c", "core.quotePath=false", "ls-files", "-z"])
            .current_dir(&root)
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }

        let mut matches: Vec<(u8, ProjectFileSearchResult)> = Vec::new();
        for rel in String::from_utf8_lossy(&output.stdout).split('\0') {
            if rel.is_empty() || !relative_git_path_is_safe(rel) {
                continue;
            }

            let (dir, name) = split_relative_file_path(rel);
            let name_lower = name.to_ascii_lowercase();
            if !query.is_empty() && !name_lower.contains(&query) {
                continue;
            }

            let extension = file_extension_lower(&name);
            if !extension_filters.is_empty()
                && !extension
                    .as_ref()
                    .is_some_and(|ext| extension_filters.contains(ext))
            {
                continue;
            }

            let score = if query.is_empty() {
                3
            } else if name_lower == query {
                0
            } else if name_lower.starts_with(&query) {
                1
            } else {
                2
            };

            let full_path = root.join(rel);
            if !full_path.is_file() {
                continue;
            }

            matches.push((
                score,
                ProjectFileSearchResult {
                    path: full_path.to_string_lossy().into_owned(),
                    name,
                    dir,
                    extension,
                },
            ));
        }

        matches.sort_by(|(score_a, a), (score_b, b)| {
            score_a
                .cmp(score_b)
                .then_with(|| {
                    a.name
                        .to_ascii_lowercase()
                        .cmp(&b.name.to_ascii_lowercase())
                })
                .then_with(|| a.dir.cmp(&b.dir))
        });

        Ok(matches
            .into_iter()
            .take(limit)
            .map(|(_, result)| result)
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}
