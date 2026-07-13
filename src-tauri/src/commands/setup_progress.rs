use serde::Serialize;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub step: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub progress: Option<f64>,
    pub error: Option<String>,
}

pub fn emit(app: &tauri::AppHandle, step: &str, message: &str, progress: f64) {
    emit_event(app, step, message, None, Some(progress), None);
}

pub fn emit_keyed(app: &tauri::AppHandle, step: &str, message: &str, key: &str, progress: f64) {
    emit_event(app, step, message, Some(key), Some(progress), None);
}

pub fn emit_error(app: &tauri::AppHandle, step: &str, message: &str, progress: Option<f64>) {
    emit_event(app, step, message, None, progress, Some(message));
}

fn emit_event(
    app: &tauri::AppHandle,
    step: &str,
    message: &str,
    key: Option<&str>,
    progress: Option<f64>,
    error: Option<&str>,
) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step: step.into(),
            message: message.into(),
            key: key.map(str::to_owned),
            progress: progress.map(|value| value.clamp(0.0, 1.0)),
            error: error.map(str::to_owned),
        },
    );
}
