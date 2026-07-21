use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use tauri::Emitter;

/// Every Node.js/Git download-and-install event also lands in a persistent,
/// on-disk timeline so a slow-but-successful run can be diagnosed after the
/// fact. The in-memory `setup-progress` events above are only seen by a
/// running frontend; this file survives regardless of outcome.
fn timeline_log_path(step: &str) -> std::path::PathBuf {
    crate::paths::diagnostics_log_dir().join(format!("{step}-timeline.log"))
}

/// Tests must never write into the real user AppData/install directory as a
/// side effect of exercising install-flow code paths that emit progress.
#[cfg(test)]
fn timeline_tracked(_step: &str) -> bool {
    false
}

#[cfg(not(test))]
fn timeline_tracked(step: &str) -> bool {
    matches!(step, "node" | "git" | "openclaw")
}

/// Start a fresh timeline for one dependency-install attempt. The caller invokes
/// this after acquiring the per-tool install lock so a queued retry cannot erase
/// a still-running transaction's diagnostics.
pub fn reset_timeline_log(step: &str) {
    if !timeline_tracked(step) {
        return;
    }
    let path = timeline_log_path(step);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &path,
        format!(
            "=== {step} dependency install started {} ===\n",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
        ),
    );
}

fn append_timeline_log(step: &str, line: &str) {
    if !timeline_tracked(step) {
        return;
    }
    let path = timeline_log_path(step);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    else {
        return;
    };
    let _ = writeln!(
        file,
        "[{}] {}",
        chrono::Local::now().format("%H:%M:%S%.3f"),
        line
    );
}

fn record_timeline(step: &str, message: &str, metadata: &SetupProgressMetadata<'_>) {
    if !timeline_tracked(step) {
        return;
    }
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
    if let Some(error) = metadata.error {
        line.push_str(&format!("  ERROR: {error}"));
    }
    append_timeline_log(step, &line);
}

/// Append an already-formatted line to a step's timeline log, e.g. to record a
/// failed mirror attempt that never becomes a user-facing progress event.
pub fn record_timeline_note(step: &str, note: &str) {
    append_timeline_log(step, note);
}

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
    record_timeline(step, message, &metadata);
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
