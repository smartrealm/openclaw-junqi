use std::collections::BTreeMap;
use std::fs::File;
use std::io::{LineWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use zip::write::SimpleFileOptions;

const SETUP_RUNS_DIRECTORY: &str = "setup-runs";
const SETUP_SESSION_LOG: &str = "setup-session.log";
const SETUP_SESSION_MANIFEST: &str = "manifest.json";
const LATEST_SESSION_POINTER: &str = "latest-session.json";
const RETAINED_SETUP_RUNS: usize = 8;

static DIAGNOSTICS_STATE: OnceLock<Mutex<Option<DiagnosticsState>>> = OnceLock::new();
static LOG_FAILURE_REPORTED: AtomicBool = AtomicBool::new(false);

struct DiagnosticsState {
    session_dir: PathBuf,
    attempts: BTreeMap<String, u32>,
    writers: BTreeMap<PathBuf, LineWriter<File>>,
}

impl DiagnosticsState {
    fn append(&mut self, path: PathBuf, line: &str) -> Result<(), String> {
        if !self.writers.contains_key(&path) {
            let file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .map_err(|error| {
                    format!("Failed to open diagnostic log {}: {error}", path.display())
                })?;
            self.writers.insert(path.clone(), LineWriter::new(file));
        }
        let writer = self
            .writers
            .get_mut(&path)
            .ok_or_else(|| "Diagnostic writer disappeared unexpectedly".to_string())?;
        let result = writeln!(writer, "{line}")
            .map_err(|error| format!("Failed to write diagnostic log {}: {error}", path.display()));
        if result.is_err() {
            self.writers.remove(&path);
        }
        result
    }

    fn flush(&mut self) -> Result<(), String> {
        for (path, writer) in &mut self.writers {
            writer.flush().map_err(|error| {
                format!("Failed to flush diagnostic log {}: {error}", path.display())
            })?;
        }
        Ok(())
    }
}

/// Tests must never write into the real user AppData/install directory as a
/// side effect of exercising install-flow code paths that emit progress.
#[cfg(test)]
fn timeline_tracked(_step: &str) -> bool {
    false
}

#[cfg(not(test))]
fn timeline_tracked(step: &str) -> bool {
    matches!(step, "node" | "npm" | "git" | "openclaw" | "gateway")
}

fn append_line(path: &Path, line: &str) -> std::io::Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{line}")
}

fn session_name() -> String {
    format!(
        "{}-pid{}",
        chrono::Local::now().format("%Y%m%d-%H%M%S-%3f"),
        std::process::id()
    )
}

fn setup_runs_dir(root: &Path) -> PathBuf {
    root.join(SETUP_RUNS_DIRECTORY)
}

fn initialize_diagnostics_state(root: &Path) -> Result<DiagnosticsState, String> {
    std::fs::create_dir_all(root)
        .map_err(|error| format!("Failed to create setup diagnostics directory: {error}"))?;
    let runs_dir = setup_runs_dir(root);
    std::fs::create_dir_all(&runs_dir)
        .map_err(|error| format!("Failed to create setup run directory: {error}"))?;

    let name = session_name();
    let session_dir = runs_dir.join(&name);
    std::fs::create_dir_all(&session_dir)
        .map_err(|error| format!("Failed to create setup diagnostic session: {error}"))?;

    let started_at = chrono::Local::now().to_rfc3339();
    let manifest = serde_json::json!({
        "schemaVersion": 1,
        "session": name,
        "startedAt": started_at,
        "pid": std::process::id(),
        "appVersion": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    });
    write_json_atomically(&session_dir.join(SETUP_SESSION_MANIFEST), &manifest)?;
    write_json_atomically(
        &root.join(LATEST_SESSION_POINTER),
        &serde_json::json!({ "session": name, "path": session_dir }),
    )?;

    append_line(
        &session_dir.join(SETUP_SESSION_LOG),
        &format!(
            "=== JunQi setup diagnostics session started {} (pid={}) ===",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
            std::process::id(),
        ),
    )
    .map_err(|error| format!("Failed to initialize setup session log: {error}"))?;

    if let Err(error) = prune_setup_runs(&runs_dir, RETAINED_SETUP_RUNS, Some(&session_dir)) {
        append_line(
            &session_dir.join(SETUP_SESSION_LOG),
            &format!("WARN: {error}"),
        )
        .map_err(|write_error| {
            format!("{error}; failed to record pruning warning: {write_error}")
        })?;
    }
    Ok(DiagnosticsState {
        session_dir,
        attempts: BTreeMap::new(),
        writers: BTreeMap::new(),
    })
}

fn write_json_atomically(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Diagnostic metadata path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create diagnostic metadata directory: {error}"))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("metadata"),
        std::process::id()
    ));
    let payload = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Failed to encode diagnostic metadata: {error}"))?;
    std::fs::write(&temporary, payload)
        .map_err(|error| format!("Failed to write diagnostic metadata: {error}"))?;
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|error| format!("Failed to replace diagnostic metadata: {error}"))?;
    }
    std::fs::rename(&temporary, path)
        .map_err(|error| format!("Failed to commit diagnostic metadata: {error}"))
}

fn prune_setup_runs(
    runs_dir: &Path,
    retain: usize,
    protected: Option<&Path>,
) -> Result<(), String> {
    let mut sessions = std::fs::read_dir(runs_dir)
        .map_err(|error| format!("Failed to enumerate setup diagnostic sessions: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .map(|entry| entry.path())
        .filter(|path| path.join(SETUP_SESSION_MANIFEST).is_file())
        .collect::<Vec<_>>();
    sessions.sort();
    let removable = sessions.len().saturating_sub(retain);
    for path in sessions.into_iter().take(removable) {
        if protected.is_some_and(|protected| protected == path) {
            continue;
        }
        std::fs::remove_dir_all(&path).map_err(|error| {
            format!(
                "Failed to prune old setup diagnostic session {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn diagnostics_state() -> &'static Mutex<Option<DiagnosticsState>> {
    DIAGNOSTICS_STATE.get_or_init(|| Mutex::new(None))
}

fn ensure_diagnostics_state(
    state: &mut Option<DiagnosticsState>,
) -> Result<&mut DiagnosticsState, String> {
    if state.is_none() {
        *state = Some(initialize_diagnostics_state(
            &crate::paths::diagnostics_log_dir(),
        )?);
    }
    state
        .as_mut()
        .ok_or_else(|| "Setup diagnostics state was not initialized".to_string())
}

fn with_diagnostics_state<T>(
    operation: impl FnOnce(&mut DiagnosticsState) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = diagnostics_state()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let state = ensure_diagnostics_state(&mut guard)?;
    operation(state)
}

fn report_persistence_failure_once(app: &tauri::AppHandle, step: &str, error: &str) {
    if LOG_FAILURE_REPORTED.swap(true, Ordering::SeqCst) {
        return;
    }
    eprintln!("JunQi setup diagnostic persistence failed: {error}");
    crate::commands::setup_progress::emit_log_write_failure(app, step, error);
}

fn timeline_log_path(state: &DiagnosticsState, step: &str) -> PathBuf {
    state.session_dir.join(format!("{step}-timeline.log"))
}

fn append_session_line(state: &mut DiagnosticsState, line: &str) -> Result<(), String> {
    state.append(state.session_dir.join(SETUP_SESSION_LOG), line)
}

/// Start another dependency-install attempt without erasing earlier attempts.
/// Retries stay in the same app-process session and receive an explicit number.
fn append_attempt_boundary(
    state: &mut DiagnosticsState,
    step: &str,
    timestamp: &str,
) -> Result<(), String> {
    let attempt = state.attempts.entry(step.to_owned()).or_insert(0);
    *attempt += 1;
    let header = format!(
        "=== {step} dependency install attempt {} started {timestamp} ===",
        *attempt
    );
    state.append(timeline_log_path(state, step), &header)?;
    append_session_line(state, &header)
}

pub fn reset_timeline_log(app: &tauri::AppHandle, step: &str) {
    if !timeline_tracked(step) {
        return;
    }
    let result = with_diagnostics_state(|state| {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        append_attempt_boundary(state, step, &timestamp.to_string())
    });
    if let Err(error) = result {
        report_persistence_failure_once(app, step, &error);
    }
}

fn append_timeline_log(app: &tauri::AppHandle, step: &str, line: &str) {
    if !timeline_tracked(step) {
        return;
    }
    let result = with_diagnostics_state(|state| {
        let now = chrono::Local::now();
        state.append(
            timeline_log_path(state, step),
            &format!("[{}] {}", now.format("%H:%M:%S%.3f"), line),
        )?;
        append_session_line(
            state,
            &format!("[{}] [{step}] {line}", now.format("%Y-%m-%d %H:%M:%S%.3f")),
        )
    });
    if let Err(error) = result {
        report_persistence_failure_once(app, step, &error);
    }
}

/// Append an already-formatted line to a step timeline. Callers use this for
/// state transitions that are diagnostically relevant but not UI progress.
pub fn record_timeline_note(app: &tauri::AppHandle, step: &str, note: &str) {
    append_timeline_log(app, step, note);
}

fn safe_file_component(value: &str) -> String {
    let component = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();
    let trimmed = component.trim_matches('-');
    if trimmed.is_empty() {
        "process".to_string()
    } else {
        trimmed.chars().take(80).collect()
    }
}

#[cfg(windows)]
fn safe_artifact_file_name(value: &str) -> String {
    let file_name = Path::new(value)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("artifact.log");
    let sanitized = file_name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '-'
            }
        })
        .take(120)
        .collect::<String>();
    if sanitized.is_empty() || matches!(sanitized.as_str(), "." | "..") {
        "artifact.log".to_string()
    } else {
        sanitized
    }
}

/// Persist process output before UI filtering or repetitive-line suppression.
/// Credential-like lines are still redacted and individual lines are bounded
/// to protect the diagnostics writer from malformed binary output.
pub fn record_process_output(
    app: &tauri::AppHandle,
    step: &str,
    process: &str,
    stream: &str,
    raw_line: &str,
) {
    if !timeline_tracked(step) {
        return;
    }
    let line = crate::commands::diagnostic_output::sanitize_process_diagnostic_line(raw_line);
    let result = with_diagnostics_state(|state| {
        let directory = state
            .session_dir
            .join("process")
            .join(safe_file_component(step));
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create process diagnostic directory: {error}"))?;
        let path = directory.join(format!("{}.log", safe_file_component(process)));
        state.append(
            path,
            &format!(
                "[{}] [{}] {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
                safe_file_component(stream),
                line
            ),
        )
    });
    if let Err(error) = result {
        report_persistence_failure_once(app, step, &error);
    }
}

pub fn record_process_started(
    app: &tauri::AppHandle,
    step: &str,
    process: &str,
    pid: Option<u32>,
    description: &str,
) {
    let note = format!(
        "process.start name={} pid={} command={}",
        safe_file_component(process),
        pid.map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".into()),
        description
    );
    record_process_output(app, step, process, "lifecycle", &note);
    record_timeline_note(app, step, &note);
}

pub fn record_process_finished(
    app: &tauri::AppHandle,
    step: &str,
    process: &str,
    pid: Option<u32>,
    exit_code: Option<i64>,
    elapsed: Duration,
) {
    let note = format!(
        "process.finish name={} pid={} exit={} elapsed_ms={}",
        safe_file_component(process),
        pid.map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".into()),
        exit_code
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".into()),
        elapsed.as_millis()
    );
    record_process_output(app, step, process, "lifecycle", &note);
    record_timeline_note(app, step, &note);
}

#[cfg(windows)]
pub fn diagnostic_artifact_path(
    app: &tauri::AppHandle,
    step: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    if !timeline_tracked(step) {
        return Err(format!("Unsupported setup diagnostic step: {step}"));
    }
    let result = with_diagnostics_state(|state| {
        let directory = state
            .session_dir
            .join("artifacts")
            .join(safe_file_component(step));
        std::fs::create_dir_all(&directory)
            .map_err(|error| format!("Failed to create diagnostic artifact directory: {error}"))?;
        Ok(directory.join(safe_artifact_file_name(file_name)))
    });
    if let Err(error) = &result {
        report_persistence_failure_once(app, step, error);
    }
    result
}

#[tauri::command]
pub fn get_setup_diagnostics_directory() -> Result<String, String> {
    let directory = crate::paths::diagnostics_log_dir();
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Failed to create setup diagnostics directory: {error}"))?;
    Ok(directory.to_string_lossy().into_owned())
}

fn archive_directory(source: &Path, destination: &Path) -> Result<(), String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "Diagnostics archive destination has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("Failed to create diagnostics export directory: {error}"))?;
    let temporary = parent.join(format!(
        ".{}.{}.tmp",
        destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("junqi-install-diagnostics.zip"),
        std::process::id()
    ));
    let export = (|| -> Result<(), String> {
        let file = File::create(&temporary)
            .map_err(|error| format!("Failed to create diagnostics archive: {error}"))?;
        let mut archive = zip::ZipWriter::new(file);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o600);
        archive_tree(
            &mut archive,
            source,
            source,
            destination,
            &temporary,
            options,
        )?;
        archive
            .finish()
            .map_err(|error| format!("Failed to finish diagnostics archive: {error}"))?;
        if destination.exists() {
            std::fs::remove_file(destination)
                .map_err(|error| format!("Failed to replace diagnostics archive: {error}"))?;
        }
        std::fs::rename(&temporary, destination)
            .map_err(|error| format!("Failed to commit diagnostics archive: {error}"))
    })();
    if export.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    export
}

fn archive_tree(
    archive: &mut zip::ZipWriter<File>,
    root: &Path,
    current: &Path,
    destination: &Path,
    temporary: &Path,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let mut entries = std::fs::read_dir(current)
        .map_err(|error| format!("Failed to enumerate diagnostics archive input: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to inspect diagnostics archive input: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        if path == destination || path == temporary {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect diagnostic artifact: {error}"))?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            archive_tree(archive, root, &path, destination, temporary, options)?;
            continue;
        }
        if !metadata.is_file() {
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|error| format!("Failed to normalize diagnostic archive path: {error}"))?;
        let name = relative.to_string_lossy().replace('\\', "/");
        archive
            .start_file(name, options)
            .map_err(|error| format!("Failed to add diagnostic artifact to archive: {error}"))?;
        let mut input = File::open(&path)
            .map_err(|error| format!("Failed to read diagnostic artifact: {error}"))?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input
                .read(&mut buffer)
                .map_err(|error| format!("Failed to read diagnostic artifact: {error}"))?;
            if read == 0 {
                break;
            }
            archive
                .write_all(&buffer[..read])
                .map_err(|error| format!("Failed to write diagnostic archive: {error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn export_setup_diagnostics_bundle(destination: String) -> Result<String, String> {
    let destination = PathBuf::from(destination.trim());
    if destination.as_os_str().is_empty()
        || !destination
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Err("Setup diagnostics export must use a .zip destination".to_string());
    }
    let destination = if destination.is_absolute() {
        destination
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Failed to resolve diagnostics export path: {error}"))?
            .join(destination)
    };
    let root = crate::paths::diagnostics_log_dir();
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create setup diagnostics directory: {error}"))?;

    // The same lock protects writers and creates a consistent point-in-time
    // snapshot without truncating or moving an active session.
    {
        let mut guard = diagnostics_state()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        ensure_diagnostics_state(&mut guard)?.flush()?;
    }
    archive_directory(&root, &destination)?;
    Ok(destination.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "junqi-setup-progress-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn prunes_complete_sessions_as_whole_directories() {
        let root = test_directory("prune");
        for name in ["001", "002", "003", "004"] {
            let session = root.join(name);
            std::fs::create_dir_all(&session).unwrap();
            std::fs::write(session.join(SETUP_SESSION_MANIFEST), "{}").unwrap();
            std::fs::write(session.join("setup-session.log"), name).unwrap();
        }
        std::fs::write(root.join("README.txt"), "keep").unwrap();

        prune_setup_runs(&root, 2, None).unwrap();

        assert!(!root.join("001").exists());
        assert!(!root.join("002").exists());
        assert!(root.join("003/setup-session.log").exists());
        assert!(root.join("004/setup-session.log").exists());
        assert!(root.join("README.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn exports_regular_files_and_skips_destination() {
        let root = test_directory("archive");
        std::fs::create_dir_all(root.join("setup-runs/001")).unwrap();
        std::fs::write(root.join("setup-runs/001/setup-session.log"), "complete").unwrap();
        let destination = root.join("diagnostics.zip");

        archive_directory(&root, &destination).unwrap();

        let file = File::open(&destination).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert_eq!(archive.len(), 1);
        let mut entry = archive.by_name("setup-runs/001/setup-session.log").unwrap();
        let mut content = String::new();
        entry.read_to_string(&mut content).unwrap();
        assert_eq!(content, "complete");
        drop(entry);
        drop(archive);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn process_file_components_cannot_escape_the_session() {
        assert_eq!(safe_file_component("../../npm verbose"), "npm-verbose");
        assert_eq!(safe_file_component(""), "process");
    }

    #[test]
    fn retries_append_numbered_attempt_boundaries() {
        let root = test_directory("attempts");
        let mut state = initialize_diagnostics_state(&root).unwrap();

        append_attempt_boundary(&mut state, "openclaw", "first").unwrap();
        append_attempt_boundary(&mut state, "openclaw", "second").unwrap();
        state.flush().unwrap();

        let timeline =
            std::fs::read_to_string(state.session_dir.join("openclaw-timeline.log")).unwrap();
        assert!(timeline.contains("attempt 1 started first"));
        assert!(timeline.contains("attempt 2 started second"));
        drop(state);
        let _ = std::fs::remove_dir_all(root);
    }
}
