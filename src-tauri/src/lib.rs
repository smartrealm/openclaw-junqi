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
            commands::gateway::restart_gateway,
            commands::gateway::restart_local_gateway,
            commands::gateway::stop_gateway,
            commands::gateway::gateway_status,
            commands::gateway::probe_gateway_port,
            commands::gateway_logs::get_gateway_logs,
            commands::gateway_logs::clear_gateway_logs,
            commands::ensure::ensure_gateway_running,
            commands::gateway_supervisor::openclaw_doctor_repair,
            commands::gateway_supervisor::get_gateway_lifecycle,
            commands::secret_store::store_provider_secret,
            commands::secret_store::get_provider_secret,
            commands::secret_store::delete_provider_secret,
            commands::secret_store::list_provider_secrets,
            commands::session_labels::load_session_labels,
            commands::session_labels::upsert_session_label,
            commands::provider_oauth::start_provider_oauth,
            commands::gateway::get_gateway_token,
            commands::gateway::run_doctor,
            // System
            commands::system::get_platform_info,
            commands::system::check_node,
            commands::system::check_git,
            commands::system::check_openclaw,
            commands::system::open_folder,
            commands::system::get_terminal_env,
            // Fonts
            commands::font::get_system_fonts,
            commands::cli_tools::detect_cli_tools,
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
            commands::voice_wake::voice_wake_start,
            commands::voice_wake::voice_wake_stop,
            commands::voice_wake::voice_wake_status,
            // Setup
            commands::setup::install_node,
            commands::setup::install_git,
            commands::setup::install_openclaw,
            commands::setup::prepare_gateway,
            commands::setup::install_winget_package,
            // Control UI (Console)
           commands::console::open_control_ui,
           commands::console::return_to_desktop,
            commands::managed_files::managed_file_open,
            commands::managed_files::managed_file_reveal,
            commands::managed_files::managed_file_exists,
            commands::managed_files::list_directory,
            commands::managed_files::read_file_text,

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
            // QuickChat — single-session window spawned from a dropped file
            commands::quickchat::open_quickchat_with_files,
            commands::quickchat::close_quickchat,
            commands::quickchat::get_quickchat_visible,
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
            // Integrated terminal (portable-pty)
            commands::terminal::terminal_create,
            commands::terminal::terminal_write,
            commands::terminal::terminal_resize,
            commands::terminal::terminal_kill,
            // Nezha-style shell terminal (multi-session, bounded channel, batched emit)
            commands::pty_neu::open_shell,
            commands::pty_neu::kill_shell,
            commands::pty_neu::send_input,
            commands::pty_neu::resize_pty,
            // Nezha-style git commands
            commands::git_neu::git_status,
            commands::git_neu::git_log,
            commands::git_neu::git_list_branches,
            commands::git_neu::git_checkout_branch,
            commands::git_neu::git_create_branch,
            commands::git_neu::git_commit_detail,
            commands::git_neu::git_show_diff,
            commands::git_neu::git_show_file_diff,
            commands::git_neu::git_file_diff,
            commands::git_neu::git_stage,
            commands::git_neu::git_unstage,
            commands::git_neu::git_stage_files,
            commands::git_neu::git_unstage_files,
            commands::git_neu::git_stage_all,
            commands::git_neu::git_unstage_all,
            commands::git_neu::git_commit,
            commands::git_neu::git_discard_file,
            commands::git_neu::git_discard_files,
            commands::git_neu::git_discard_all,
            commands::git_neu::git_push,
            commands::git_neu::git_pull,
            commands::git_neu::git_remote_counts,
            commands::git_neu::generate_commit_message,
            // Worktree task commands (ported from nezha git.rs)
            commands::git_neu::create_task_worktree,
            commands::git_neu::merge_task_worktree,
            commands::git_neu::remove_task_worktree,
            commands::git_neu::worktree_diff_stats,
            commands::git_neu::git_diff_shortstat,
            // Nezha-style file system commands
            commands::fs_neu::read_dir_entries,
            commands::fs_neu::read_file_content,
            commands::fs_neu::read_image_preview,
            commands::fs_neu::write_file_content,
            commands::fs_neu::create_file,
            commands::fs_neu::create_directory,
            commands::fs_neu::delete_path,
            commands::fs_neu::open_in_system_file_manager,
            commands::fs_neu::list_project_files,
            commands::fs_neu::search_project_files,
            // Session analytics (ported from nezha analytics.rs)
            commands::session_analytics::read_session_metrics,
            commands::session_analytics::read_session_messages,
            commands::session_analytics::export_session_markdown,
            // Project config (ported from nezha config.rs)
            commands::project_config::init_project_config,
            commands::project_config::read_project_config,
            commands::project_config::write_project_config,
            commands::project_config::get_agent_config_file_path,
            commands::project_config::read_agent_config_file,
            commands::project_config::write_agent_config_file,
            // App settings (ported from nezha app_settings.rs, simplified)
            commands::app_settings::load_app_settings,
            commands::app_settings::save_app_settings,
            commands::app_settings::detect_agent_paths,
            // Hooks (minimal port of nezha hooks.rs)
            commands::hooks::get_hook_readiness,
            // Skill hub (minimal port of nezha skills.rs)
            commands::skills::get_skill_hub_config,
            commands::skills::set_skill_hub_path,
            commands::skills::clear_skill_hub,
            commands::skills::list_skills,
            commands::skills::list_skill_installations,
            commands::skills::install_skill,
            commands::skills::delete_skill,
            // Workspace path accessor (PR-15 @ file mention support)
            commands::workspace::get_workspace_path,
            // Notification local store (PR-0.6a — local read state only)
            commands::notification::get_notifications,
            commands::notification::mark_notification_read,
            commands::notification::mark_all_notifications_read,
            // Usage snapshot stub (PR-0.6b — unavailable for both agents)
            commands::usage::read_usage_snapshot,
            // Agent task PTY (PR-0.3 — minimal port)
            commands::agent_task_pty::run_task,
            commands::agent_task_pty::agent_send_input,
            commands::agent_task_pty::agent_resize_pty,
            commands::agent_task_pty::cancel_task,
            commands::agent_task_pty::get_active_task_ids,
        ])
        .setup(|app| {
            // Use the default (Regular) activation policy so JunQi gets a Dock
            // tile with its icon and a Cmd+Tab entry — the whole point of
            // shipping a branded .app. The pet window is still skip_taskbar
            // and always_on_top so it doesn't take its own Dock slot.
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                // Force every window's icon to our bundled junqi icon at runtime.
                // This is essential for `cargo run` / `tauri dev` because the
                // binary has no .app bundle and the parent process (Xcode,
                // Terminal, etc.) leaks its own much-larger icon into the Dock.
                // Compiled into the binary so it works regardless of cwd.
                const ICON_BYTES: &[u8] = include_bytes!("../icons/128x128.png");
                let windows: Vec<_> = app.webview_windows().into_iter().collect();
                for (_, win) in windows {
                    // Decode once per window (~6KB input, ~1ms) — simpler than
                    // sharing an Image<'static> across set_icon calls since
                    // to_owned() consumes self each time.
                    if let Ok(img) = tauri::image::Image::from_bytes(ICON_BYTES) {
                        let _ = win.set_icon(img);
                    }
                }
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
            // ── Window-level drag-drop bridge ────────────────────────────────
            // Routes OS-level drag-drop events from any webview window to the
            // frontend. Forward all 4 variants: Enter (files start hovering),
            // Over (during drag — used by pet to magnetize to cursor),
            // Leave (drag escaped without dropping), Drop (final deposit).
            let app_for_dd = app.handle().clone();
            if let Some(main_win) = app.get_webview_window("main") {
                // Compute window-local logical position from global screen coords.
                // Window's own (outer_position) tells us where it sits on the
                // multi-monitor layout; subtract that to get window-local coords.
                let win_pos = main_win.outer_position().ok();
                let win_pos_x = win_pos.map(|p| p.x as f64).unwrap_or(0.0);
                let win_pos_y = win_pos.map(|p| p.y as f64).unwrap_or(0.0);
                let scale = main_win.scale_factor().unwrap_or(1.0);
                let size = main_win.outer_size().ok();
                let win_w = size.as_ref().map(|s| s.width as f64 / scale).unwrap_or(1280.0);
                let win_h = size.as_ref().map(|s| s.height as f64 / scale).unwrap_or(800.0);
                main_win.on_window_event(move |event| {
                    use tauri::WindowEvent;
                    if let WindowEvent::DragDrop(dd) = event {
                        match dd {
                            tauri::DragDropEvent::Enter { paths, .. } => {
                                let strs: Vec<String> = paths
                                    .iter()
                                    .map(|p| p.to_string_lossy().to_string())
                                    .collect();
                                let _ = app_for_dd.emit("aegis:drag-active", &strs);
                            }
                            tauri::DragDropEvent::Over { position, .. } => {
                                // Global → logical → window-local
                                let local_x = (position.x as f64 / scale) - win_pos_x;
                                let local_y = (position.y as f64 / scale) - win_pos_y;
                                let _ = app_for_dd.emit(
                                    "aegis:drag-move",
                                    serde_json::json!({
                                        "x": local_x,
                                        "y": local_y,
                                        "gx": position.x as f64 / scale,
                                        "gy": position.y as f64 / scale,
                                        "win_w": win_w,
                                        "win_h": win_h,
                                    }),
                                );
                            }
                            tauri::DragDropEvent::Leave => {
                                let _ = app_for_dd.emit("aegis:drag-inactive", ());
                            }
                            tauri::DragDropEvent::Drop { paths, .. } => {
                                let strs: Vec<String> = paths
                                    .iter()
                                    .map(|p| p.to_string_lossy().to_string())
                                    .collect();
                                let _ = app_for_dd.emit("aegis:file-dropped", strs);
                                let _ = app_for_dd.emit("aegis:drag-inactive", ());
                            }
                            _ => {}
                        }
                    }
                });
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
                        // Convert physical → logical; clamp between min (960×640)
                        // and max (1600×1000) so the window never gets absurdly large
                        // on 4K/5K displays nor unusably small on laptops.
                        let logical_w = phys.width as f64 / scale;
                        let logical_h = phys.height as f64 / scale;
                        let w = (logical_w * 0.72).clamp(1100.0, 1600.0);
                        let h = (logical_h * 0.80).clamp(720.0, 1000.0);
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
        // ── Dock click (macOS) / taskbar click — re-show the main window
        // ── if it was hidden via Cmd+H or window close. Tauri 2 doesn't
        // ── do this automatically; without it the app stays in the dock
        // ── but clicking the icon does nothing.
        if let RunEvent::Reopen { .. } = event {
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        // ── macOS: handle dock click for the activation policy case too.
        // This fires when the dock icon is clicked and the app might
        // have no visible windows. Fall through to handle the no-window case.
        #[cfg(target_os = "macos")]
        {
            if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        }
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
