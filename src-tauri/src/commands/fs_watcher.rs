use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

use notify::Watcher;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE: Duration = Duration::from_millis(200);

pub struct FsWatcherState {
    watcher: Arc<Mutex<Option<notify::RecommendedWatcher>>>,
    watched: Arc<Mutex<HashMap<PathBuf, usize>>>,
}

pub fn init(app: &tauri::App) {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let watched = Arc::new(Mutex::new(HashMap::<PathBuf, usize>::new()));
    let handler_watched = watched.clone();
    let watcher = notify::RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else { return };
            if matches!(event.kind, notify::EventKind::Access(_)) {
                return;
            }
            let watched = handler_watched.lock();
            for path in &event.paths {
                let mut dirty = HashSet::new();
                if watched.contains_key(path.as_path()) {
                    dirty.insert(path.clone());
                }
                if let Some(parent) = path.parent() {
                    if watched.contains_key(parent) {
                        dirty.insert(parent.to_path_buf());
                    }
                }
                for dir in dirty {
                    let _ = tx.send(dir);
                }
            }
        },
        notify::Config::default(),
    )
    .ok();

    app.manage(FsWatcherState {
        watcher: Arc::new(Mutex::new(watcher)),
        watched,
    });
    let handle = app.handle().clone();
    std::thread::spawn(move || debounce_events(handle, rx));
}

fn debounce_events(app: AppHandle, rx: mpsc::Receiver<PathBuf>) {
    while let Ok(first) = rx.recv() {
        let mut dirty = HashSet::from([first]);
        let deadline = Instant::now() + DEBOUNCE;
        while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
            match rx.recv_timeout(remaining) {
                Ok(path) => {
                    dirty.insert(path);
                }
                Err(_) => break,
            }
        }
        for dir in dirty {
            let _ = app.emit(
                "fs-changed",
                serde_json::json!({ "dir": dir.to_string_lossy() }),
            );
        }
    }
}

#[tauri::command]
pub async fn watch_dir(
    path: String,
    project_path: String,
    state: tauri::State<'_, FsWatcherState>,
) -> Result<bool, String> {
    let watcher = state.watcher.clone();
    let watched = state.watched.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs_neu::validate_path_within(&path, &project_path, true)?;
        let key = PathBuf::from(path);
        if watcher.lock().is_none() {
            return Ok(false);
        }
        {
            let mut map = watched.lock();
            let count = map.entry(key.clone()).or_insert(0);
            *count += 1;
            if *count > 1 {
                return Ok(true);
            }
        }
        let mut guard = watcher.lock();
        let Some(active) = guard.as_mut() else {
            return Ok(false);
        };
        if active
            .watch(&key, notify::RecursiveMode::NonRecursive)
            .is_err()
        {
            drop(guard);
            release_watch(&watched, &key);
            return Ok(false);
        }
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn unwatch_dir(
    path: String,
    state: tauri::State<'_, FsWatcherState>,
) -> Result<(), String> {
    let watcher = state.watcher.clone();
    let watched = state.watched.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let key = PathBuf::from(path);
        if !release_watch(&watched, &key) {
            return Ok(());
        }
        if let Some(active) = watcher.lock().as_mut() {
            let _ = active.unwatch(&key);
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn release_watch(watched: &Mutex<HashMap<PathBuf, usize>>, key: &PathBuf) -> bool {
    let mut map = watched.lock();
    let Some(count) = map.get_mut(key) else {
        return false;
    };
    *count -= 1;
    if *count == 0 {
        map.remove(key);
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::release_watch;
    use parking_lot::Mutex;
    use std::collections::HashMap;
    use std::path::PathBuf;

    #[test]
    fn shared_watch_is_removed_only_after_the_last_release() {
        let path = PathBuf::from("/tmp/shared-project");
        let watched = Mutex::new(HashMap::from([(path.clone(), 2)]));

        assert!(!release_watch(&watched, &path));
        assert_eq!(watched.lock().get(&path), Some(&1));
        assert!(release_watch(&watched, &path));
        assert!(!watched.lock().contains_key(&path));
        assert!(!release_watch(&watched, &path));
    }
}
