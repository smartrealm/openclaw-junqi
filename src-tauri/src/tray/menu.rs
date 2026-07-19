use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

const TRAY_ID: &str = "main-tray";

#[derive(Clone, Copy)]
struct TrayLabels {
    toggle: &'static str,
    toggle_pet: &'static str,
    toggle_island: &'static str,
    quit: &'static str,
}

fn labels_for_language(language: &str) -> TrayLabels {
    match language {
        "zh" => TrayLabels {
            toggle: "显示/隐藏主窗口",
            toggle_pet: "显示/隐藏萌宠",
            toggle_island: "显示/隐藏灵动岛",
            quit: "退出 JunQi Desktop",
        },
        "zh-TW" => TrayLabels {
            toggle: "顯示/隱藏主視窗",
            toggle_pet: "顯示/隱藏萌寵",
            toggle_island: "顯示/隱藏動態島",
            quit: "結束 JunQi Desktop",
        },
        "ar" => TrayLabels {
            toggle: "إظهار/إخفاء النافذة الرئيسية",
            toggle_pet: "إظهار/إخفاء الرفيق",
            toggle_island: "إظهار/إخفاء الجزيرة الديناميكية",
            quit: "إنهاء JunQi Desktop",
        },
        _ => TrayLabels {
            toggle: "Show/Hide",
            toggle_pet: "Show/Hide Pet",
            toggle_island: "Show/Hide Dynamic Island",
            quit: "Quit JunQi Desktop",
        },
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, labels: TrayLabels) -> tauri::Result<Menu<R>> {
    let toggle = MenuItemBuilder::with_id("toggle", labels.toggle).build(app)?;
    let toggle_pet = MenuItemBuilder::with_id("toggle-pet", labels.toggle_pet).build(app)?;
    let toggle_island =
        MenuItemBuilder::with_id("toggle-island", labels.toggle_island).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", labels.quit).build(app)?;
    MenuBuilder::new(app)
        .items(&[&toggle, &toggle_island, &toggle_pet, &quit])
        .build()
}

pub fn update_tray_language<R: Runtime>(app: &AppHandle<R>, language: &str) -> tauri::Result<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };
    tray.set_menu(Some(build_menu(app, labels_for_language(language))?))
}

pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();
    let language = crate::commands::app_settings::application_language();
    let menu = build_menu(app_handle, labels_for_language(&language))?;

    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(app.default_window_icon().cloned().expect("app icon"))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => {
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
            }
            "toggle-pet" => {
                // Show/hide the pet window; create it on first toggle.
                if let Some(win) = app.get_webview_window(crate::commands::pet::PET_LABEL) {
                    if win.is_visible().unwrap_or(false) {
                        let _ = win.hide();
                    } else {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                } else {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = crate::commands::pet::open_pet_window(app).await;
                    });
                }
            }
            "toggle-island" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::commands::dynamic_island::toggle_dynamic_island(app).await;
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_labels_cover_every_supported_application_language() {
        assert_eq!(labels_for_language("zh").toggle, "显示/隐藏主窗口");
        assert_eq!(labels_for_language("zh-TW").toggle, "顯示/隱藏主視窗");
        assert_eq!(labels_for_language("en").quit, "Quit JunQi Desktop");
        assert_eq!(labels_for_language("ar").toggle_pet, "إظهار/إخفاء الرفيق");
    }
}
