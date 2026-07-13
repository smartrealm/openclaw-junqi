use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;

use notify::{RecursiveMode, Watcher};
use serde::Deserialize;
use tauri::{AppHandle, Emitter};

const FALLBACK_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Deserialize)]
struct HookEvent {
    #[serde(default)]
    task_id: String,
    #[serde(default)]
    event: String,
    #[serde(default)]
    notification_type: String,
}

static LAST_STATUS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn last_status() -> &'static Mutex<HashMap<String, String>> {
    LAST_STATUS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn start(app: AppHandle) {
    thread::spawn(move || run_loop(app));
}

fn run_loop(app: AppHandle) {
    let Ok(events_root) = super::hooks::events_root() else {
        return;
    };
    let _ = fs::remove_dir_all(&events_root);
    let _ = fs::create_dir_all(&events_root);

    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::RecommendedWatcher::new(tx, notify::Config::default())
        .ok()
        .and_then(|mut watcher| {
            watcher.watch(&events_root, RecursiveMode::Recursive).ok()?;
            Some(watcher)
        });
    let mut offsets = HashMap::<PathBuf, u64>::new();

    loop {
        if watcher.is_some() {
            match rx.recv_timeout(FALLBACK_INTERVAL) {
                Ok(_) | Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => watcher = None,
            }
            while rx.try_recv().is_ok() {}
        } else {
            thread::sleep(FALLBACK_INTERVAL);
        }

        let Ok(entries) = fs::read_dir(&events_root) else {
            continue;
        };
        let mut seen = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path().join("events.jsonl");
            if !path.is_file() {
                continue;
            }
            seen.push(path.clone());
            let offset = *offsets.entry(path.clone()).or_insert(0);
            if let Some(next) = read_and_dispatch(&app, &path, offset) {
                offsets.insert(path, next);
            }
        }
        offsets.retain(|path, _| seen.contains(path));
    }
}

fn read_and_dispatch(app: &AppHandle, path: &Path, offset: u64) -> Option<u64> {
    let mut file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() <= offset {
        return Some(offset);
    }
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buffer = String::new();
    file.read_to_string(&mut buffer).ok()?;
    let complete_len = buffer.rfind('\n').map(|index| index + 1).unwrap_or(0);
    for line in buffer[..complete_len].lines() {
        if let Ok(event) = serde_json::from_str::<HookEvent>(line) {
            dispatch(app, &event);
        }
    }
    Some(offset + complete_len as u64)
}

fn dispatch(app: &AppHandle, event: &HookEvent) {
    if event.task_id.is_empty() || !super::agent_task_pty::is_task_active(&event.task_id) {
        return;
    }
    let Some(status) = status_for_event(event) else {
        return;
    };
    let Ok(mut statuses) = last_status().lock() else {
        return;
    };
    if statuses.get(&event.task_id).map(String::as_str) == Some(status) {
        return;
    }
    statuses.insert(event.task_id.clone(), status.to_string());
    let _ = app.emit(
        "task-status",
        serde_json::json!({ "task_id": event.task_id, "status": status }),
    );
}

fn status_for_event(event: &HookEvent) -> Option<&'static str> {
    match event.event.as_str() {
        "Notification" if notification_requires_attention(&event.notification_type) => {
            Some("input_required")
        }
        "PermissionRequest" => Some("input_required"),
        "UserPromptSubmit" | "PostToolUse" => Some("running"),
        "Stop" => Some("awaiting_review"),
        _ => None,
    }
}

fn notification_requires_attention(notification_type: &str) -> bool {
    match notification_type {
        "" | "permission_prompt" | "elicitation_dialog" => true,
        "idle_prompt" | "auth_success" | "elicitation_complete" | "elicitation_response" => false,
        _ => true,
    }
}

pub fn cleanup_task_events(task_id: &str) {
    if let Ok(mut statuses) = last_status().lock() {
        statuses.remove(task_id);
    }
    if let Ok(directory) = super::hooks::events_dir_for(task_id) {
        let _ = fs::remove_dir_all(directory);
    }
}

#[cfg(test)]
mod tests {
    use super::{status_for_event, HookEvent};

    #[test]
    fn hook_events_map_to_attention_and_running_states() {
        let parse = |event: &str, notification_type: &str| HookEvent {
            task_id: "task-1".to_string(),
            event: event.to_string(),
            notification_type: notification_type.to_string(),
        };
        assert_eq!(
            status_for_event(&parse("PermissionRequest", "")),
            Some("input_required")
        );
        assert_eq!(
            status_for_event(&parse("Notification", "permission_prompt")),
            Some("input_required")
        );
        assert_eq!(
            status_for_event(&parse("Notification", "idle_prompt")),
            None
        );
        assert_eq!(
            status_for_event(&parse("Stop", "")),
            Some("awaiting_review")
        );
        assert_eq!(
            status_for_event(&parse("UserPromptSubmit", "")),
            Some("running")
        );
        assert_eq!(status_for_event(&parse("PostToolUse", "")), Some("running"));
    }
}
