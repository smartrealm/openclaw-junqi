//! Controlled PTY bridge for the official OpenClaw onboarding CLI.
//!
//! The renderer receives terminal bytes only. It cannot choose a program or
//! arguments: this module always launches the selected runtime's fixed
//! `openclaw onboard` contract from `openclaw_cli`.

use portable_pty::{native_pty_system, Child, ChildKiller, PtySize};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;
const READ_BUFFER_SIZE: usize = 32 * 1024;
const ONBOARDING_STOP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialOnboardingStart {
    session_id: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OfficialOnboardingOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OfficialOnboardingExit {
    session_id: String,
    exit_code: Option<u32>,
    reason: &'static str,
}

/// Owns exactly one fixed official `openclaw onboard` process. The renderer
/// can exchange terminal bytes, but process selection and lifecycle remain in
/// Rust so a cancellation cannot leave an orphaned CLI or Windows child tree.
struct OnboardingProcessSupervisor {
    master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    #[cfg(windows)]
    process_id: Option<u32>,
    session_id: String,
    termination_requested: AtomicBool,
    exited: AtomicBool,
    exit_notify: Notify,
}

type OnboardingHandle = Arc<OnboardingProcessSupervisor>;

enum OnboardingRegistryEntry {
    Starting,
    Active(OnboardingHandle),
}

fn onboarding_registry() -> &'static Mutex<Option<OnboardingRegistryEntry>> {
    static REGISTRY: OnceLock<Mutex<Option<OnboardingRegistryEntry>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(None))
}

static ONBOARDING_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_session_id() -> String {
    format!(
        "official-onboard-{}",
        ONBOARDING_COUNTER.fetch_add(1, Ordering::Relaxed),
    )
}

fn reserve_onboarding_start() -> Result<(), String> {
    let mut registry = onboarding_registry()
        .lock()
        .map_err(|_| "official onboarding registry lock poisoned".to_string())?;
    if registry.is_some() {
        return Err("OpenClaw official onboarding is already starting or running".to_string());
    }
    *registry = Some(OnboardingRegistryEntry::Starting);
    Ok(())
}

fn release_onboarding_start() {
    let Ok(mut registry) = onboarding_registry().lock() else {
        return;
    };
    if matches!(registry.as_ref(), Some(OnboardingRegistryEntry::Starting)) {
        registry.take();
    }
}

fn activate_onboarding(handle: OnboardingHandle) -> Result<(), String> {
    let mut registry = onboarding_registry()
        .lock()
        .map_err(|_| "official onboarding registry lock poisoned".to_string())?;
    match registry.as_ref() {
        Some(OnboardingRegistryEntry::Starting) => {
            *registry = Some(OnboardingRegistryEntry::Active(handle));
            Ok(())
        }
        Some(OnboardingRegistryEntry::Active(_)) => {
            Err("OpenClaw official onboarding is already running".to_string())
        }
        None => Err("OpenClaw official onboarding startup was interrupted".to_string()),
    }
}

fn close_master(handle: &OnboardingHandle) {
    if let Ok(mut master) = handle.master.lock() {
        master.take();
    }
}

fn remove_if_current(handle: &OnboardingHandle) {
    let mut registry = match onboarding_registry().lock() {
        Ok(registry) => registry,
        Err(_) => return,
    };
    if registry.as_ref().is_some_and(|current| match current {
        OnboardingRegistryEntry::Active(current) => Arc::ptr_eq(current, handle),
        OnboardingRegistryEntry::Starting => false,
    }) {
        registry.take();
    }
}

async fn request_termination(handle: &OnboardingHandle) -> Result<(), String> {
    if handle.termination_requested.swap(true, Ordering::AcqRel) {
        return Ok(());
    }

    let mut errors = Vec::new();
    #[cfg(windows)]
    if let Some(process_id) = handle.process_id {
        if let Err(error) =
            crate::commands::process_control::terminate_windows_process_tree(process_id).await
        {
            if !crate::commands::process_control::process_tree_was_already_gone(&error) {
                errors.push(error);
            }
        }
    }

    match handle.killer.lock() {
        Ok(mut killer) => {
            if let Err(error) = killer.kill() {
                if !matches!(
                    error.kind(),
                    std::io::ErrorKind::InvalidInput | std::io::ErrorKind::NotFound
                ) {
                    errors.push(format!("terminate official onboarding: {error}"));
                }
            }
        }
        Err(_) => errors.push("official onboarding killer lock poisoned".to_string()),
    }
    close_master(handle);

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

async fn wait_for_exit(handle: &OnboardingHandle) -> Result<(), String> {
    if handle.exited.load(Ordering::Acquire) {
        return Ok(());
    }
    let notified = handle.exit_notify.notified();
    if handle.exited.load(Ordering::Acquire) {
        return Ok(());
    }
    tokio::time::timeout(ONBOARDING_STOP_TIMEOUT, notified)
        .await
        .map_err(|_| {
            format!(
                "official onboarding did not exit within {} seconds after cancellation",
                ONBOARDING_STOP_TIMEOUT.as_secs()
            )
        })
}

async fn terminate_and_reap(handle: &OnboardingHandle) -> Result<(), String> {
    let termination = request_termination(handle).await;
    let reaped = wait_for_exit(handle).await;
    match (termination, reaped) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(termination), Ok(())) => Err(termination),
        (Ok(()), Err(reaped)) => Err(reaped),
        (Err(termination), Err(reaped)) => Err(format!("{termination}; {reaped}")),
    }
}

/// Startup can fail after the PTY child exists but before it is placed in the
/// registry. Reap that child explicitly instead of relying on a dropped handle
/// to stop it (portable-pty does not guarantee that on Windows).
async fn terminate_unregistered_child(
    mut child: Box<dyn Child + Send + Sync>,
) -> Result<(), String> {
    #[cfg(windows)]
    let process_id = child.process_id();
    let mut errors = Vec::new();

    #[cfg(windows)]
    if let Some(process_id) = process_id {
        if let Err(error) =
            crate::commands::process_control::terminate_windows_process_tree(process_id).await
        {
            if !crate::commands::process_control::process_tree_was_already_gone(&error) {
                errors.push(error);
            }
        }
    }

    if let Err(error) = child.kill() {
        if !matches!(
            error.kind(),
            std::io::ErrorKind::InvalidInput | std::io::ErrorKind::NotFound
        ) {
            errors.push(format!("terminate official onboarding: {error}"));
        }
    }

    let reaped = tokio::time::timeout(
        ONBOARDING_STOP_TIMEOUT,
        tokio::task::spawn_blocking(move || child.wait()),
    )
    .await;
    match reaped {
        Ok(Ok(Ok(_))) => {}
        Ok(Ok(Err(error))) => errors.push(format!("wait for official onboarding: {error}")),
        Ok(Err(error)) => errors.push(format!("join official onboarding waiter: {error}")),
        Err(_) => errors.push(format!(
            "official onboarding did not exit within {} seconds after startup cleanup",
            ONBOARDING_STOP_TIMEOUT.as_secs()
        )),
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn emit_output(app: &AppHandle, session_id: &str, data: String) {
    if data.is_empty() {
        return;
    }
    let _ = app.emit(
        "official-onboarding-output",
        OfficialOnboardingOutput {
            session_id: session_id.to_string(),
            data,
        },
    );
}

fn emit_exit(app: &AppHandle, session_id: &str, exit_code: Option<u32>, reason: &'static str) {
    let _ = app.emit(
        "official-onboarding-exit",
        OfficialOnboardingExit {
            session_id: session_id.to_string(),
            exit_code,
            reason,
        },
    );
}

/// Pull valid UTF-8 from a PTY fragment while preserving a trailing partial
/// code point for the next read. Interactive CJK onboarding text otherwise
/// corrupts when the terminal splits a character across packets.
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
                    // SAFETY: `from_utf8` reported this prefix as valid.
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

fn spawn_reader(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn Read + Send>,
    handle: OnboardingHandle,
) {
    std::thread::spawn(move || {
        let mut chunk = [0_u8; READ_BUFFER_SIZE];
        let mut pending = Vec::with_capacity(READ_BUFFER_SIZE + 4);

        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    pending.extend_from_slice(&chunk[..read]);
                    let text = take_utf8_ready(&mut pending);
                    // A PTY read can block indefinitely after rendering a prompt.
                    // Emit every valid fragment so interactive onboarding remains
                    // responsive instead of waiting for a later read to flush it.
                    emit_output(&app, &session_id, text);
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }

        if !pending.is_empty() {
            emit_output(
                &app,
                &session_id,
                String::from_utf8_lossy(&pending).into_owned(),
            );
        }

        // Child ownership and the terminal exit event belong to the exit
        // monitor. A reader can observe EOF before `wait()` obtains the code.
        if handle.termination_requested.load(Ordering::Relaxed) {
            close_master(&handle);
        }
    });
}

fn spawn_exit_monitor(
    app: AppHandle,
    session_id: String,
    mut child: Box<dyn Child + Send + Sync>,
    handle: OnboardingHandle,
) {
    std::thread::spawn(move || {
        let status = child.wait();
        let terminated = handle.termination_requested.load(Ordering::Acquire);
        if !terminated {
            match status {
                Ok(status) => emit_exit(&app, &session_id, Some(status.exit_code()), "exited"),
                Err(_) => emit_exit(&app, &session_id, None, "wait_error"),
            }
        }
        handle.termination_requested.store(true, Ordering::Release);
        handle.exited.store(true, Ordering::Release);
        handle.exit_notify.notify_waiters();
        close_master(&handle);
        remove_if_current(&handle);
    });
}

fn current_handle(session_id: &str) -> Result<OnboardingHandle, String> {
    let registry = onboarding_registry()
        .lock()
        .map_err(|_| "official onboarding registry lock poisoned".to_string())?;
    let handle = match registry.as_ref() {
        Some(OnboardingRegistryEntry::Active(handle)) if handle.session_id == session_id => {
            handle.clone()
        }
        Some(OnboardingRegistryEntry::Starting) => {
            return Err("official onboarding session is still starting".to_string())
        }
        _ => return Err("official onboarding session is not active".to_string()),
    };
    if handle.termination_requested.load(Ordering::Acquire) {
        return Err("official onboarding session is stopping".to_string());
    }
    Ok(handle)
}

#[tauri::command]
pub async fn start_official_onboarding(
    app: AppHandle,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<OfficialOnboardingStart, String> {
    let mut command = crate::commands::openclaw_cli::build_official_onboarding_command().await?;
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");

    let session_id = next_session_id();
    reserve_onboarding_start()?;

    let pair = match native_pty_system().openpty(PtySize {
        rows: rows.unwrap_or(32).clamp(2, 10_000),
        cols: cols.unwrap_or(112).clamp(2, 10_000),
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(pair) => pair,
        Err(error) => {
            release_onboarding_start();
            return Err(format!("open official onboarding terminal: {error}"));
        }
    };
    let child = match pair.slave.spawn_command(command) {
        Ok(child) => child,
        Err(error) => {
            release_onboarding_start();
            return Err(format!("start official OpenClaw onboarding: {error}"));
        }
    };
    drop(pair.slave);
    let reader = match pair.master.try_clone_reader() {
        Ok(reader) => reader,
        Err(error) => {
            drop(pair.master);
            let cleanup = terminate_unregistered_child(child).await;
            release_onboarding_start();
            return Err(match cleanup {
                Ok(()) => format!("open official onboarding reader: {error}"),
                Err(cleanup) => format!(
                    "open official onboarding reader: {error}; startup cleanup failed: {cleanup}"
                ),
            });
        }
    };
    let writer = match pair.master.take_writer() {
        Ok(writer) => writer,
        Err(error) => {
            drop(reader);
            drop(pair.master);
            let cleanup = terminate_unregistered_child(child).await;
            release_onboarding_start();
            return Err(match cleanup {
                Ok(()) => format!("open official onboarding writer: {error}"),
                Err(cleanup) => format!(
                    "open official onboarding writer: {error}; startup cleanup failed: {cleanup}"
                ),
            });
        }
    };
    let handle = Arc::new(OnboardingProcessSupervisor {
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
        #[cfg(windows)]
        process_id: child.process_id(),
        session_id: session_id.clone(),
        termination_requested: AtomicBool::new(false),
        exited: AtomicBool::new(false),
        exit_notify: Notify::new(),
    });
    if let Err(error) = activate_onboarding(handle.clone()) {
        drop(handle);
        let cleanup = terminate_unregistered_child(child).await;
        return Err(match cleanup {
            Ok(()) => error,
            Err(cleanup) => format!("{error}; startup cleanup failed: {cleanup}"),
        });
    }

    spawn_exit_monitor(app.clone(), session_id.clone(), child, handle.clone());
    spawn_reader(app, session_id.clone(), reader, handle);
    Ok(OfficialOnboardingStart { session_id })
}

#[tauri::command]
pub fn write_official_onboarding(session_id: String, data: String) -> Result<(), String> {
    if data.len() > MAX_INPUT_BYTES {
        return Err("official onboarding input exceeds 4 MiB".to_string());
    }
    let handle = current_handle(&session_id)?;
    let mut writer = handle
        .writer
        .lock()
        .map_err(|_| "official onboarding writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_official_onboarding(session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    if cols < 2 || rows < 2 || cols > 10_000 || rows > 10_000 {
        return Ok(());
    }
    let handle = current_handle(&session_id)?;
    let mut master = handle
        .master
        .lock()
        .map_err(|_| "official onboarding master lock poisoned".to_string())?;
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

#[tauri::command]
pub async fn stop_official_onboarding(session_id: String) -> Result<(), String> {
    let handle = current_handle(&session_id)?;
    terminate_and_reap(&handle).await
}

#[cfg(test)]
mod tests {
    use super::take_utf8_ready;

    #[test]
    fn utf8_reader_keeps_partial_cjk_until_the_next_chunk() {
        let mut bytes = vec![0xe9, 0x85];
        assert_eq!(take_utf8_ready(&mut bytes), "");
        bytes.push(0x8d);
        assert_eq!(take_utf8_ready(&mut bytes), "配");
        assert!(bytes.is_empty());
    }
}
