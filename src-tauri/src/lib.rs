mod commands;
mod paths;
mod platform;
mod state;
mod tray;

use state::GatewayProcess;
use tauri::{Emitter, Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Remembers window size/position across launches (auto-restores on start,
        // auto-saves on exit). First-launch sizing is handled in setup() below.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(GatewayProcess::new())
        .invoke_handler(tauri::generate_handler![
            // Gateway
            commands::gateway::start_gateway,
            commands::gateway::stop_gateway,
            commands::gateway::gateway_status,
            commands::gateway::probe_gateway_port,
            commands::gateway::get_gateway_token,
            commands::gateway::run_doctor,
            // System
            commands::system::get_platform_info,
            commands::system::check_node,
            commands::system::check_git,
            commands::system::check_openclaw,
            commands::system::open_folder,
            // Screenshot
            commands::screenshot::screenshot_check_permission,
            commands::screenshot::screenshot_interactive,
            commands::screenshot::screenshot_fullscreen,
            commands::screenshot::screenshot_list_windows,
            commands::screenshot::screenshot_capture_window,
            // Voice
            commands::voice::voice_start_recording,
            commands::voice::voice_stop_recording,
            commands::voice::voice_is_recording,
            // Setup
            commands::setup::install_node,
            commands::setup::install_git,
            commands::setup::install_openclaw,
            commands::setup::install_winget_package,
            // Control UI (Console)
           commands::console::open_control_ui,
           commands::console::return_to_desktop,
            commands::managed_files::managed_file_open,
            commands::managed_files::managed_file_reveal,
            commands::managed_files::managed_file_exists,

            commands::console::write_models_log,
            // Config
            commands::config::read_config,
            commands::config::write_config,
            commands::config::read_provider_api_key,
            commands::config::detect_gateway_config,
            // Pairing
            commands::pairing::list_pairing_requests,
            commands::pairing::approve_pairing_request,
            commands::pairing::reject_pairing_request,
            // Docker
            commands::docker::check_docker,
            commands::docker::pull_openclaw_image,
            commands::docker::start_docker_gateway,
            commands::docker::stop_docker_gateway,
            commands::docker::docker_gateway_status,
            // Desktop Pet (companion)
            commands::pet::emit_pet_state,
            commands::pet::open_pet_window,
            commands::pet::close_pet_window,
            commands::pet::toggle_pet_window,
            commands::pet::set_pet_click_through,
            commands::pet::set_pet_position,
            commands::pet::get_pet_position,
            commands::pet::get_pet_bounds,
            commands::pet::get_pet_visible,
            commands::pet::pet_focus_main,
            commands::pet::save_pet_asset,
            commands::pet::load_pet_asset,
            commands::pet::clear_pet_asset,
            commands::pet::pet_show_context_menu,
        ])
        .setup(|app| {
            // Desktop-pet mode on macOS: keep JunQi out of the Dock entirely
            // (Accessory activation policy). The main window + pet window still
            // display normally; the tray icon and double-clicking the pet are
            // the entry points — no Dock tile, no Cmd+Tab entry.
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            // macOS: apply native vibrancy so the frosted/transparent CSS layers
            // (Context bar, input area, message regions) bleed the desktop material
            // through instead of a flat solid color.
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
            }
            // First launch only: size the window to ~80% of the primary monitor and
            // center it. On later launches the window-state plugin restores the user's
            // last size/position, so we must NOT override it. A marker file under the
            // app dir distinguishes first run from subsequent ones.
            let first_run_marker = paths::desktop_dir().join(".junqi-window-initialized");
            if !first_run_marker.exists() {
                if let Some(window) = app.get_webview_window("main") {
                    if let (Ok(Some(monitor)), Ok(scale)) = (window.primary_monitor(), window.scale_factor()) {
                        let phys = monitor.size();
                        // Convert physical → logical so the 78%/82% ratio is correct on HiDPI.
                        let w = (phys.width as f64) * 0.78 / scale;
                        let h = (phys.height as f64) * 0.82 / scale;
                        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }));
                    }
                    let _ = window.center();
                }
                if let Some(parent) = first_run_marker.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                // Non-critical: if the marker can't be written, we re-apply default
                // sizing next launch — harmless.
                let _ = std::fs::write(&first_run_marker, "1");
            }
            // Emit gateway config to frontend before it loads (no invoke needed)
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(info) = commands::config::detect_gateway_config().await {
                    let _ = handle.emit("gateway-config", serde_json::json!({
                        "token": info.token,
                        "ws_url": info.ws_url,
                        "http_url": info.http_url,
                        "port": info.port,
                    }));
                }
            });
            // Pet right-click menu items report their kind here; the main window
            // acts on the "pet-action" event. Tray items have their own handler,
            // so this fires only for the pet's popup context menu.
            app.on_menu_event(move |app, event| {
                let id = event.id().as_ref();
                if matches!(id, "showMain" | "hide" | "nextSkin" | "pomoStart" | "pomoPause" | "pomoStop") {
                    let _ = app.emit("pet-action", serde_json::json!({ "kind": id }));
                }
            });
            tray::menu::setup_tray(app)?;
            // Start system metrics background thread (Nezha-style state stream)
            commands::system_metrics::start_metrics_stream(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            // Kill the gateway child process on app exit
            let state = app_handle.state::<GatewayProcess>();
            if let Ok(mut child_lock) = state.child.lock() {
                if let Some(ref mut child) = *child_lock {
                    let _ = child.start_kill();
                }
                *child_lock = None;
            };
        }
    });
}
