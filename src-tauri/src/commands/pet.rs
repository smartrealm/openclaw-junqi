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
    webview::Color, AppHandle, Emitter, LogicalPosition, Manager, Position, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
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

    let mut builder =
        WebviewWindowBuilder::new(&app, PET_LABEL, WebviewUrl::App("index.html".into()))
            .title("JunQi Pet")
            .inner_size(108.0, 154.0)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .decorations(false)
            .transparent(true)
            .background_color(Color(0, 0, 0, 0))
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

    // The pet is a real drop target, not just a visual follower. Route drops
    // through the same QuickChat pipeline as the main window.
    let app_for_drop = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::DragDrop(drop_event) = event {
            match drop_event {
                tauri::DragDropEvent::Enter { paths, .. } => {
                    crate::commands::quickchat::ResourceDropCoordinator::enter(
                        &app_for_drop,
                        paths,
                    );
                    crate::commands::quickchat::ResourceDropCoordinator::set_over_pet(
                        &app_for_drop,
                        true,
                    );
                }
                tauri::DragDropEvent::Over { .. } => {
                    crate::commands::quickchat::ResourceDropCoordinator::set_over_pet(
                        &app_for_drop,
                        true,
                    );
                }
                tauri::DragDropEvent::Leave => {
                    crate::commands::quickchat::ResourceDropCoordinator::leave(&app_for_drop);
                }
                tauri::DragDropEvent::Drop { paths, .. } => {
                    crate::commands::quickchat::ResourceDropCoordinator::drop(&app_for_drop, paths);
                }
                _ => {}
            }
        }
    });

    // Persist drag position: when the user moves the pet, broadcast the new
    // logical position so the pet webview (an independent window) can store it
    // for restore on the next launch.
    // The window can cross monitors with different DPI. Capturing the scale
    // factor here would make persisted coordinates drift on Windows after a
    // cross-monitor drag, so resolve it for each move event instead.
    let win_for_move = win.clone();
    let app_for_move = app.clone();
    win.on_window_event(move |event| {
        if let WindowEvent::Moved(pos) = event {
            let scale = win_for_move.scale_factor().unwrap_or(1.0);
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
            let _ = app.emit("pet-visibility", serde_json::json!({ "visible": false }));
            return Ok(false);
        }
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("pet-visibility", serde_json::json!({ "visible": true }));
        return Ok(true);
    }
    open_pet_window(app).await?;
    Ok(true)
}

/// Toggle mouse pass-through on the pet window. Current UX keeps the pet
/// interactive by default so dragging/double-click/context-menu stay reliable;
/// `ignore=true` remains available for future temporary pass-through modes.
#[tauri::command]
pub async fn set_pet_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_LABEL) {
        win.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
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

/// Hand window movement over to the OS compositor. This is substantially
/// smoother than issuing one IPC set_position call for every pointer event.
#[tauri::command]
pub async fn start_pet_dragging(app: AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(PET_LABEL)
        .ok_or("pet window not found")?;
    win.start_dragging().map_err(|e| e.to_string())?;
    app.emit_to(PET_LABEL, "pet-drag-ended", ())
        .map_err(|e| e.to_string())
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
    // Any live window can report the global cursor position (it's desktop-
    // global, window-independent).
    let win = app
        .get_webview_window(PET_LABEL)
        .or_else(|| app.get_webview_window("main"))
        .ok_or("no window available")?;
    let pos = win.cursor_position().map_err(|e| e.to_string())?;
    // Convert the global PHYSICAL cursor to logical using the scale of the
    // monitor the CURSOR is on — NOT the pet's. On a single display these are
    // identical (zero change); on a multi-monitor setup with mixed DPI, using
    // the pet's scale would skew the coords and the chase would drift. Fall
    // back to the pet window's own scale if the point isn't on any monitor.
    let scale = win
        .monitor_from_point(pos.x, pos.y)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or_else(|| win.scale_factor().unwrap_or(1.0));
    Ok(serde_json::json!({ "x": pos.x / scale, "y": pos.y / scale }))
}

/// Logical bounds {monX, monY, monW, monH} of the monitor the pet currently
/// sits on — used by the frontend to magnetic-snap the pet to the nearest edge
/// after a drag.
#[tauri::command]
pub async fn get_pet_bounds(app: AppHandle) -> Result<serde_json::Value, String> {
    let win = app
        .get_webview_window(PET_LABEL)
        .ok_or("pet window not found")?;
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
                &MenuItem::with_id(
                    &app,
                    item.kind.clone(),
                    item.label,
                    !item.disabled,
                    None::<&str>,
                )
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
const MAX_PET_SPRITESHEET_BYTES: u64 = 20 * 1024 * 1024;
const PET_PACKAGE_DIR: &str = "pet-package";

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetPackageManifest {
    id: String,
    display_name: String,
    description: String,
    sprite_version_number: u8,
    spritesheet_path: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPetPackage {
    id: String,
    display_name: String,
    description: String,
    sprite_version_number: u8,
    spritesheet_data_url: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailablePetPackage {
    id: String,
    display_name: String,
    description: String,
    manifest_path: String,
}

#[derive(Debug)]
enum PetPackageValidationError {
    ManifestUnreadable,
    ManifestInvalid,
    UnsupportedVersion,
    MissingIdentity,
    UnsafeSpritesheetPath,
    UnsupportedSpritesheetFormat,
    SpritesheetUnavailable,
    SpritesheetTooLarge,
    SpritesheetUndecodable,
    WrongDimensions { width: u32, height: u32 },
    EmptyCell { row: usize, column: usize },
    ReservedCellVisible { row: usize, column: usize },
}

impl PetPackageValidationError {
    fn localized(&self, locale: Option<&str>) -> String {
        let english = locale.unwrap_or("zh").starts_with("en");
        match (self, english) {
            (Self::ManifestUnreadable, true) => "Unable to read pet.json".into(),
            (Self::ManifestUnreadable, false) => "无法读取 pet.json".into(),
            (Self::ManifestInvalid, true) => "pet.json is invalid".into(),
            (Self::ManifestInvalid, false) => "pet.json 格式错误".into(),
            (Self::UnsupportedVersion, true) => {
                "Only spriteVersionNumber: 2 animated pet packages are supported".into()
            }
            (Self::UnsupportedVersion, false) => {
                "仅支持 spriteVersionNumber: 2 的动画萌宠包".into()
            }
            (Self::MissingIdentity, true) => "pet.json must include id and displayName".into(),
            (Self::MissingIdentity, false) => "pet.json 必须包含 id 和 displayName".into(),
            (Self::UnsafeSpritesheetPath, true) => {
                "spritesheetPath must be relative to the pet package directory".into()
            }
            (Self::UnsafeSpritesheetPath, false) => {
                "spritesheetPath 必须是萌宠目录内的相对路径".into()
            }
            (Self::UnsupportedSpritesheetFormat, true) => {
                "The spritesheet must be PNG or WebP".into()
            }
            (Self::UnsupportedSpritesheetFormat, false) => "动画图集必须是 PNG 或 WebP".into(),
            (Self::SpritesheetUnavailable, true) => "Unable to read the spritesheet".into(),
            (Self::SpritesheetUnavailable, false) => "无法读取动画图集".into(),
            (Self::SpritesheetTooLarge, true) => "The spritesheet is empty or exceeds 20MB".into(),
            (Self::SpritesheetTooLarge, false) => "动画图集为空或超过 20MB".into(),
            (Self::SpritesheetUndecodable, true) => "Unable to decode the spritesheet".into(),
            (Self::SpritesheetUndecodable, false) => "无法解码动画图集".into(),
            (Self::WrongDimensions { width, height }, true) => {
                format!("A v2 spritesheet must be 1536x2288; received {width}x{height}")
            }
            (Self::WrongDimensions { width, height }, false) => {
                format!("v2 动画图集尺寸必须是 1536x2288，当前为 {width}x{height}")
            }
            (Self::EmptyCell { row, column }, true) => {
                format!("Required atlas cell row {row}, column {column} is empty")
            }
            (Self::EmptyCell { row, column }, false) => {
                format!("动画图集第 {row} 行第 {column} 格为空")
            }
            (Self::ReservedCellVisible { row, column }, true) => {
                format!("Reserved atlas cell row {row}, column {column} must be transparent")
            }
            (Self::ReservedCellVisible { row, column }, false) => {
                format!("动画图集第 {row} 行第 {column} 个保留格必须透明")
            }
        }
    }
}

fn pet_package_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(PET_PACKAGE_DIR))
}

/// Transactional directory swap used by pet-package installation. An existing
/// package is first moved aside and restored if committing the staged package
/// fails, so a failed import never destroys the currently working pet.
struct DirectorySwap;

impl DirectorySwap {
    fn commit(staging: &std::path::Path, target: &std::path::Path) -> std::io::Result<()> {
        let backup = target.with_extension(format!("backup-{}", uuid::Uuid::new_v4()));
        let had_target = target.exists();
        if had_target {
            std::fs::rename(target, &backup)?;
        }

        if let Err(error) = std::fs::rename(staging, target) {
            if had_target {
                let _ = std::fs::rename(&backup, target);
            }
            return Err(error);
        }

        if had_target {
            let _ = std::fs::remove_dir_all(backup);
        }
        Ok(())
    }
}

fn pet_install_error(
    locale: Option<&str>,
    zh: &str,
    en: &str,
    error: impl std::fmt::Display,
) -> String {
    if locale.unwrap_or("zh").starts_with("en") {
        format!("{en}: {error}")
    } else {
        format!("{zh}：{error}")
    }
}

fn validate_pet_manifest(
    manifest_path: &std::path::Path,
) -> Result<(PetPackageManifest, std::path::PathBuf, &'static str), PetPackageValidationError> {
    let raw = std::fs::read_to_string(manifest_path)
        .map_err(|_| PetPackageValidationError::ManifestUnreadable)?;
    let manifest: PetPackageManifest =
        serde_json::from_str(&raw).map_err(|_| PetPackageValidationError::ManifestInvalid)?;
    if manifest.sprite_version_number != 2 {
        return Err(PetPackageValidationError::UnsupportedVersion);
    }
    if manifest.id.trim().is_empty() || manifest.display_name.trim().is_empty() {
        return Err(PetPackageValidationError::MissingIdentity);
    }
    let relative = std::path::Path::new(&manifest.spritesheet_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(PetPackageValidationError::UnsafeSpritesheetPath);
    }
    let parent = manifest_path
        .parent()
        .ok_or(PetPackageValidationError::ManifestUnreadable)?;
    let spritesheet = parent.join(relative);
    let extension = spritesheet
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "webp" => "image/webp",
        _ => return Err(PetPackageValidationError::UnsupportedSpritesheetFormat),
    };
    let metadata = std::fs::metadata(&spritesheet)
        .map_err(|_| PetPackageValidationError::SpritesheetUnavailable)?;
    if metadata.len() == 0 || metadata.len() > MAX_PET_SPRITESHEET_BYTES {
        return Err(PetPackageValidationError::SpritesheetTooLarge);
    }
    let decoded = image::ImageReader::open(&spritesheet)
        .map_err(|_| PetPackageValidationError::SpritesheetUnavailable)?
        .with_guessed_format()
        .map_err(|_| PetPackageValidationError::SpritesheetUndecodable)?
        .decode()
        .map_err(|_| PetPackageValidationError::SpritesheetUndecodable)?;
    let (width, height) = (decoded.width(), decoded.height());
    if (width, height) != (1536, 2288) {
        return Err(PetPackageValidationError::WrongDimensions { width, height });
    }
    let rgba = decoded.to_rgba8();
    const USED_COLUMNS: [usize; 11] = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
    for (row, used_columns) in USED_COLUMNS.into_iter().enumerate() {
        for column in 0..8 {
            let mut has_visible_pixel = false;
            for y in (row * 208)..((row + 1) * 208) {
                for x in (column * 192)..((column + 1) * 192) {
                    if rgba.get_pixel(x as u32, y as u32).0[3] != 0 {
                        has_visible_pixel = true;
                        break;
                    }
                }
                if has_visible_pixel {
                    break;
                }
            }
            if column < used_columns && !has_visible_pixel {
                return Err(PetPackageValidationError::EmptyCell { row, column });
            }
            if column >= used_columns && has_visible_pixel {
                return Err(PetPackageValidationError::ReservedCellVisible { row, column });
            }
        }
    }
    Ok((manifest, spritesheet, mime))
}

fn loaded_pet_package(
    manifest: PetPackageManifest,
    spritesheet: &std::path::Path,
    mime: &str,
) -> Result<LoadedPetPackage, String> {
    use base64::{engine::general_purpose, Engine};
    let data = std::fs::read(spritesheet).map_err(|e| format!("读取动画图集失败：{e}"))?;
    Ok(LoadedPetPackage {
        id: manifest.id,
        display_name: manifest.display_name,
        description: manifest.description,
        sprite_version_number: 2,
        spritesheet_data_url: format!(
            "data:{mime};base64,{}",
            general_purpose::STANDARD.encode(data)
        ),
    })
}

/// Import a validated JunQi v2 pet package. The selected path must
/// be the package's pet.json; its sibling spritesheet is copied atomically.
#[tauri::command]
pub async fn import_pet_package(
    app: AppHandle,
    manifest_path: String,
    locale: Option<String>,
) -> Result<LoadedPetPackage, String> {
    let source_manifest = std::path::Path::new(&manifest_path);
    let (mut manifest, source_spritesheet, mime) = validate_pet_manifest(source_manifest)
        .map_err(|error| error.localized(locale.as_deref()))?;
    let locale = locale.as_deref();
    let target = pet_package_dir(&app)?;
    let staging = target.with_extension(format!("staging-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging).map_err(|e| {
        pet_install_error(
            locale,
            "创建萌宠目录失败",
            "Unable to create pet directory",
            e,
        )
    })?;
    let extension = source_spritesheet
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("webp");
    let target_sheet_name = format!("spritesheet.{extension}");
    let staged_sheet = staging.join(&target_sheet_name);
    if let Err(error) = std::fs::copy(&source_spritesheet, &staged_sheet) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(pet_install_error(
            locale,
            "复制动画图集失败",
            "Unable to copy spritesheet",
            error,
        ));
    }
    manifest.spritesheet_path = target_sheet_name;
    let staged_manifest = staging.join("pet.json");
    if let Err(error) = std::fs::write(
        &staged_manifest,
        serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
    ) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(pet_install_error(
            locale,
            "写入 pet.json 失败",
            "Unable to write pet.json",
            error,
        ));
    }

    // Validate the copied package, not only the source selected by the user.
    if let Err(error) = validate_pet_manifest(&staged_manifest) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error.localized(locale));
    }
    DirectorySwap::commit(&staging, &target)
        .map_err(|e| pet_install_error(locale, "安装萌宠失败", "Unable to install pet", e))?;
    let _ = clear_pet_asset(app.clone()).await;
    let installed_sheet = target.join(&manifest.spritesheet_path);
    let loaded = loaded_pet_package(manifest, &installed_sheet, mime)?;
    let _ = app.emit("pet-package-changed", ());
    Ok(loaded)
}

#[tauri::command]
pub async fn load_pet_package(app: AppHandle) -> Result<Option<LoadedPetPackage>, String> {
    let manifest_path = pet_package_dir(&app)?.join("pet.json");
    if !manifest_path.exists() {
        return Ok(None);
    }
    let (manifest, spritesheet, mime) =
        validate_pet_manifest(&manifest_path).map_err(|error| error.localized(None))?;
    loaded_pet_package(manifest, &spritesheet, mime).map(Some)
}

#[tauri::command]
pub async fn clear_pet_package(app: AppHandle) -> Result<(), String> {
    let target = pet_package_dir(&app)?;
    if target.exists() {
        std::fs::remove_dir_all(target).map_err(|e| format!("清除动画萌宠失败：{e}"))?;
    }
    let _ = app.emit("pet-package-changed", ());
    Ok(())
}

#[tauri::command]
pub async fn list_pet_packages() -> Result<Vec<AvailablePetPackage>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(Vec::new());
    };
    let root = home.join(".junqi").join("pets");
    let Ok(entries) = std::fs::read_dir(root) else {
        return Ok(Vec::new());
    };
    let mut packages = Vec::new();
    for entry in entries.flatten() {
        let manifest_path = entry.path().join("pet.json");
        if !manifest_path.is_file() {
            continue;
        }
        let Ok((manifest, _, _)) = validate_pet_manifest(&manifest_path) else {
            continue;
        };
        packages.push(AvailablePetPackage {
            id: manifest.id,
            display_name: manifest.display_name,
            description: manifest.description,
            manifest_path: manifest_path.to_string_lossy().into_owned(),
        });
    }
    packages.sort_by(|left, right| left.display_name.cmp(&right.display_name));
    Ok(packages)
}

/// Promote the newest validated JunQi-generated package into the active pet
/// slot. A chat-created `@hatch-pet` package lands in `~/.junqi/pets`; this
/// closes the loop without making the floating window parse arbitrary paths.
#[tauri::command]
pub async fn activate_latest_pet_package(
    app: AppHandle,
    newer_than_unix_ms: Option<i64>,
) -> Result<Option<LoadedPetPackage>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(None);
    };
    let root = home.join(".junqi").join("pets");
    let Ok(entries) = std::fs::read_dir(root) else {
        return Ok(None);
    };

    let latest = entries
        .flatten()
        .filter_map(|entry| {
            let manifest_path = entry.path().join("pet.json");
            if !manifest_path.is_file() || validate_pet_manifest(&manifest_path).is_err() {
                return None;
            }
            let modified = std::fs::metadata(&manifest_path)
                .and_then(|metadata| metadata.modified())
                .ok()?;
            if let Some(after) = newer_than_unix_ms {
                let modified_ms = modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()?
                    .as_millis() as i64;
                if modified_ms <= after {
                    return None;
                }
            }
            Some((modified, manifest_path))
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, manifest_path)| manifest_path);

    let Some(manifest_path) = latest else {
        return Ok(None);
    };
    import_pet_package(app, manifest_path.to_string_lossy().into_owned(), None)
        .await
        .map(Some)
}

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
        return Err(format!(
            "File too large — max is {} KB",
            MAX_PET_ASSET_BYTES / 1024
        ));
    }
    let data = std::fs::read(path).map_err(|e| format!("Read failed: {e}"))?;

    // A legacy single image and a v2 package are mutually exclusive.
    clear_pet_package(app.clone()).await?;
    // Clear any previous asset first (may have a different extension).
    let _ = clear_pet_asset(app.clone()).await;

    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!("pet-asset.{ext}"));
    std::fs::write(&dest, &data).map_err(|e| format!("Write failed: {e}"))?;
    // Tell the pet window to reload its asset.
    let _ = app.emit("pet-asset-changed", ());

    Ok(format!(
        "data:{};base64,{}",
        image_mime(&ext),
        general_purpose::STANDARD.encode(&data)
    ))
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
            let ext = p
                .extension()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
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

#[cfg(test)]
mod pet_package_tests {
    use super::*;

    fn write_package(width: u32, height: u32, version: u8) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("junqi-pet-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let sheet = dir.join("spritesheet.png");
        let mut atlas = image::RgbaImage::new(width, height);
        if (width, height) == (1536, 2288) {
            const USED_COLUMNS: [usize; 11] = [6, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
            for (row, count) in USED_COLUMNS.into_iter().enumerate() {
                for column in 0..count {
                    atlas.put_pixel(
                        (column * 192 + 96) as u32,
                        (row * 208 + 104) as u32,
                        image::Rgba([255, 255, 255, 255]),
                    );
                }
            }
        }
        atlas.save(&sheet).unwrap();
        let manifest = serde_json::json!({
            "id": "test-pet",
            "displayName": "Test Pet",
            "description": "test",
            "spriteVersionNumber": version,
            "spritesheetPath": "spritesheet.png"
        });
        let manifest_path = dir.join("pet.json");
        std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
        manifest_path
    }

    #[test]
    fn accepts_junqi_v2_atlas_dimensions() {
        let manifest = write_package(1536, 2288, 2);
        let result = validate_pet_manifest(&manifest);
        assert!(result.is_ok());
        let _ = std::fs::remove_dir_all(manifest.parent().unwrap());
    }

    #[test]
    fn rejects_wrong_version_or_dimensions() {
        let v1 = write_package(1536, 2288, 1);
        assert!(matches!(
            validate_pet_manifest(&v1).unwrap_err(),
            PetPackageValidationError::UnsupportedVersion
        ));
        let _ = std::fs::remove_dir_all(v1.parent().unwrap());

        let wrong_size = write_package(1536, 1872, 2);
        assert!(matches!(
            validate_pet_manifest(&wrong_size).unwrap_err(),
            PetPackageValidationError::WrongDimensions { .. }
        ));
        let _ = std::fs::remove_dir_all(wrong_size.parent().unwrap());
    }

    #[test]
    fn rejects_visible_pixels_in_reserved_cells() {
        let manifest = write_package(1536, 2288, 2);
        let sheet = manifest.parent().unwrap().join("spritesheet.png");
        let mut atlas = image::open(&sheet).unwrap().to_rgba8();
        atlas.put_pixel(7 * 192 + 96, 104, image::Rgba([255, 0, 0, 255]));
        atlas.save(&sheet).unwrap();
        assert!(matches!(
            validate_pet_manifest(&manifest).unwrap_err(),
            PetPackageValidationError::ReservedCellVisible { .. }
        ));
        let _ = std::fs::remove_dir_all(manifest.parent().unwrap());
    }

    #[test]
    fn validation_errors_are_localized_without_string_matching() {
        let error = PetPackageValidationError::WrongDimensions {
            width: 100,
            height: 200,
        };
        assert!(error.localized(Some("zh-CN")).contains("当前为 100x200"));
        assert!(error.localized(Some("en")).contains("received 100x200"));
    }

    #[test]
    fn directory_swap_replaces_an_existing_package() {
        let root = std::env::temp_dir().join(format!("junqi-pet-swap-{}", uuid::Uuid::new_v4()));
        let target = root.join("pet-package");
        let staging = root.join("pet-package-staging");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&staging).unwrap();
        std::fs::write(target.join("version"), "old").unwrap();
        std::fs::write(staging.join("version"), "new").unwrap();

        DirectorySwap::commit(&staging, &target).unwrap();

        assert_eq!(
            std::fs::read_to_string(target.join("version")).unwrap(),
            "new"
        );
        assert!(!staging.exists());
        let _ = std::fs::remove_dir_all(root);
    }
}
