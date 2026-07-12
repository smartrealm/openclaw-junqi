//! Native filesystem watches for the terminal sidebar file tree.
//!
//! Watches are owned by the desktop process, keyed by a renderer-generated
//! id. A visible file tree watches only its root plus expanded directories;
//! hiding the tree removes the registry entry and drops every OS handle.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

const MAX_WATCHED_DIRECTORIES: usize = 64;

struct TerminalWorkspaceWatch {
    generation: u64,
    _watcher: RecommendedWatcher,
}

fn watch_registry() -> &'static Mutex<HashMap<String, TerminalWorkspaceWatch>> {
    static WATCHES: OnceLock<Mutex<HashMap<String, TerminalWorkspaceWatch>>> = OnceLock::new();
    WATCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn canonical_root(value: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(value);
    if !root.is_dir() {
        return Err("terminal workspace root is not a directory".to_string());
    }
    root.canonicalize().map_err(|error| error.to_string())
}

fn normalized_watch_paths(root: &Path, paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    let mut normalized = BTreeSet::new();
    normalized.insert(root.to_path_buf());
    for raw in paths {
        if normalized.len() >= MAX_WATCHED_DIRECTORIES {
            break;
        }
        let candidate = PathBuf::from(raw);
        if !candidate.is_dir() {
            continue;
        }
        let canonical = candidate
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !canonical.starts_with(root) {
            return Err("terminal watch path is outside the workspace".to_string());
        }
        normalized.insert(canonical);
    }
    Ok(normalized.into_iter().collect())
}

#[tauri::command]
pub fn set_terminal_workspace_watches(
    app: AppHandle,
    watch_id: String,
    generation: u64,
    project_path: String,
    paths: Vec<String>,
) -> Result<(), String> {
    if watch_id.trim().is_empty() || watch_id.len() > 256 {
        return Err("invalid terminal watch id".to_string());
    }
    let root = canonical_root(&project_path)?;
    let paths = normalized_watch_paths(&root, paths)?;
    let emitted_watch_id = watch_id.clone();
    let event_app = app.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_err() {
            return;
        }
        let _ = event_app.emit(
            "terminal-workspace-files-changed",
            serde_json::json!({ "watchId": emitted_watch_id }),
        );
    })
    .map_err(|error| format!("create terminal workspace watcher: {error}"))?;

    for path in paths {
        watcher
            .watch(&path, RecursiveMode::NonRecursive)
            .map_err(|error| format!("watch terminal workspace path: {error}"))?;
    }

    let mut registry = watch_registry()
        .lock()
        .map_err(|_| "terminal watch registry lock poisoned".to_string())?;
    registry.insert(
        watch_id,
        TerminalWorkspaceWatch {
            generation,
            _watcher: watcher,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn clear_terminal_workspace_watches(watch_id: String, generation: u64) -> Result<(), String> {
    if let Ok(mut registry) = watch_registry().lock() {
        if registry
            .get(&watch_id)
            .is_some_and(|watch| watch.generation == generation)
        {
            registry.remove(&watch_id);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalized_watch_paths;

    #[test]
    fn watch_paths_deduplicate_and_keep_the_root() {
        let root = std::env::temp_dir();
        let root = root.canonicalize().unwrap();
        let paths = normalized_watch_paths(
            &root,
            vec![
                root.to_string_lossy().into_owned(),
                root.to_string_lossy().into_owned(),
            ],
        )
        .unwrap();
        assert_eq!(paths, vec![root]);
    }
}
