// ── Shared PTY infrastructure (ported from nezha) ─────────────────────────
//
// Provides the shell terminal backend for JunQi. Uses the same portable-pty
// primitives and bounded-channel architecture as nezha's desktop terminal:
//   - Bounded emit channel (32 slots) with backpressure propagation to OS PTY
//   - UTF-8 carryover buffer for split CJK/emoji codepoints
//   - Batched event emission with flush interval
//   - Font-ready / WebGL-safe size guard: cols < 2 || rows < 2 → no-op
//
// Events: "shell-output" { shell_id, data }
// Cmds:   open_shell, kill_shell, send_input, resize_pty

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};

// ── Constants (mirrors nezha) ─────────────────────────────────────────────

const PTY_READ_BUFFER_SIZE: usize = 32 * 1024;
const PTY_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const PTY_EMIT_MAX_BATCH_BYTES: usize = 64 * 1024;
/// Bounded channel capacity: when full, the reader thread blocks, propagating
/// backpressure to the OS PTY buffer, which eventually blocks the writing
/// process (Claude/Codex) at the write() syscall level — throttling at the source.
const PTY_EMIT_CHANNEL_CAPACITY: usize = 32;

// ── Global registry ───────────────────────────────────────────────────────

struct PtyHandles {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    closed: Arc<AtomicBool>,
}

type PtyHandle = Arc<Mutex<Option<PtyHandles>>>;

fn pty_registry() -> &'static Mutex<std::collections::HashMap<String, PtyHandle>> {
    static REGISTRY: OnceLock<Mutex<std::collections::HashMap<String, PtyHandle>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

static SHELL_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_shell_id() -> String {
    format!("shell-{}", SHELL_COUNTER.fetch_add(1, Ordering::Relaxed))
}

// ── Environment setup (mirrors nezha) ─────────────────────────────────────

/// Set standard environment variables on a CommandBuilder for PTY child processes.
fn setup_env(cmd: &mut CommandBuilder) {
    // Ensure locale is UTF-8.
    // macOS Terminal.app / iTerm2 auto-inject LANG, but Tauri apps launched
    // from the Dock have no locale vars, breaking CJK input in PTY children.
    let has = |name: &str| std::env::var(name).is_ok();
    if !has("LANG") {
        cmd.env("LANG", "en_US.UTF-8");
    }
    if !has("LC_CTYPE") {
        cmd.env("LC_CTYPE", "en_US.UTF-8");
    }

    // Set terminal type so TUI programs (Claude Code / Codex) emit correct escape sequences.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
}

/// Build a shell CommandBuilder for the current platform.
/// Uses the user's $SHELL on Unix; falls back to zsh (macOS) or bash (Linux).
fn build_shell_cmd(project_path: &str) -> CommandBuilder {
    let fallback = if cfg!(target_os = "macos") {
        "/bin/zsh"
    } else {
        "/bin/bash"
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| fallback.to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(project_path);
    cmd
}

// ── Output routing ────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum PtyEmitMode {
    Immediate,
    Batched {
        flush_interval: Duration,
        max_batch_bytes: usize,
    },
}

/// Output destination: shell terminals use event-based emit so multiple
/// frontend panels can subscribe by shell_id.
#[derive(Clone)]
enum OutputSink {
    Event {
        event_name: &'static str,
        id_key: &'static str,
    },
}

fn send_pty_chunk(app: &AppHandle, id: &str, sink: &OutputSink, data: String) {
    match sink {
        OutputSink::Event { event_name, id_key } => {
            let mut payload = serde_json::Map::new();
            payload.insert((*id_key).to_string(), serde_json::Value::String(id.to_string()));
            payload.insert("data".to_string(), serde_json::Value::String(data));
            let _ = app.emit(event_name, serde_json::Value::Object(payload));
        }
    }
}

fn flush_pty_batch(app: &AppHandle, id: &str, sink: &OutputSink, batch: &mut String) {
    if batch.is_empty() {
        return;
    }
    send_pty_chunk(app, id, sink, std::mem::take(batch));
}

/// Spawn a background thread that reads PTY output and delivers it to the
/// frontend via the configured sink.
///
/// - `sink`: shell terminals use `OutputSink::Event` for multi-panel broadcast
/// - `on_finish`: optional cleanup callback when the PTY reader exits
fn spawn_pty_reader(
    app: AppHandle,
    id: String,
    sink: OutputSink,
    emit_mode: PtyEmitMode,
    reader: Box<dyn Read + Send>,
    on_finish: Option<Box<dyn FnOnce() + Send>>,
) {
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; PTY_READ_BUFFER_SIZE];
        // Save incomplete UTF-8 byte sequences from the previous read.
        let mut leftover: Vec<u8> = Vec::new();
        let (emit_tx, emit_worker) = match emit_mode {
            PtyEmitMode::Immediate => (None, None),
            PtyEmitMode::Batched {
                flush_interval,
                max_batch_bytes,
            } => {
                let (tx, rx) = std::sync::mpsc::sync_channel::<String>(PTY_EMIT_CHANNEL_CAPACITY);
                let emit_app = app.clone();
                let emit_id = id.clone();
                let worker_sink = sink.clone();
                let worker = std::thread::spawn(move || {
                    let mut batch = String::new();
                    loop {
                        match rx.recv_timeout(flush_interval) {
                            Ok(chunk) => {
                                batch.push_str(&chunk);
                                if batch.len() >= max_batch_bytes {
                                    flush_pty_batch(
                                        &emit_app,
                                        &emit_id,
                                        &worker_sink,
                                        &mut batch,
                                    );
                                }
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                                flush_pty_batch(
                                    &emit_app,
                                    &emit_id,
                                    &worker_sink,
                                    &mut batch,
                                );
                            }
                            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                                flush_pty_batch(
                                    &emit_app,
                                    &emit_id,
                                    &worker_sink,
                                    &mut batch,
                                );
                                break;
                            }
                        }
                    }
                });
                (Some(tx), Some(worker))
            }
        };
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let mut combined = std::mem::take(&mut leftover);
                    combined.extend_from_slice(&buf[..n]);

                    let valid_len = match std::str::from_utf8(&combined) {
                        Ok(_) => combined.len(),
                        Err(e) => e.valid_up_to(),
                    };

                    if valid_len > 0 {
                        // SAFETY: valid_len bytes are confirmed valid UTF-8
                        let data = unsafe {
                            std::str::from_utf8_unchecked(&combined[..valid_len]).to_owned()
                        };
                        if let Some(ref tx) = emit_tx {
                            match tx.send(data) {
                                Ok(()) => {}
                                Err(err) => send_pty_chunk(&app, &id, &sink, err.0),
                            }
                        } else {
                            send_pty_chunk(&app, &id, &sink, data);
                        }
                    }

                    if valid_len < combined.len() {
                        leftover = combined[valid_len..].to_vec();
                    }
                }
            }
        }
        drop(emit_tx);
        if let Some(worker) = emit_worker {
            let _ = worker.join();
        }
        if let Some(f) = on_finish {
            f();
        }
    });
}

// ── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_shell(
    app: AppHandle,
    shell_id: String,
    project_path: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    // Kill any existing shell with the same ID first.
    {
        let registry = pty_registry().lock().unwrap();
        if let Some(handle) = registry.get(&shell_id) {
            let guard = handle.lock().unwrap();
            if let Some(handles) = guard.as_ref() {
                let _ = handles.child.lock().unwrap().kill();
            }
        }
        drop(registry);
        remove_pty_handles(&shell_id);
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(120),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = build_shell_cmd(&project_path);
    setup_env(&mut cmd);

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let handles = PtyHandles {
        master: pair.master,
        writer: Mutex::new(writer),
        child: Arc::new(Mutex::new(child)),
        closed: Arc::new(AtomicBool::new(false)),
    };

    pty_registry()
        .lock()
        .unwrap()
        .insert(shell_id.clone(), Arc::new(Mutex::new(Some(handles))));

    // Cleanup callback: when the shell exits, remove handles from the registry.
    let app_cleanup = app.clone();
    let sid_cleanup = shell_id.clone();
    let on_finish = Box::new(move || {
        remove_pty_handles(&sid_cleanup);
        drop(app_cleanup); // keep AppHandle alive until here
    });

    spawn_pty_reader(
        app,
        shell_id,
        OutputSink::Event {
            event_name: "shell-output",
            id_key: "shell_id",
        },
        PtyEmitMode::Immediate,
        reader,
        Some(on_finish),
    );

    Ok(())
}

fn remove_pty_handles(shell_id: &str) {
    let handle = pty_registry().lock().unwrap().remove(shell_id);
    if let Some(handle) = handle {
        let guard = handle.lock().unwrap();
        if let Some(handles) = guard.as_ref() {
            handles.closed.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn kill_shell(shell_id: String) -> Result<(), String> {
    let handle = pty_registry().lock().unwrap().remove(&shell_id);
    if let Some(handle) = handle {
        let guard = handle.lock().unwrap();
        if let Some(handles) = guard.as_ref() {
            handles.closed.store(true, Ordering::Relaxed);
            let _ = handles.child.lock().unwrap().kill();
        }
    }
    Ok(())
}

#[tauri::command]
pub fn send_input(task_id: String, data: String) -> Result<(), String> {
    let registry = pty_registry().lock().unwrap();
    let handle = registry
        .get(&task_id)
        .ok_or_else(|| format!("unknown shell id: {task_id}"))?;
    let guard = handle.lock().unwrap();
    let handles = guard
        .as_ref()
        .ok_or_else(|| format!("shell closed: {task_id}"))?;
    handles
        .writer
        .lock()
        .map_err(|_| "writer lock poisoned".to_string())?
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(task_id: String, cols: u16, rows: u16) -> Result<(), String> {
    // Guard: reject degenerate sizes. FitAddon in a display:none container can
    // report cols=2, which would send SIGWINCH cols=2 to Claude Code / Codex
    // and permanently shred the TUI layout. Frontend has three layers of defense;
    // this is the fourth and final backstop.
    if cols < 2 || rows < 2 || cols > 10_000 || rows > 10_000 {
        return Ok(());
    }
    let registry = pty_registry().lock().unwrap();
    let handle = registry
        .get(&task_id)
        .ok_or_else(|| format!("unknown shell id: {task_id}"))?;
    let guard = handle.lock().unwrap();
    let handles = guard
        .as_ref()
        .ok_or_else(|| format!("shell closed: {task_id}"))?;
    handles
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
