//! Desktop Companion ("Pet") — a transparent, always-on-top floating window that
//! mirrors the AI's task state as an animated character.
//!
//! Architecture (single source of truth):
//!   main window → derives `PetState` → `emit_pet_state` → `app.emit("pet-state")`
//!   pet window  → thin client: listens for "pet-state" and renders only. It does
//!                 NOT connect to the gateway or hold any business store.
//!
//! All window manipulation (cursor pass-through, position, focus) happens here in
//! Rust so the frontend pet window needs zero window-API permissions — it only
//! `invoke`s these commands and listens for events.

use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, Position, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

pub const PET_LABEL: &str = "pet";
const PET_STATE_EVENT: &str = "pet-state";

/// Serializes pet-window creation. React StrictMode double-invokes effects in
/// dev, and without this two concurrent `open_pet_window` calls can both pass
/// the "window exists?" check and end up creating two pet windows.
static PET_CREATE_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Broadcast a `PetState` payload (produced by the main window) to every window.
/// The pet window re-renders on this event.
#[tauri::command]
pub async fn emit_pet_state(app: AppHandle, state: serde_json::Value) -> Result<(), String> {
    app.emit(PET_STATE_EVENT, state).map_err(|e| e.to_string())
}

/// Create (or reveal) the transparent floating pet window. It loads the same SPA
/// entry as the main window; `main.tsx` branches on the window label to render
/// the companion UI instead of the full app.
#[tauri::command]
pub async fn open_pet_window(app: AppHandle) -> Result<(), String> {
    // Hold the guard across the check + build so concurrent calls serialize:
    // the second one will see the window the first one just created.
    let _guard = PET_CREATE_GUARD.lock().unwrap();
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(&app, PET_LABEL, WebviewUrl::App("index.html".into()))
        .title("JunQi Pet")
        .inner_size(132.0, 170.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(true);

    // Default to the bottom-right of the primary monitor (with a margin).
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.primary_monitor() {
            let scale = monitor.scale_factor();
            let phys = monitor.size();
            let logical_w = phys.width as f64 / scale;
            let logical_h = phys.height as f64 / scale;
            let x = (logical_w - 160.0).max(24.0);
            let y = (logical_h - 200.0).max(24.0);
            builder = builder.position(x, y);
        }
    }

    let win = builder
        .build()
        .map_err(|e| format!("Failed to open pet window: {}", e))?;

    // Persist drag position: when the user moves the pet, broadcast the new
    // logical position so the pet webview (an independent window) can store it
    // for restore on the next launch.
    let scale = win.scale_factor().unwrap_or(1.0);
    let app_for_move = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Moved(pos) = event {
            let _ = app_for_move.emit(
                "pet-moved",
                serde_json::json!({ "x": pos.x as f64 / scale, "y": pos.y as f64 / scale }),
            );
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn close_pet_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        let _ = win.hide();
    }
    Ok(())
}

/// Toggle the pet window's visibility, creating it if it doesn't exist yet.
/// Returns the resulting visibility (handy for the tray menu checkmark).
#[tauri::command]
pub async fn toggle_pet_window(app: AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return Ok(false);
        }
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(true);
    }
    open_pet_window(app).await?;
    Ok(true)
}

/// Toggle mouse pass-through on the pet window. When `ignore` is true, clicks
/// fall through to whatever is behind the pet (the default, so it never blocks
/// the desktop); the pet flips it to false on hover so it becomes interactive.
#[tauri::command]
pub async fn set_pet_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        win.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Move the pet window to a logical (x, y) — used after drag + edge snapping.
#[tauri::command]
pub async fn set_pet_position(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        win.set_position(Position::Logical(LogicalPosition::new(x, y)))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Read the pet window's current logical (x, y) — used by the JS drag handler
/// as the base position on mousedown.
#[tauri::command]
pub async fn get_pet_position(app: AppHandle) -> Result<serde_json::Value, String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        let scale = win.scale_factor().unwrap_or(1.0);
        if let Ok(pos) = win.outer_position() {
            // Return an object {x,y} — a Rust tuple would serialize to a JSON
            // array and the JS side's `.x` would be undefined (→ NaN → null).
            return Ok(serde_json::json!({
                "x": pos.x as f64 / scale,
                "y": pos.y as f64 / scale,
            }));
        }
    }
    Err("pet window not found".into())
}

/// The pet was clicked — surface & focus the main window.
#[tauri::command]
pub async fn pet_focus_main(app: AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
    Ok(())
}
