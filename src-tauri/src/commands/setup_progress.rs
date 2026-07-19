use serde::Serialize;
use std::collections::BTreeMap;
use tauri::Emitter;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SetupProgressStatus {
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct SetupProgress {
    pub step: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<BTreeMap<String, String>>,
    pub progress: Option<f64>,
    #[serde(default)]
    pub diagnostic: bool,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<SetupProgressStatus>,
}

#[derive(Default)]
struct SetupProgressMetadata<'a> {
    key: Option<&'a str>,
    params: Option<BTreeMap<String, String>>,
    progress: Option<f64>,
    diagnostic: bool,
    error: Option<&'a str>,
    status: Option<SetupProgressStatus>,
}

pub fn emit(app: &tauri::AppHandle, step: &str, message: &str, progress: f64) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            progress: Some(progress),
            ..Default::default()
        },
    );
}

pub fn emit_keyed(app: &tauri::AppHandle, step: &str, message: &str, key: &str, progress: f64) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            key: Some(key),
            progress: Some(progress),
            ..Default::default()
        },
    );
}

pub fn emit_keyed_with_params(
    app: &tauri::AppHandle,
    step: &str,
    message: &str,
    key: &str,
    params: &[(&str, &str)],
    progress: f64,
) {
    let params = params
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect();
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            key: Some(key),
            params: Some(params),
            progress: Some(progress),
            ..Default::default()
        },
    );
}

/// Emit third-party process output for troubleshooting. Diagnostics remain in
/// the setup log but must not replace the user-facing, localizable progress
/// phase.
pub fn emit_diagnostic(app: &tauri::AppHandle, step: &str, message: &str, progress: f64) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            progress: Some(progress),
            diagnostic: true,
            ..Default::default()
        },
    );
}

pub fn emit_completed(app: &tauri::AppHandle, step: &str, message: &str) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            progress: Some(1.0),
            status: Some(SetupProgressStatus::Completed),
            ..Default::default()
        },
    );
}

pub fn emit_completed_keyed(app: &tauri::AppHandle, step: &str, message: &str, key: &str) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            key: Some(key),
            progress: Some(1.0),
            status: Some(SetupProgressStatus::Completed),
            ..Default::default()
        },
    );
}

pub fn emit_error(app: &tauri::AppHandle, step: &str, message: &str, progress: Option<f64>) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            progress,
            error: Some(message),
            status: Some(SetupProgressStatus::Failed),
            ..Default::default()
        },
    );
}

fn emit_event(
    app: &tauri::AppHandle,
    step: &str,
    message: &str,
    metadata: SetupProgressMetadata<'_>,
) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step: step.into(),
            message: message.into(),
            key: metadata.key.map(str::to_owned),
            params: metadata.params,
            progress: metadata.progress.map(|value| value.clamp(0.0, 1.0)),
            diagnostic: metadata.diagnostic,
            error: metadata.error.map(str::to_owned),
            status: metadata.status,
        },
    );
}
