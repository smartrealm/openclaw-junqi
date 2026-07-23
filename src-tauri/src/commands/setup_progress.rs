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
    #[serde(rename = "logSlot", skip_serializing_if = "Option::is_none")]
    pub log_slot: Option<String>,
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
    log_slot: Option<&'a str>,
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

/// Emit a normal progress event whose visible console row may be replaced by
/// a later event from the same operation. The durable setup timeline still
/// records every event before it reaches the renderer.
pub fn emit_coalesced(
    app: &tauri::AppHandle,
    step: &str,
    message: &str,
    log_slot: &str,
    progress: f64,
) {
    emit_event(
        app,
        step,
        message,
        SetupProgressMetadata {
            log_slot: Some(log_slot),
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
/// the activity log without replacing the localizable progress phase.
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

pub(crate) fn emit_log_write_failure(app: &tauri::AppHandle, step: &str, error: &str) {
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step: step.into(),
            message: "Setup diagnostics could not be written to disk".into(),
            key: Some("setup.installPanel.logWriteFailed".into()),
            params: None,
            log_slot: None,
            progress: None,
            diagnostic: true,
            error: Some(error.into()),
            status: None,
        },
    );
}

fn record_timeline(
    app: &tauri::AppHandle,
    step: &str,
    message: &str,
    metadata: &SetupProgressMetadata<'_>,
) {
    let mut line = String::new();
    if let Some(progress) = metadata.progress {
        line.push_str(&format!("[{:>5.1}%] ", progress.clamp(0.0, 1.0) * 100.0));
    }
    if metadata.diagnostic {
        line.push_str("(diag) ");
    }
    line.push_str(message);
    if let Some(key) = metadata.key {
        line.push_str(&format!("  [key={key}]"));
    }
    if let Some(params) = &metadata.params {
        if !params.is_empty() {
            let joined = params
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join(", ");
            line.push_str(&format!("  [{joined}]"));
        }
    }
    if let Some(log_slot) = metadata.log_slot {
        line.push_str(&format!("  [log-slot={log_slot}]"));
    }
    if let Some(error) = metadata.error {
        line.push_str(&format!("  ERROR: {error}"));
    }
    crate::commands::setup_diagnostics::record_timeline_note(app, step, &line);
}

fn emit_event(
    app: &tauri::AppHandle,
    step: &str,
    message: &str,
    metadata: SetupProgressMetadata<'_>,
) {
    record_timeline(app, step, message, &metadata);
    let _ = app.emit(
        "setup-progress",
        SetupProgress {
            step: step.into(),
            message: message.into(),
            key: metadata.key.map(str::to_owned),
            params: metadata.params,
            log_slot: metadata.log_slot.map(str::to_owned),
            progress: metadata.progress.map(|value| value.clamp(0.0, 1.0)),
            diagnostic: metadata.diagnostic,
            error: metadata.error.map(str::to_owned),
            status: metadata.status,
        },
    );
}
