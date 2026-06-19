//! Integrated terminal — portable-pty backed PTY multiplexer.
//!
//! Each `terminal_create` call spawns a login shell in its own PTY, holds the
//! writer + master + child in a global registry keyed by an opaque id, and
//! pumps PTY stdout on a dedicated reader thread → `terminal-data` event.
//! When the reader hits EOF (child exited / pipe closed) we emit
//! `terminal-exit` so the renderer can mark the tab dead.
//!
//! Lifecycle mirrors the JS contract in `src/types/global.d.ts`:
//!   create({cols,rows,cwd?}) → { id, pid }
//!   write(id, data) / resize(id, cols, rows) / kill(id)
//!   events: "terminal-data" { id, data }, "terminal-exit" { id, exitCode }

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

// ── Registry ────────────────────────────────────────────────────────────────

/// A live PTY. `writer` and `master` are guarded per-entry so concurrent
/// write/resize on different tabs never contend on the global map lock.
struct PtyInner {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    #[allow(dead_code)] // held so the child isn't reaped early; waited in kill/EOF
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

type PtyHandle = Arc<Mutex<PtyInner>>;

fn ptys() -> &'static Mutex<HashMap<String, PtyHandle>> {
    static PTYS: OnceLock<Mutex<HashMap<String, PtyHandle>>> = OnceLock::new();
    PTYS.get_or_init(|| Mutex::new(HashMap::new()))
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);
fn next_id() -> String {
    format!("pty-{}", ID_COUNTER.fetch_add(1, Ordering::Relaxed))
}

#[derive(Serialize, Clone)]
pub struct CreateResult {
    id: String,
    pid: u32,
}

#[derive(Serialize, Clone)]
pub struct DataEvent {
    id: String,
    data: String,
}

#[derive(Serialize, Clone)]
pub struct ExitEvent {
    id: String,
    #[allow(dead_code)]
    exit_code: u32,
}

// ── Shell selection ─────────────────────────────────────────────────────────

/// Build the default shell command for the host platform. Unix uses the
/// `$SHELL` env var (falling back to zsh on macOS / bash on Linux); Windows
/// prefers PowerShell, then cmd. The shell runs as a login shell so the
/// user's rc files (PATH aliases, prompts) load — GUI apps on macOS launch
/// with a minimal environment and would otherwise lose /usr/local/bin etc.
fn build_shell(cwd: Option<&str>) -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        if let Some(d) = cwd {
            cmd.cwd(d);
        }
        cmd
    }
    #[cfg(not(windows))]
    {
        let fallback = if cfg!(target_os = "macos") { "/bin/zsh" } else { "/bin/bash" };
        let shell = std::env::var("SHELL").unwrap_or_else(|_| fallback.to_string());
        let mut cmd = CommandBuilder::new(&shell);
        // Login shell → loads ~/.zprofile / ~/.bash_profile, fixing PATH under
        // GUI launches. portable-pty inherits the current env by default.
        cmd.arg("-l");
        let dir = match cwd {
            Some(d) => std::path::PathBuf::from(d),
            None => dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")),
        };
        cmd.cwd(dir);
        cmd
    }
}

// ── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn terminal_create(
    app: AppHandle,
    cols: Option<u16>,
    rows: Option<u16>,
    cwd: Option<String>,
) -> Result<CreateResult, String> {
    let cols = cols.unwrap_or(80).max(1);
    let rows = rows.unwrap_or(24).max(1);
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let system = native_pty_system();
    let pair = system
        .openpty(size)
        .map_err(|e| format!("openpty: {e}"))?;

    let mut cmd = build_shell(cwd.as_deref());
    let _ = &mut cmd; // silence move confusion in build_shell return

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;
    // Drop the slave once the child is spawned — keeping it open pins the
    // PTY and prevents the child from seeing EOF on its controlling tty.
    drop(pair.slave);

    let pid = child.process_id().unwrap_or(0) as u32;

    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("take_writer: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("try_clone_reader: {e}"))?;
    let master = pair.master;

    let id = next_id();
    let inner = Arc::new(Mutex::new(PtyInner {
        master,
        writer,
        child,
    }));
    ptys().lock().unwrap().insert(id.clone(), inner);

    // Pump stdout → "terminal-data". Reader returns 0 / Err on child exit,
    // at which point we emit "terminal-exit" and drop the entry.
    let app_handle = app.clone();
    let pump_id = id.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app_handle.emit(
                        "terminal-data",
                        DataEvent { id: pump_id.clone(), data },
                    );
                }
                Err(_) => break,
            }
        }
        // Child's stdout pipe is closed → it has exited (or was killed).
        // Best-effort exit code; the renderer only uses onExit to mark the
        // tab dead, not the code value.
        let _ = ptys().lock().unwrap().remove(&pump_id);
        let _ = app_handle.emit(
            "terminal-exit",
            ExitEvent { id: pump_id.clone(), exit_code: 0 },
        );
    });

    Ok(CreateResult { id, pid })
}

#[tauri::command]
pub async fn terminal_write(id: String, data: String) -> Result<(), String> {
    let handle = {
        let map = ptys().lock().unwrap();
        map.get(&id).cloned()
    };
    let handle = handle.ok_or_else(|| format!("unknown pty id: {id}"))?;
    let mut inner = handle.lock().map_err(|e| format!("lock: {e}"))?;
    inner
        .writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("write: {e}"))?;
    // Flush is best-effort; some writers are unbuffered and lack flush.
    let _ = inner.writer.flush();
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let handle = {
        let map = ptys().lock().unwrap();
        map.get(&id).cloned()
    };
    let handle = handle.ok_or_else(|| format!("unknown pty id: {id}"))?;
    let inner = handle.lock().map_err(|e| format!("lock: {e}"))?;
    inner
        .master
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("resize: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_kill(id: String) -> Result<(), String> {
    if let Some(handle) = ptys().lock().unwrap().remove(&id) {
        let mut inner = handle.lock().map_err(|e| format!("lock: {e}"))?;
        // kill() sends SIGHUP/SIGKILL; the reader thread will then hit EOF and
        // emit terminal-exit. We don't wait here to keep the command snappy.
        let _ = inner.child.kill();
    }
    Ok(())
}
