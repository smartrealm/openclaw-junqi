//! QuickChatWindow — single-session floating chat spawned from a dropped file.
//!
//! Architecturally parallel to the pet window: a separate always-on-top
//! webview window that hosts only the `/#/quickchat` route, which mounts a
//! compact one-session ChatView.
//!
//! Lifecycle:
//!   * `open_quickchat_with_files(app, paths)` — create window, emit the
//!     initial file paths to it so the chat attaches them as the first
//!     user message context. Idempotent: if a QuickChat window already exists
//!     we just refocus it and resend the files.
//!   * `close_quickchat(app)` — user-initiated close.
//!
//! Window label: `quickchat`. Single-instance by label.
//!
//! Mirrors a ChatGPT-desktop-style compact chat, separate from the main
//! app window so the user can drop a file, get a focused 1-on-1 chat
//! without ever touching the full workbench.

use std::path::PathBuf;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

const LABEL: &str = "quickchat";
const W: f64 = 460.0;
const H: f64 = 620.0;
const MARGIN: f64 = 24.0;

/// Open (or refocus) the QuickChatWindow, optionally seeding it with file paths.
#[tauri::command]
pub async fn open_quickchat_with_files(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    // If the window already exists, just send the new paths + refocus.
    if let Some(win) = app.get_webview_window(LABEL) {
        if !paths.is_empty() {
            let _ = win.emit("quickchat:seed", &paths);
        }
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.unminimize();
        return Ok(());
    }

    // Default to bottom-right of the primary monitor, nudged above the pet
    // window if both are open. Falls back to a sane default if no monitor.
    let (mut pos_x, mut pos_y) = (MARGIN, MARGIN);
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.primary_monitor() {
            let scale = monitor.scale_factor();
            let phys = monitor.size();
            let lw = phys.width as f64 / scale;
            let lh = phys.height as f64 / scale;
            pos_x = (lw - W - MARGIN).max(MARGIN);
            pos_y = (lh - H - MARGIN).max(MARGIN);
        }
    }

    let url = WebviewUrl::App("index.html#/quickchat".into());
    let win = WebviewWindowBuilder::new(&app, LABEL, url)
        .title("JunQi Quick Chat")
        .inner_size(W, H)
        .min_inner_size(360.0, 420.0)
        .position(pos_x, pos_y)
        .decorations(false)
        .transparent(true)
        .skip_taskbar(true)
        .always_on_top(true)
        .resizable(true)
        .visible(true)
        .build()
        .map_err(|e| format!("Failed to open quickchat window: {}", e))?;

    // Persist window position across launches (same as pet does).
    let app_for_move = app.clone();
    let scale = win.scale_factor().unwrap_or(1.0);
    win.on_window_event(move |event| {
        if let WindowEvent::Moved(pos) = event {
            let _ = app_for_move.emit(
                "quickchat-moved",
                serde_json::json!({ "x": pos.x as f64 / scale, "y": pos.y as f64 / scale }),
            );
        }
    });

    // Once the page has loaded, deliver the seed file paths (if any).
    if !paths.is_empty() {
        let win_clone = win.clone();
        let paths_clone = paths.clone();
        // WindowEvent::Resized or just a delay-burst — easiest is a spawn with
        // a short sleep so the React tree has time to listen for the event.
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(450)).await;
            let _ = win_clone.emit("quickchat:seed", &paths_clone);
        });
    }

    let _ = app.emit(
        "quickchat-visibility",
        serde_json::json!({ "visible": true }),
    );
    Ok(())
}

#[tauri::command]
pub async fn close_quickchat(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.close();
    }
    let _ = app.emit(
        "quickchat-visibility",
        serde_json::json!({ "visible": false }),
    );
    Ok(())
}

#[tauri::command]
pub async fn get_quickchat_visible(app: AppHandle) -> bool {
    app.get_webview_window(LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// Helper called by the lib drag-drop bridge when files land on a non-quickchat
/// window — opens a QuickChatWindow seeded with those paths.
pub fn spawn_quickchat_for_paths(app: &AppHandle, paths: Vec<String>) {
    // Capture only file-name labels for the toast; the actual paths flow through
    // via the open_quickchat_with_files command.
    let labels: Vec<String> = paths
        .iter()
        .map(|p| {
            PathBuf::from(p)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| p.clone())
        })
        .collect();

    // Toast the user; non-blocking.
    let _ = app.emit(
        "quickchat:prompt",
        serde_json::json!({
            "count": labels.len(),
            "labels": labels,
        }),
    );

    // Spawn the window via the registered tauri command.
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        let paths_for_cmd = paths.clone();
        let _ = open_quickchat_with_files(app_clone, paths_for_cmd).await;
    });
}
