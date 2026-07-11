//! Project-directory lifecycle for the embedded terminal.
//!
//! A terminal workspace is allowed to point only at a directory that exists
//! right now.  Keeping resolution, recent-folder persistence, and shell `cd`
//! generation on the same canonical path prevents stale aliases from creating
//! workspaces that cannot launch.

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

const RECENT_WORKSPACES_FILE: &str = "terminal-recent-workspaces.json";
const RECENT_WORKSPACES_LIMIT: usize = 20;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspaceDirectory {
    pub path: String,
    pub name: String,
}

fn recent_workspaces_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Resolve a directory once for every terminal-facing path.  Callers receive
/// a canonical path, so symlink aliases cannot create duplicate workspaces or
/// make a shell start in a different directory than the sidebar displays.
pub fn resolve_terminal_workspace_directory(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let candidate = path.as_ref();
    if candidate.as_os_str().is_empty() {
        return Err("terminal workspace directory is empty".to_string());
    }

    let canonical = candidate
        .canonicalize()
        .map_err(|_| "terminal workspace directory does not exist".to_string())?;
    if !canonical.is_dir() {
        return Err("terminal workspace path is not a directory".to_string());
    }
    Ok(canonical)
}

fn application_home_directory() -> Option<PathBuf> {
    crate::platform::home_dir().map(|path| path.canonicalize().unwrap_or(path))
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn directory_record(path: PathBuf) -> TerminalWorkspaceDirectory {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path_string(&path));
    TerminalWorkspaceDirectory {
        path: path_string(&path),
        name,
    }
}

fn recent_workspaces_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join(RECENT_WORKSPACES_FILE))
        .map_err(|error| format!("resolve terminal recent workspaces path: {error}"))
}

/// Corrupt or incomplete recent-folder state must never stop a terminal from
/// opening.  Treat it as an empty history and let the next successful record
/// repair the file.
fn read_recent_paths(path: &Path) -> Result<Vec<String>, String> {
    match fs::read(path) {
        Ok(contents) => Ok(serde_json::from_slice::<Vec<String>>(&contents)
            .unwrap_or_default()
            .into_iter()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .take(RECENT_WORKSPACES_LIMIT)
            .collect()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(format!("read terminal recent workspaces: {error}")),
    }
}

fn write_recent_paths(path: &Path, paths: &[String]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid terminal recent workspaces path".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("create terminal recent workspaces directory: {error}"))?;

    let contents = serde_json::to_vec(paths)
        .map_err(|error| format!("encode terminal recent workspaces: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(RECENT_WORKSPACES_FILE);
    let temporary = parent.join(format!(".{file_name}.{}.tmp", uuid::Uuid::new_v4()));

    if let Err(error) = fs::write(&temporary, contents) {
        return Err(format!("write terminal recent workspaces: {error}"));
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("save terminal recent workspaces: {error}"));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn same_path(left: &Path, right: &Path) -> bool {
    let normalized_left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let normalized_right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    normalized_left == normalized_right
}

fn normalize_recent_paths(paths: Vec<String>, home: Option<&Path>) -> Vec<String> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| {
            let candidate = Path::new(path);
            home.map(|home| !same_path(candidate, home)).unwrap_or(true)
        })
        .filter(|path| seen.insert(path.clone()))
        .take(RECENT_WORKSPACES_LIMIT)
        .collect()
}

fn record_recent_path(paths: Vec<String>, directory: &Path, home: Option<&Path>) -> Vec<String> {
    let directory = path_string(directory);
    let mut next = normalize_recent_paths(paths, home)
        .into_iter()
        .filter(|path| path != &directory)
        .collect::<Vec<_>>();

    let is_home = home
        .map(|home| same_path(Path::new(&directory), home))
        .unwrap_or(false);
    if !is_home {
        next.insert(0, directory);
    }
    next.truncate(RECENT_WORKSPACES_LIMIT);
    next
}

fn visible_recent_directories(
    paths: Vec<String>,
    home: Option<&Path>,
) -> Vec<TerminalWorkspaceDirectory> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter_map(|path| resolve_terminal_workspace_directory(path).ok())
        .filter(|path| home.map(|home| !same_path(path, home)).unwrap_or(true))
        .filter(|path| seen.insert(path.clone()))
        .map(directory_record)
        .take(RECENT_WORKSPACES_LIMIT)
        .collect()
}

fn record_workspace_directory(app: &AppHandle, directory: &Path) -> Result<(), String> {
    let storage_path = recent_workspaces_path(app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    let current = read_recent_paths(&storage_path)?;
    let next = record_recent_path(
        current.clone(),
        directory,
        application_home_directory().as_deref(),
    );
    if next != current {
        write_recent_paths(&storage_path, &next)?;
    }
    Ok(())
}

/// Validate and remember a directory selected by the user before it becomes a
/// workspace root.  The UI can safely create a terminal with the returned path.
#[tauri::command]
pub fn open_terminal_workspace_directory(
    app: AppHandle,
    path: String,
) -> Result<TerminalWorkspaceDirectory, String> {
    let directory = resolve_terminal_workspace_directory(path)?;
    record_workspace_directory(&app, &directory)?;
    Ok(directory_record(directory))
}

/// Record an existing workspace root after a regular "New Workspace" action.
/// Failure to persist history does not affect the already-open terminal.
#[tauri::command]
pub fn record_terminal_workspace_directory(app: AppHandle, path: String) -> Result<(), String> {
    let directory = resolve_terminal_workspace_directory(path)?;
    record_workspace_directory(&app, &directory)
}

/// Return only directories still present on disk.  Missing mounted volumes are
/// display-filtered rather than erased so they reappear when mounted again.
#[tauri::command]
pub fn list_terminal_recent_workspaces(
    app: AppHandle,
) -> Result<Vec<TerminalWorkspaceDirectory>, String> {
    let storage_path = recent_workspaces_path(&app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    let paths = read_recent_paths(&storage_path)?;
    Ok(visible_recent_directories(
        paths,
        application_home_directory().as_deref(),
    ))
}

#[tauri::command]
pub fn clear_terminal_recent_workspaces(app: AppHandle) -> Result<(), String> {
    let storage_path = recent_workspaces_path(&app)?;
    let _guard = recent_workspaces_lock()
        .lock()
        .map_err(|_| "terminal recent workspaces lock poisoned".to_string())?;
    write_recent_paths(&storage_path, &[])
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_recent_paths, read_recent_paths, record_recent_path,
        resolve_terminal_workspace_directory, visible_recent_directories, write_recent_paths,
    };
    use std::fs;
    use std::path::Path;

    fn scratch_directory(label: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("junqi-terminal-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn recent_paths_are_lru_deduplicated_and_exclude_home() {
        let home = scratch_directory("home");
        let alpha = scratch_directory("alpha");
        let beta = scratch_directory("beta");
        let alpha_path = alpha.to_string_lossy().into_owned();
        let beta_path = beta.to_string_lossy().into_owned();

        let with_alpha = record_recent_path(Vec::new(), &alpha, Some(&home));
        let with_beta = record_recent_path(with_alpha, &beta, Some(&home));
        let reopened_alpha = record_recent_path(with_beta, &alpha, Some(&home));
        let ignored_home = record_recent_path(reopened_alpha, &home, Some(&home));

        assert_eq!(ignored_home, vec![alpha_path, beta_path]);
        let _ = fs::remove_dir_all(home);
        let _ = fs::remove_dir_all(alpha);
        let _ = fs::remove_dir_all(beta);
    }

    #[test]
    fn recent_entries_filter_missing_directories_without_erasing_them() {
        let home = scratch_directory("home");
        let existing = scratch_directory("existing");
        let missing = scratch_directory("missing");
        fs::remove_dir_all(&missing).unwrap();

        let visible = visible_recent_directories(
            vec![
                missing.to_string_lossy().into_owned(),
                existing.to_string_lossy().into_owned(),
                home.to_string_lossy().into_owned(),
            ],
            Some(&home),
        );

        assert_eq!(visible.len(), 1);
        assert_eq!(
            visible[0].path,
            existing.canonicalize().unwrap().to_string_lossy()
        );
        let _ = fs::remove_dir_all(home);
        let _ = fs::remove_dir_all(existing);
    }

    #[test]
    fn resolver_rejects_missing_and_non_directory_paths() {
        let missing =
            std::env::temp_dir().join(format!("junqi-terminal-missing-{}", uuid::Uuid::new_v4()));
        assert!(resolve_terminal_workspace_directory(&missing).is_err());

        let parent = scratch_directory("file-parent");
        let file = parent.join("not-a-directory");
        fs::write(&file, "x").unwrap();
        assert!(resolve_terminal_workspace_directory(&file).is_err());
        let _ = fs::remove_dir_all(parent);
    }

    #[test]
    fn normalization_preserves_order_and_removes_duplicates() {
        let normalized = normalize_recent_paths(
            vec!["/a".to_string(), "/b".to_string(), "/a".to_string()],
            Some(Path::new("/home/example")),
        );
        assert_eq!(normalized, vec!["/a", "/b"]);
    }

    #[test]
    fn recent_history_recovers_from_corruption_and_replaces_previous_contents() {
        let root = scratch_directory("history");
        let history = root.join("recent.json");
        let initial = vec!["/first".to_string(), "/second".to_string()];
        let replacement = vec!["/replacement".to_string()];

        write_recent_paths(&history, &initial).unwrap();
        assert_eq!(read_recent_paths(&history).unwrap(), initial);
        write_recent_paths(&history, &replacement).unwrap();
        assert_eq!(read_recent_paths(&history).unwrap(), replacement);

        fs::write(&history, "not valid json").unwrap();
        assert!(read_recent_paths(&history).unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }
}
