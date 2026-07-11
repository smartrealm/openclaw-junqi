//! Interactive shell PTY backend.
//!
//! This is the one lifecycle used by JunQi's Terminal workspace. It mirrors
//! Kooky's invariants while remaining portable across Tauri's supported OSes:
//! - every shell run has an id, so delayed cleanup cannot kill a replacement;
//! - the listener subscribes before launch and receives batched UTF-8 output;
//! - process exit is explicit instead of leaving a dead-looking terminal tab;
//! - shells inherit the user's login environment and fall back safely when a
//!   persisted project folder no longer exists.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, ChildKiller, PtySize};
use tauri::{AppHandle, Emitter};

const PTY_READ_BUFFER_SIZE: usize = 32 * 1024;
const PTY_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const PTY_EMIT_MAX_BATCH_BYTES: usize = 64 * 1024;
const PTY_EMIT_CHANNEL_CAPACITY: usize = 32;
const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SHELL_RUN_ID_BYTES: usize = 128;

#[derive(serde::Serialize)]
pub struct OpenShellResult {
    cwd: String,
    run_id: String,
}

#[derive(serde::Serialize, Clone)]
struct ShellOutputEvent {
    shell_id: String,
    run_id: String,
    data: String,
}

#[derive(serde::Serialize, Clone)]
struct ShellExitEvent {
    shell_id: String,
    run_id: String,
    exit_code: Option<u32>,
    reason: &'static str,
}

struct PtyHandles {
    master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    run_id: String,
    termination_requested: Arc<AtomicBool>,
}

type PtyHandle = Arc<PtyHandles>;

fn pty_registry() -> &'static Mutex<HashMap<String, PtyHandle>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, PtyHandle>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

static SHELL_RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_shell_run_id() -> String {
    format!(
        "shell-run-{}",
        SHELL_RUN_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

fn normalized_run_id(value: Option<String>) -> String {
    value
        .filter(|run_id| !run_id.trim().is_empty() && run_id.len() <= MAX_SHELL_RUN_ID_BYTES)
        .unwrap_or_else(next_shell_run_id)
}

fn resolve_shell_cwd(project_path: &str) -> PathBuf {
    let candidate = PathBuf::from(project_path);
    if candidate.is_dir() {
        return candidate.canonicalize().unwrap_or(candidate);
    }

    crate::platform::home_dir()
        .filter(|path| path.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn run_matches(handle: &PtyHandle, requested_run_id: Option<&str>) -> bool {
    requested_run_id.is_none_or(|run_id| handle.run_id == run_id)
}

fn close_master(handle: &PtyHandle) {
    if let Ok(mut master) = handle.master.lock() {
        master.take();
    }
}

fn terminate_handle(handle: &PtyHandle) {
    handle.termination_requested.store(true, Ordering::Relaxed);
    if let Ok(mut killer) = handle.killer.lock() {
        let _ = killer.kill();
    };
    // On Windows this drops the ConPTY handle, so descendants cannot keep the
    // reader alive after the shell process itself has been terminated.
    close_master(handle);
}

fn remove_handle_if_current(shell_id: &str, handle: &PtyHandle) {
    let removed = {
        let mut registry = match pty_registry().lock() {
            Ok(registry) => registry,
            Err(_) => return,
        };
        if registry
            .get(shell_id)
            .is_some_and(|current| Arc::ptr_eq(current, handle))
        {
            registry.remove(shell_id)
        } else {
            None
        }
    };
    drop(removed);
}

fn emit_shell_output(app: &AppHandle, shell_id: &str, run_id: &str, data: String) {
    if data.is_empty() {
        return;
    }
    let _ = app.emit(
        "shell-output",
        ShellOutputEvent {
            shell_id: shell_id.to_string(),
            run_id: run_id.to_string(),
            data,
        },
    );
}

fn emit_shell_exit(
    app: &AppHandle,
    shell_id: &str,
    run_id: &str,
    exit_code: Option<u32>,
    reason: &'static str,
) {
    let _ = app.emit(
        "shell-exit",
        ShellExitEvent {
            shell_id: shell_id.to_string(),
            run_id: run_id.to_string(),
            exit_code,
            reason,
        },
    );
}

/// Pull all valid UTF-8 out of a stream fragment while retaining a trailing
/// incomplete codepoint for the next PTY read. Invalid complete bytes become
/// U+FFFD so one malformed byte never blocks all following terminal output.
fn take_utf8_ready(bytes: &mut Vec<u8>) -> String {
    let mut output = String::new();
    loop {
        match std::str::from_utf8(bytes) {
            Ok(text) => {
                output.push_str(text);
                bytes.clear();
                return output;
            }
            Err(error) => {
                let valid_len = error.valid_up_to();
                if valid_len > 0 {
                    // SAFETY: from_utf8 reported this prefix as valid.
                    output.push_str(unsafe { std::str::from_utf8_unchecked(&bytes[..valid_len]) });
                }
                match error.error_len() {
                    Some(invalid_len) => {
                        output.push('\u{FFFD}');
                        bytes.drain(..valid_len + invalid_len);
                    }
                    None => {
                        bytes.drain(..valid_len);
                        return output;
                    }
                }
            }
        }
    }
}

fn spawn_pty_reader(
    app: AppHandle,
    shell_id: String,
    run_id: String,
    reader: Box<dyn Read + Send>,
    handle: PtyHandle,
) {
    std::thread::spawn(move || {
        let (emit_tx, emit_rx) = std::sync::mpsc::sync_channel::<String>(PTY_EMIT_CHANNEL_CAPACITY);
        let emitter_app = app.clone();
        let emitter_shell_id = shell_id.clone();
        let emitter_run_id = run_id.clone();
        let emitter = std::thread::spawn(move || {
            let mut batch = String::new();
            loop {
                match emit_rx.recv_timeout(PTY_EMIT_FLUSH_INTERVAL) {
                    Ok(chunk) => {
                        batch.push_str(&chunk);
                        if batch.len() >= PTY_EMIT_MAX_BATCH_BYTES {
                            emit_shell_output(
                                &emitter_app,
                                &emitter_shell_id,
                                &emitter_run_id,
                                std::mem::take(&mut batch),
                            );
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        emit_shell_output(
                            &emitter_app,
                            &emitter_shell_id,
                            &emitter_run_id,
                            std::mem::take(&mut batch),
                        );
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        emit_shell_output(
                            &emitter_app,
                            &emitter_shell_id,
                            &emitter_run_id,
                            std::mem::take(&mut batch),
                        );
                        break;
                    }
                }
            }
        });

        let mut reader = reader;
        let mut buffer = [0u8; PTY_READ_BUFFER_SIZE];
        let mut pending = Vec::with_capacity(PTY_READ_BUFFER_SIZE + 4);
        let mut read_error = false;

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    pending.extend_from_slice(&buffer[..read]);
                    let data = take_utf8_ready(&mut pending);
                    if !data.is_empty() && emit_tx.send(data).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => {
                    read_error = true;
                    break;
                }
            }
        }

        if !pending.is_empty() {
            let _ = emit_tx.send(String::from_utf8_lossy(&pending).into_owned());
        }
        drop(emit_tx);
        let _ = emitter.join();

        let termination_requested = handle.termination_requested.load(Ordering::Relaxed);
        if read_error && !termination_requested {
            emit_shell_exit(&app, &shell_id, &run_id, None, "io_error");
            terminate_handle(&handle);
        }
        remove_handle_if_current(&shell_id, &handle);
    });
}

fn spawn_exit_monitor(
    app: AppHandle,
    shell_id: String,
    run_id: String,
    mut child: Box<dyn Child + Send + Sync>,
    handle: PtyHandle,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        let termination_requested = handle.termination_requested.load(Ordering::Relaxed);

        if !termination_requested {
            match status {
                Ok(status) => {
                    emit_shell_exit(&app, &shell_id, &run_id, Some(status.exit_code()), "exited")
                }
                Err(_) => emit_shell_exit(&app, &shell_id, &run_id, None, "wait_error"),
            }
        }
        // Mark completion before the reader observes ConPTY closure so a
        // normal exit cannot be reported again as an I/O failure.
        handle.termination_requested.store(true, Ordering::Relaxed);
        #[cfg(windows)]
        close_master(&handle);
        remove_handle_if_current(&shell_id, &handle);
    });
}

#[tauri::command]
pub fn open_shell(
    app: AppHandle,
    shell_id: String,
    project_path: String,
    cols: Option<u16>,
    rows: Option<u16>,
    run_id: Option<String>,
) -> Result<OpenShellResult, String> {
    let run_id = normalized_run_id(run_id);

    // Replacing a tab's shell is deliberate (restart / persisted session
    // restore). Remove first, then kill outside the registry lock so a slow
    // process cannot block unrelated terminal operations.
    if let Some(previous) = pty_registry().lock().unwrap().remove(&shell_id) {
        terminate_handle(&previous);
    }

    let cwd = resolve_shell_cwd(&project_path);
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.unwrap_or(24).clamp(2, 10_000),
            cols: cols.unwrap_or(120).clamp(2, 10_000),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("open terminal PTY: {error}"))?;

    let command =
        crate::commands::terminal_shell_integration::build_interactive_shell_command(&app, &cwd);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("start shell: {error}"))?;
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("open terminal reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("open terminal writer: {error}"))?;
    let killer = child.clone_killer();
    let handle = Arc::new(PtyHandles {
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
        run_id: run_id.clone(),
        termination_requested: Arc::new(AtomicBool::new(false)),
    });

    pty_registry()
        .lock()
        .unwrap()
        .insert(shell_id.clone(), handle.clone());

    spawn_exit_monitor(
        app.clone(),
        shell_id.clone(),
        run_id.clone(),
        child,
        handle.clone(),
    );
    spawn_pty_reader(app, shell_id, run_id.clone(), reader, handle);

    Ok(OpenShellResult {
        cwd: cwd.to_string_lossy().into_owned(),
        run_id,
    })
}

#[tauri::command]
pub fn kill_shell(shell_id: String, run_id: Option<String>) -> Result<(), String> {
    let handle = {
        let mut registry = pty_registry()
            .lock()
            .map_err(|_| "terminal registry lock poisoned".to_string())?;
        match registry.get(&shell_id) {
            Some(handle) if run_matches(handle, run_id.as_deref()) => registry.remove(&shell_id),
            Some(_) => None,
            None => None,
        }
    };
    if let Some(handle) = handle {
        terminate_handle(&handle);
    }
    Ok(())
}

#[tauri::command]
pub fn send_input(task_id: String, run_id: Option<String>, data: String) -> Result<(), String> {
    if data.len() > MAX_INPUT_BYTES {
        return Err("terminal input exceeds 4 MiB".to_string());
    }
    let handle = pty_registry()
        .lock()
        .map_err(|_| "terminal registry lock poisoned".to_string())?
        .get(&task_id)
        .cloned()
        .ok_or_else(|| format!("unknown shell id: {task_id}"))?;
    if !run_matches(&handle, run_id.as_deref()) {
        return Err(format!("stale shell run: {task_id}"));
    }
    if handle.termination_requested.load(Ordering::Relaxed) {
        return Err(format!("shell closed: {task_id}"));
    }
    let mut writer = handle
        .writer
        .lock()
        .map_err(|_| "terminal writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_pty(
    task_id: String,
    run_id: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if cols < 2 || rows < 2 || cols > 10_000 || rows > 10_000 {
        return Ok(());
    }
    let handle = pty_registry()
        .lock()
        .map_err(|_| "terminal registry lock poisoned".to_string())?
        .get(&task_id)
        .cloned()
        .ok_or_else(|| format!("unknown shell id: {task_id}"))?;
    if !run_matches(&handle, run_id.as_deref()) {
        return Ok(());
    }
    if handle.termination_requested.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut master = handle
        .master
        .lock()
        .map_err(|_| "terminal master lock poisoned".to_string())?;
    let Some(master) = master.as_mut() else {
        return Ok(());
    };
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{normalized_run_id, resolve_shell_cwd, take_utf8_ready};

    #[test]
    fn utf8_decoder_keeps_incomplete_cjk_until_the_next_read() {
        let mut bytes = vec![b'a', 0xe4, 0xb8];
        assert_eq!(take_utf8_ready(&mut bytes), "a");
        assert_eq!(bytes, vec![0xe4, 0xb8]);

        bytes.push(0xad);
        assert_eq!(take_utf8_ready(&mut bytes), "中");
        assert!(bytes.is_empty());
    }

    #[test]
    fn utf8_decoder_recovers_after_invalid_complete_bytes() {
        let mut bytes = vec![b'a', 0xff, b'b'];
        assert_eq!(take_utf8_ready(&mut bytes), "a\u{FFFD}b");
        assert!(bytes.is_empty());
    }

    #[test]
    fn shell_cwd_falls_back_when_a_persisted_folder_no_longer_exists() {
        let cwd = resolve_shell_cwd("/path/that/junqi/does/not/own");
        assert!(cwd.is_dir());
    }

    #[test]
    fn blank_or_unbounded_run_ids_are_replaced() {
        assert!(normalized_run_id(Some(" ".to_string())).starts_with("shell-run-"));
        assert!(normalized_run_id(Some("x".repeat(129))).starts_with("shell-run-"));
        assert_eq!(normalized_run_id(Some("run-1".to_string())), "run-1");
    }
}
