//! Dedicated terminal windows.
//!
//! A handoff is stored in the desktop process, not a WebView, so the target
//! window can attach to the source PTY after its own JavaScript context boots.
//! The PTY itself remains owned by `pty_neu`'s process-global registry.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

static TERMINAL_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

fn handoffs() -> &'static Mutex<HashMap<String, serde_json::Value>> {
    static HANDOFFS: OnceLock<Mutex<HashMap<String, serde_json::Value>>> = OnceLock::new();
    HANDOFFS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn open_terminal_window(app: AppHandle, handoff: serde_json::Value) -> Result<String, String> {
    let label = format!(
        "terminal-{}",
        TERMINAL_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );

    handoffs()
        .lock()
        .map_err(|_| "terminal handoff registry lock poisoned".to_string())?
        .insert(label.clone(), handoff);

    let url = WebviewUrl::App("index.html#/terminal".into());
    if let Err(error) = WebviewWindowBuilder::new(&app, &label, url)
        .title("JunQi Terminal")
        .inner_size(1180.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .visible(true)
        .build()
    {
        if let Ok(mut registry) = handoffs().lock() {
            registry.remove(&label);
        }
        return Err(format!("failed to open terminal window: {error}"));
    }

    Ok(label)
}

/// The target window consumes its startup payload exactly once. A repeated
/// mount cannot duplicate a live PTY tab into another pane.
#[tauri::command]
pub fn take_terminal_window_handoff(label: String) -> Option<serde_json::Value> {
    handoffs().lock().ok()?.remove(&label)
}

#[cfg(test)]
mod tests {
    use super::handoffs;

    #[test]
    fn terminal_handoff_is_single_consumer() {
        let label = "terminal-test-one-shot";
        handoffs().lock().unwrap().insert(
            label.to_string(),
            serde_json::json!({ "shellId": "shell-1" }),
        );
        assert!(handoffs().lock().unwrap().remove(label).is_some());
        assert!(handoffs().lock().unwrap().remove(label).is_none());
    }
}
