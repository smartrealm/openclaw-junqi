use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{
    AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
#[cfg(not(target_os = "macos"))]
use tauri::{LogicalPosition, LogicalSize, Position, Size};

pub const DYNAMIC_ISLAND_LABEL: &str = "dynamic-island";

const COMPACT_WIDTH: f64 = 286.0;
const COMPACT_HEIGHT: f64 = 48.0;
const EXPANDED_WIDTH: f64 = 420.0;
const EXPANDED_HEIGHT: f64 = 248.0;
const ANIMATION_FRAMES: u64 = 14;
const FRAME_DURATION_MS: u64 = 12;
#[cfg(target_os = "macos")]
const MACOS_STATUS_BAR_WINDOW_LEVEL: isize = 25;
#[cfg(target_os = "macos")]
const MACOS_SAFE_AREA_MARGIN: f64 = 8.0;

static ANIMATION_GENERATION: AtomicU64 = AtomicU64::new(0);
static LAST_MAIN_MONITOR: OnceLock<Mutex<Option<MonitorGeometry>>> = OnceLock::new();
static WINDOW_LIFECYCLE_GATE: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[derive(Clone, Copy, Debug, PartialEq)]
struct MonitorGeometry {
    scale_factor: f64,
    origin_x: i32,
    origin_y: i32,
    width: u32,
}

impl MonitorGeometry {
    fn from_monitor(monitor: &Monitor) -> Self {
        Self {
            scale_factor: monitor.scale_factor(),
            origin_x: monitor.position().x,
            origin_y: monitor.position().y,
            width: monitor.size().width,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct IslandFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    monitor_x: f64,
}

fn top_inset() -> f64 {
    if cfg!(target_os = "windows") {
        8.0
    } else {
        0.0
    }
}

fn frame_for_monitor(monitor: MonitorGeometry, width: f64, height: f64) -> IslandFrame {
    let scale = monitor.scale_factor;
    let logical_x = monitor.origin_x as f64 / scale;
    let logical_y = monitor.origin_y as f64 / scale;
    let logical_width = monitor.width as f64 / scale;

    IslandFrame {
        x: logical_x + ((logical_width - width) / 2.0).max(0.0),
        y: logical_y + top_inset(),
        width,
        height,
        monitor_x: logical_x,
    }
}

fn monitor_cache() -> &'static Mutex<Option<MonitorGeometry>> {
    LAST_MAIN_MONITOR.get_or_init(|| Mutex::new(None))
}

fn lifecycle_gate() -> &'static tokio::sync::Mutex<()> {
    WINDOW_LIFECYCLE_GATE.get_or_init(|| tokio::sync::Mutex::new(()))
}

fn cache_geometry(geometry: MonitorGeometry) -> MonitorGeometry {
    if let Ok(mut cached) = monitor_cache().lock() {
        *cached = Some(geometry);
    }
    geometry
}

pub fn remember_main_monitor(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window.current_monitor() {
        cache_geometry(MonitorGeometry::from_monitor(&monitor));
    }
}

fn preferred_monitor(app: &AppHandle) -> Result<MonitorGeometry, String> {
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            return Ok(cache_geometry(MonitorGeometry::from_monitor(&monitor)));
        }
    }

    if let Ok(cached) = monitor_cache().lock() {
        if let Some(geometry) = *cached {
            return Ok(geometry);
        }
    }

    app.primary_monitor()
        .map_err(|error| error.to_string())?
        .as_ref()
        .map(MonitorGeometry::from_monitor)
        .map(cache_geometry)
        .ok_or_else(|| "No monitor is available for the dynamic island".to_string())
}

fn target_frame(app: &AppHandle, expanded: bool) -> Result<IslandFrame, String> {
    let (width, height) = if expanded {
        (EXPANDED_WIDTH, EXPANDED_HEIGHT)
    } else {
        (COMPACT_WIDTH, COMPACT_HEIGHT)
    };
    Ok(frame_for_monitor(preferred_monitor(app)?, width, height))
}

#[cfg(not(target_os = "macos"))]
fn set_frame(window: &WebviewWindow, frame: IslandFrame) -> Result<(), String> {
    window
        .set_size(Size::Logical(LogicalSize::new(frame.width, frame.height)))
        .map_err(|error| error.to_string())?;
    window
        .set_position(Position::Logical(LogicalPosition::new(frame.x, frame.y)))
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn set_frame(window: &WebviewWindow, frame: IslandFrame) -> Result<(), String> {
    let ns_window = window.ns_window().map_err(|error| error.to_string())? as usize;
    window
        .run_on_main_thread(move || unsafe {
            use objc2::{class, msg_send, runtime::AnyObject, sel};
            use objc2_foundation::{NSPoint, NSRect, NSSize};

            let screens: *mut AnyObject = msg_send![class!(NSScreen), screens];
            let count: usize = msg_send![screens, count];
            if screens.is_null() || count == 0 {
                return;
            }
            let target_center_x = frame.monitor_x + frame.width / 2.0;
            let mut screen: *mut AnyObject = msg_send![screens, objectAtIndex: 0usize];
            for index in 0..count {
                let candidate: *mut AnyObject = msg_send![screens, objectAtIndex: index];
                let candidate_frame: NSRect = msg_send![candidate, frame];
                if target_center_x >= candidate_frame.origin.x
                    && target_center_x <= candidate_frame.origin.x + candidate_frame.size.width
                {
                    screen = candidate;
                    break;
                }
            }
            let screen_frame: NSRect = msg_send![screen, frame];
            let supports_safe_area: bool = msg_send![screen, respondsToSelector: sel!(safeAreaInsets)];
            let safe_top = if supports_safe_area {
                let insets: objc2_foundation::NSEdgeInsets = msg_send![screen, safeAreaInsets];
                insets.top
            } else {
                0.0
            };
            let cocoa_frame = NSRect::new(
                NSPoint::new(
                    screen_frame.origin.x + (screen_frame.size.width - frame.width) / 2.0,
                    screen_frame.origin.y + screen_frame.size.height - safe_top - MACOS_SAFE_AREA_MARGIN - frame.height,
                ),
                NSSize::new(frame.width, frame.height),
            );
            let ns_window = ns_window as *mut AnyObject;
            let _: () = msg_send![ns_window, setLevel: MACOS_STATUS_BAR_WINDOW_LEVEL];
            let _: () = msg_send![ns_window, setFrame: cocoa_frame, display: true];
        })
        .map_err(|error| error.to_string())
}

fn current_frame(window: &WebviewWindow) -> Result<IslandFrame, String> {
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    Ok(IslandFrame {
        x: position.x as f64 / scale,
        y: position.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        monitor_x: position.x as f64 / scale,
    })
}

fn ease_out_quint(value: f64) -> f64 {
    let value = value.clamp(0.0, 1.0);
    1.0 - (1.0 - value).powi(5)
}

fn interpolate(from: IslandFrame, to: IslandFrame, progress: f64) -> IslandFrame {
    let eased = ease_out_quint(progress.clamp(0.0, 1.0));
    let lerp = |start: f64, end: f64| start + (end - start) * eased;
    IslandFrame {
        x: lerp(from.x, to.x),
        y: lerp(from.y, to.y),
        width: lerp(from.width, to.width),
        height: lerp(from.height, to.height),
        monitor_x: lerp(from.monitor_x, to.monitor_x),
    }
}

fn animate_to(app: AppHandle, window: WebviewWindow, expanded: bool) -> Result<u64, String> {
    let from = current_frame(&window)?;
    let to = target_frame(&app, expanded)?;
    let generation = ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    tauri::async_runtime::spawn(async move {
        for frame_index in 1..=ANIMATION_FRAMES {
            if ANIMATION_GENERATION.load(Ordering::SeqCst) != generation {
                return;
            }
            let frame = interpolate(from, to, frame_index as f64 / ANIMATION_FRAMES as f64);
            if set_frame(&window, frame).is_err() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(FRAME_DURATION_MS)).await;
        }
        let _ = set_frame(&window, to);
    });
    Ok(generation)
}

#[tauri::command]
pub async fn open_dynamic_island(app: AppHandle) -> Result<(), String> {
    let _guard = lifecycle_gate().lock().await;
    ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(DYNAMIC_ISLAND_LABEL) {
        let frame = target_frame(&app, false)?;
        set_frame(&window, frame)?;
        window.show().map_err(|error| error.to_string())?;
        let _ = window.emit("dynamic-island:opened", ());
        return Ok(());
    }

    let frame = target_frame(&app, false)?;
    let window = WebviewWindowBuilder::new(
        &app,
        DYNAMIC_ISLAND_LABEL,
        WebviewUrl::App("index.html#/dynamic-island".into()),
    )
    .title("JunQi Dynamic Island")
    .inner_size(frame.width, frame.height)
    .position(frame.x, frame.y)
    .decorations(false)
    .transparent(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .shadow(false)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .closable(false)
    .focused(false)
    .accept_first_mouse(true)
    .visible(true)
    .build()
    .map_err(|error| format!("Failed to open dynamic island: {error}"))?;

    #[cfg(target_os = "macos")]
    {
        let _ = window.set_visible_on_all_workspaces(true);
    }

    set_frame(&window, frame)?;

    Ok(())
}

#[tauri::command]
pub async fn close_dynamic_island(app: AppHandle) -> Result<(), String> {
    let _guard = lifecycle_gate().lock().await;
    if let Some(window) = app.get_webview_window(DYNAMIC_ISLAND_LABEL) {
        let frame = current_frame(&window)?;
        if frame.height > COMPACT_HEIGHT + 8.0 {
            let generation = animate_to(app, window.clone(), false)?;
            tokio::time::sleep(Duration::from_millis(
                ANIMATION_FRAMES * FRAME_DURATION_MS + 24,
            ))
            .await;
            if ANIMATION_GENERATION.load(Ordering::SeqCst) != generation {
                return Ok(());
            }
        } else {
            ANIMATION_GENERATION.fetch_add(1, Ordering::SeqCst);
        }
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn toggle_dynamic_island(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(DYNAMIC_ISLAND_LABEL) {
        let visible = window.is_visible().map_err(|error| error.to_string())?;
        if visible {
            close_dynamic_island(app).await?;
            return Ok(false);
        }
    }
    open_dynamic_island(app).await?;
    Ok(true)
}

#[tauri::command]
pub async fn get_dynamic_island_visible(app: AppHandle) -> bool {
    app.get_webview_window(DYNAMIC_ISLAND_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn set_dynamic_island_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(DYNAMIC_ISLAND_LABEL)
        .ok_or_else(|| "Dynamic island window is not open".to_string())?;
    animate_to(app, window, expanded).map(|_| ())
}

#[tauri::command]
pub async fn set_dynamic_island_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    let window = app
        .get_webview_window(DYNAMIC_ISLAND_LABEL)
        .ok_or_else(|| "Dynamic island window is not open".to_string())?;
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reposition_dynamic_island(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(DYNAMIC_ISLAND_LABEL)
        .ok_or_else(|| "Dynamic island window is not open".to_string())?;
    let expanded = current_frame(&window)?.height > (COMPACT_HEIGHT + EXPANDED_HEIGHT) / 2.0;
    set_frame(&window, target_frame(&app, expanded)?)
}

#[tauri::command]
pub async fn dynamic_island_focus_main(
    app: AppHandle,
    route: Option<String>,
) -> Result<(), String> {
    if let Some(route) = route.as_deref() {
        if !route.starts_with('/') || route.len() > 256 || route.contains("..") {
            return Err("Invalid dynamic island route".to_string());
        }
        let _ = app.emit("dynamic-island:navigate", route);
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable".to_string())?;
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    main.set_focus().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interpolation_finishes_at_the_target_without_overshoot() {
        let from = IslandFrame {
            x: 40.0,
            y: 8.0,
            width: 286.0,
            height: 48.0,
            monitor_x: 40.0,
        };
        let to = IslandFrame {
            x: -20.0,
            y: 8.0,
            width: 420.0,
            height: 248.0,
            monitor_x: -20.0,
        };
        assert_eq!(interpolate(from, to, 0.0), from);
        assert_eq!(interpolate(from, to, 1.0), to);
        let middle = interpolate(from, to, 0.5);
        assert!(middle.x >= to.x && middle.x <= from.x);
        assert!(middle.width >= from.width && middle.width <= to.width);
        assert!(middle.height >= from.height && middle.height <= to.height);
    }

    #[test]
    fn easing_is_monotonic_and_clamped() {
        assert_eq!(ease_out_quint(-1.0), 0.0);
        assert_eq!(ease_out_quint(1.0), 1.0);
        assert!(ease_out_quint(0.25) < ease_out_quint(0.5));
        assert!(ease_out_quint(0.5) < ease_out_quint(0.75));
    }

    #[test]
    fn secondary_monitor_geometry_keeps_negative_origin_and_scale() {
        let monitor = MonitorGeometry {
            scale_factor: 1.5,
            origin_x: -2560,
            origin_y: 120,
            width: 2560,
        };
        let frame = frame_for_monitor(monitor, COMPACT_WIDTH, COMPACT_HEIGHT);
        assert_eq!(frame.y, 80.0 + top_inset());
        assert!(frame.x < 0.0);
        let logical_left = monitor.origin_x as f64 / monitor.scale_factor;
        let logical_width = monitor.width as f64 / monitor.scale_factor;
        assert_eq!(
            frame.x,
            logical_left + (logical_width - COMPACT_WIDTH) / 2.0
        );
    }

    #[test]
    fn screen_edge_anchor_stays_at_the_monitor_top() {
        let monitor = MonitorGeometry {
            scale_factor: 2.0,
            origin_x: 0,
            origin_y: 0,
            width: 3600,
        };
        let frame = frame_for_monitor(monitor, COMPACT_WIDTH, COMPACT_HEIGHT);
        assert_eq!(frame.y, top_inset());
    }
}
