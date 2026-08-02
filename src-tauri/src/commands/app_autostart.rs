//! JunQi Desktop's own login-autostart controls.
//!
//! This is intentionally separate from `gateway_service`: the application
//! login item must never alter OpenClaw's service ownership or lifecycle.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppAutostartStatus {
    pub enabled: bool,
}

fn autostart_status(app: &AppHandle) -> Result<AppAutostartStatus, String> {
    app.autolaunch()
        .is_enabled()
        .map(|enabled| AppAutostartStatus { enabled })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn app_autostart_status(app: AppHandle) -> Result<AppAutostartStatus, String> {
    autostart_status(&app)
}

#[tauri::command]
pub fn enable_app_autostart(app: AppHandle) -> Result<AppAutostartStatus, String> {
    app.autolaunch()
        .enable()
        .map_err(|error| error.to_string())?;
    autostart_status(&app)
}

#[tauri::command]
pub fn disable_app_autostart(app: AppHandle) -> Result<AppAutostartStatus, String> {
    app.autolaunch()
        .disable()
        .map_err(|error| error.to_string())?;
    autostart_status(&app)
}

#[cfg(test)]
mod tests {
    use super::AppAutostartStatus;

    #[test]
    fn status_serializes_enabled_in_camel_case() {
        let value = serde_json::to_value(AppAutostartStatus { enabled: true }).unwrap();
        assert_eq!(value, serde_json::json!({ "enabled": true }));
    }
}
