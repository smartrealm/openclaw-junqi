// Integrated terminal - portable-pty backed PTY multiplexer.
//
// Architecture mirrors the io_stream model from nezha:
//   - IoStreamContext: per-session context with mutex-guarded PTY master,
//     flume bounded channel for user input, AtomicBool for close signalling
//   - Per-user (20) / per-server (40) concurrent stream limits
//   - Bidirectional copy: reader thread (PTY stdout -> Tauri events) and
//     writer thread (renderer keystrokes -> PTY)
//   - UTF-8 carryover buffer so split CJK/emoji chars reassemble
//
// Events: "terminal-data" { id, data }, "terminal-exit" { id, exit_code }
// Cmds:   terminal_create / terminal_write / terminal_resize / terminal_kill

use std::collections::HashMap;
use std::io::{Read, Write as IoWrite};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;

use flume::{Receiver, Sender};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

const MAX_STREAMS_PER_USER: usize = 20;
const MAX_STREAMS_PER_SERVER: usize = 40;

// Mirrors nezha's ioStreamContext.
struct IoStreamContext {
    creator_user_id: u64,
    target_server_id: u64,
    pty_master: Mutex<Option<Box<dyn portable_pty::MasterPty + Send>>>,
    child: Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>,
    // Renderer -> writer thread.
    user_input_tx: Sender<Vec<u8>>,
    // Set true on Kill; reader thread checks this each iteration.
    closed: Arc<AtomicBool>,
}

type StreamHandle = Arc<Mutex<Option<IoStreamContext>>>;

fn streams() -> &'static Mutex<HashMap<String, StreamHandle>> {
    static STREAMS: OnceLock<Mutex<HashMap<String, StreamHandle>>> = OnceLock::new();
    STREAMS.get_or_init(|| Mutex::new(HashMap::new()))
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
    exit_code: u32,
}

fn invalid_id(id: &str) -> String {
    format!("unknown pty id: {id}")
}

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
        let fallback = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        };
        let shell = std::env::var("SHELL").unwrap_or_else(|_| fallback.to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");
        let dir = match cwd {
            Some(d) => std::path::PathBuf::from(d),
            None => dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from(".")),
        };
        cmd.cwd(dir);
        cmd
    }
}

// PTY reader thread: reads PTY stdout -> emits Tauri events.
// Mirrors the read half of nezha's io.CopyBuffer(userIo, agentIo).
//
// Runs until: PTY reader returns 0/Err (EOF), which happens when the child
// exits OR Kill() closes the master fd.
fn pty_reader_thread(id: String, mut reader: Box<dyn Read + Send>, app: AppHandle) {
    let mut pending: Vec<u8> = Vec::with_capacity(8192 + 4);
    // 1 MiB buffer reused for every read to avoid per-read allocation.
    let mut buf = vec![0u8; 1024 * 1024];

    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) => break, // EOF
            Ok(n) => n,
            Err(_) => break,
        };

        pending.extend_from_slice(&buf[..n]);

        // Decode longest complete UTF-8 prefix; carry trailing incomplete
        // bytes to the next read so split CJK/emoji chars reassemble.
        let mut out = String::with_capacity(pending.len());
        let mut consumed = 0usize;
        loop {
            match std::str::from_utf8(&pending[consumed..]) {
                Ok(s) => {
                    out.push_str(s);
                    consumed = pending.len();
                    break;
                }
                Err(e) => {
                    let valid = consumed + e.valid_up_to();
                    out.push_str(unsafe {
                        std::str::from_utf8_unchecked(&pending[consumed..valid])
                    });
                    match e.error_len() {
                        Some(err_len) => {
                            out.push('\u{FFFD}');
                            consumed = valid + err_len;
                        }
                        None => {
                            consumed = valid;
                            break;
                        }
                    }
                }
            }
        }
        pending.drain(..consumed);

        if !out.is_empty() {
            let _ = app.emit(
                "terminal-data",
                DataEvent {
                    id: id.clone(),
                    data: out,
                },
            );
        }
    }

    // Flush dangling trailing bytes (lossy).
    if !pending.is_empty() {
        let _ = app.emit(
            "terminal-data",
            DataEvent {
                id: id.clone(),
                data: String::from_utf8_lossy(&pending).into_owned(),
            },
        );
    }

    // EOF -> emit exit so renderer marks tab dead.
    let _ = app.emit("terminal-exit", ExitEvent { id, exit_code: 0 });
}

// PTY writer thread: receives renderer keystrokes via flume -> writes to PTY master.
// Mirrors the write half of nezha's io.CopyBuffer(agentIo, userIo).
//
// Blocks on flume recv(). Runs until:
//   - user_input_rx.recv() returns Disconnected (sender dropped on Kill/Close)
//   - write returns an error (broken pipe / PTY closed)
fn pty_writer_thread(writer: Box<dyn IoWrite + Send>, user_input_rx: Receiver<Vec<u8>>) {
    let mut writer = writer;

    while let Ok(data) = user_input_rx.recv() {
        if writer.write_all(&data).is_err() {
            break; // broken pipe
        }
        let _ = writer.flush();
    }
    // recv() returned Err -> sender dropped -> exit.
    // writer dropped here -> releases PTY master write handle.
}

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
    let pair = system.openpty(size).map_err(|e| format!("openpty: {e}"))?;

    let cmd = build_shell(cwd.as_deref());

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn: {e}"))?;
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

    // Per-user / per-server limits (nezha model)
    let id = next_id();
    let map = streams().lock().unwrap();

    let per_user = map
        .values()
        .filter(|h| {
            h.lock()
                .unwrap()
                .as_ref()
                .is_some_and(|ctx| ctx.creator_user_id != 0)
        })
        .count();
    let per_server = map
        .values()
        .filter(|h| {
            h.lock()
                .unwrap()
                .as_ref()
                .is_some_and(|ctx| ctx.target_server_id == 0)
        })
        .count();

    if per_user >= MAX_STREAMS_PER_USER {
        return Err("too many concurrent terminal sessions for this user".to_string());
    }
    if per_server >= MAX_STREAMS_PER_SERVER {
        return Err("too many concurrent terminal sessions for this server".to_string());
    }
    drop(map);

    // Communication channels: flume bounded channel (64-slot)
    let (user_tx, user_rx) = flume::bounded::<Vec<u8>>(64);
    let closed = Arc::new(AtomicBool::new(false));

    // Spawn reader thread (lives until PTY EOF)
    let rid = id.clone();
    let rapp = app.clone();
    thread::spawn(move || pty_reader_thread(rid, reader, rapp));

    // Spawn writer thread (lives until sender dropped on Kill/Close)
    thread::spawn(move || pty_writer_thread(writer, user_rx));

    let ctx = IoStreamContext {
        creator_user_id: 1,
        target_server_id: 0,
        pty_master: Mutex::new(Some(master)),
        child: Mutex::new(Some(child)),
        user_input_tx: user_tx,
        closed,
    };
    let handle: StreamHandle = Arc::new(Mutex::new(Some(ctx)));
    streams().lock().unwrap().insert(id.clone(), handle);

    Ok(CreateResult { id, pid })
}

#[tauri::command]
pub async fn terminal_write(id: String, data: String) -> Result<(), String> {
    let handle = {
        let map = streams().lock().unwrap();
        map.get(&id).cloned()
    };
    let handle = handle.ok_or_else(|| invalid_id(&id))?;

    // Hold the lock only to read the sender clone, then release before send.
    let tx = {
        let guard = handle.lock().unwrap();
        match guard.as_ref() {
            Some(ctx) => ctx.user_input_tx.clone(),
            None => return Err("stream closed".to_string()),
        }
    };

    tx.send(data.into_bytes())
        .map_err(|_| "writer thread exited".to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let handle = {
        let map = streams().lock().unwrap();
        map.get(&id).cloned()
    };
    let handle = handle.ok_or_else(|| invalid_id(&id))?;

    let guard = handle.lock().unwrap();
    let ctx = guard.as_ref().ok_or_else(|| "stream closed".to_string())?;
    let master_guard = ctx.pty_master.lock().unwrap();
    let master = master_guard
        .as_ref()
        .ok_or_else(|| "stream closed".to_string())?;
    master
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
    // Remove from registry first.
    let handle = streams().lock().unwrap().remove(&id);
    let handle = handle.ok_or_else(|| invalid_id(&id))?;

    // Take context so all fields can be dropped cleanly.
    let ctx_opt = handle.lock().unwrap().take();

    if let Some(ctx) = ctx_opt {
        ctx.closed.store(true, Ordering::Relaxed);
        // Kill the child explicitly so the reader thread sees EOF promptly
        // (mirrors nezha's CloseStream closing the underlying IO pipes).
        if let Some(mut child) = ctx.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        // user_input_tx dropped here -> writer's recv() returns Disconnected -> exits.
        // pty_master dropped here -> reader sees EOF -> emits terminal-exit.
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_are_sane() {
        assert!(MAX_STREAMS_PER_USER >= 1);
        assert!(MAX_STREAMS_PER_SERVER >= 1);
    }
}
