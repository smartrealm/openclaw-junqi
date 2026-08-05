use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::commands::app_settings::PrivacyLockSettings;
use crate::commands::privacy_lock::{lock_from_native, PrivacyLockReason, PrivacyLockState};

fn register(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let snapshot = lock_from_native(app, PrivacyLockReason::Shortcut);
            if snapshot.locked {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            }
        })
        .map_err(|_| "shortcut_registration_failed".to_string())
}

fn unregister(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    if app.global_shortcut().is_registered(shortcut) {
        app.global_shortcut()
            .unregister(shortcut)
            .map_err(|_| "shortcut_unregistration_failed".to_string())?;
    }
    Ok(())
}

pub fn initialize(app: &AppHandle) {
    let state = app.state::<PrivacyLockState>();
    let settings = state.settings();
    if !settings.enabled || !settings.global_shortcut_enabled {
        state.set_shortcut_status(false, false);
        return;
    }
    match register(app, &settings.global_shortcut) {
        Ok(()) => {
            state.set_shortcut_status(true, false);
        }
        Err(_) => {
            state.set_shortcut_status(false, true);
        }
    }
}

pub fn replace_registration(
    app: &AppHandle,
    current: &PrivacyLockSettings,
    next: &PrivacyLockSettings,
) -> Result<(), String> {
    let unchanged = current.global_shortcut_enabled == next.global_shortcut_enabled
        && current.global_shortcut == next.global_shortcut;
    if unchanged {
        return Ok(());
    }

    let current_registered = current.enabled && current.global_shortcut_enabled;
    let next_registered = next.enabled && next.global_shortcut_enabled;

    // When changing an active shortcut, unregister the old binding first. Some
    // platforms reject registering a second shortcut before the first one is
    // released. If the new binding fails, restore the old binding before
    // returning so neither runtime state nor persisted settings drift.
    if current_registered {
        unregister(app, &current.global_shortcut)?;
    }

    if next_registered {
        if let Err(error) = register(app, &next.global_shortcut) {
            if current_registered {
                let _ = register(app, &current.global_shortcut);
            }
            return Err(error);
        }
    }

    let state = app.state::<PrivacyLockState>();
    state.set_shortcut_status(next_registered, false);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_shortcut_uses_cross_platform_command_or_control() {
        assert_eq!(
            PrivacyLockSettings::default().global_shortcut,
            "CommandOrControl+Shift+L"
        );
    }
}
