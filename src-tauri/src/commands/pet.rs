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

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
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
        let _ = app.emit("pet-visibility", serde_json::json!({ "visible": true }));
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(&app, PET_LABEL, WebviewUrl::App("index.html".into()))
        .title("JunQi Pet")
        .inner_size(108.0, 154.0)
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
            let x = (logical_w - 130.0).max(20.0);
            let y = (logical_h - 184.0).max(20.0);
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

    let _ = app.emit("pet-visibility", serde_json::json!({ "visible": true }));
    Ok(())
}

#[tauri::command]
pub async fn close_pet_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        let _ = win.hide();
    }
    let _ = app.emit("pet-visibility", serde_json::json!({ "visible": false }));
    Ok(())
}

/// Current visibility of the pet window — used by the settings-page recall
/// button to label itself "Show" vs "Hide".
#[tauri::command]
pub async fn get_pet_visible(app: AppHandle) -> bool {
    app.get_webview_window(PET_LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
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

/// The OS cursor's GLOBAL position in logical coords {x,y}.
///
/// The window-level `DragDropEvent::Over` only fires while the cursor is inside
/// the main window, so it can't drive a whole-screen chase. During a drag the
/// pet polls this instead: `cursor_position()` is desktop-global, so the pet
/// can follow the payload anywhere on screen (incl. outside every app window).
#[tauri::command]
pub async fn get_cursor_position(app: AppHandle) -> Result<serde_json::Value, String> {
    // Any live window can report the global cursor; prefer the pet's own so the
    // scale factor matches the monitor it (and usually the cursor) sits on.
    let win = app
        .get_webview_window(PET_LABEL)
        .or_else(|| app.get_webview_window("main"))
        .ok_or("no window available")?;
    let scale = win.scale_factor().unwrap_or(1.0);
    let pos = win.cursor_position().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "x": pos.x / scale, "y": pos.y / scale }))
}

/// Logical bounds {monX, monY, monW, monH} of the monitor the pet currently
/// sits on — used by the frontend to magnetic-snap the pet to the nearest edge
/// after a drag.
#[tauri::command]
pub async fn get_pet_bounds(app: AppHandle) -> Result<serde_json::Value, String> {
    let win = app.get_webview_window(PET_LABEL).ok_or("pet window not found")?;
    let mon = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("no monitor")?;
    let scale = mon.scale_factor();
    let pos = mon.position();
    let size = mon.size();
    Ok(serde_json::json!({
        "monX": pos.x as f64 / scale,
        "monY": pos.y as f64 / scale,
        "monW": size.width as f64 / scale,
        "monH": size.height as f64 / scale,
    }))
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

// ── Right-click context menu ────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct PetMenuItem {
    kind: String,
    label: String,
    #[serde(default)]
    disabled: bool,
}

/// Pop up the pet's right-click context menu at a physical screen position.
/// Item labels + kinds come from the frontend (i18n stays in JS); on click the
/// `app.on_menu_event` handler registered in `lib.rs` re-emits the item's kind
/// as a "pet-action" event for the main window to act on.
#[tauri::command]
pub async fn pet_show_context_menu(app: AppHandle, items: Vec<PetMenuItem>) -> Result<(), String> {
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    for item in items {
        if item.kind == "sep" {
            menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        } else {
            menu.append(
                &MenuItem::with_id(&app, item.kind.clone(), item.label, !item.disabled, None::<&str>)
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    // Pop up at the cursor (which is exactly where the user right-clicked);
    // avoids any screen↔window / HiDPI coordinate math.
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        win.popup_menu(&menu).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Custom asset (user-uploaded pet skin) ───────────────────────────────────

/// Max size for an uploaded pet asset. Keeps localStorage / IPC payloads sane.
const MAX_PET_ASSET_BYTES: usize = 2 * 1024 * 1024; // 2 MB

fn image_mime(ext: &str) -> &'static str {
    match ext {
        "svg" => "image/svg+xml",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "jpg" | "jpeg" => "image/jpeg",
        _ => "image/png",
    }
}

/// Copy a user-chosen file into the app data dir as the pet's custom skin.
/// `src_path` comes from a Tauri file dialog; size + extension are validated
/// here. Returns the asset as a data URL so the frontend can render directly.
#[tauri::command]
pub async fn save_pet_asset(app: AppHandle, src_path: String) -> Result<String, String> {
    use base64::{engine::general_purpose, Engine};

    let path = std::path::Path::new(&src_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    const ALLOWED: [&str; 5] = ["png", "jpg", "jpeg", "gif", "webp"];
    if !ALLOWED.contains(&ext.as_str()) {
        return Err(format!("Unsupported file type: .{ext}"));
    }
    let meta = std::fs::metadata(path).map_err(|e| format!("Cannot read file: {e}"))?;
    if (meta.len() as usize) > MAX_PET_ASSET_BYTES {
        return Err(format!("File too large — max is {} KB", MAX_PET_ASSET_BYTES / 1024));
    }
    let data = std::fs::read(path).map_err(|e| format!("Read failed: {e}"))?;

    // Clear any previous asset first (may have a different extension).
    let _ = clear_pet_asset(app.clone()).await;

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("pet-asset.{ext}"));
    std::fs::write(&dest, &data).map_err(|e| format!("Write failed: {e}"))?;
    // Tell the pet window to reload its asset.
    let _ = app.emit("pet-asset-changed", ());

    Ok(format!("data:{};base64,{}", image_mime(&ext), general_purpose::STANDARD.encode(&data)))
}

/// Load the current custom pet asset as a data URL (None if none is set).
#[tauri::command]
pub async fn load_pet_asset(app: AppHandle) -> Result<Option<String>, String> {
    use base64::{engine::general_purpose, Engine};
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.file_stem().and_then(|s| s.to_str()) != Some("pet-asset") {
                continue;
            }
            let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
            let data = std::fs::read(&p).map_err(|e| e.to_string())?;
            return Ok(Some(format!(
                "data:{};base64,{}",
                image_mime(&ext),
                general_purpose::STANDARD.encode(&data)
            )));
        }
    }
    Ok(None)
}

/// Remove the custom pet asset (revert to the built-in skin).
#[tauri::command]
pub async fn clear_pet_asset(app: AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.file_stem().and_then(|s| s.to_str()) == Some("pet-asset") {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
    let _ = app.emit("pet-asset-changed", ());
    Ok(())
}
