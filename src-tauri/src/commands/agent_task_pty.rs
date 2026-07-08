// ── Agent task PTY — data-driven agent spawner ───────────────────────────────
//
// Inspired by kooky's AgentTemplate model (Sources/KookyKit/Sessions/AgentTemplate.swift).
// Each agent is defined as a struct with its binary name, permission flags,
// prompt-launch flag, and resume flag — no more hardcoded if/else per agent.
//
// Supported agents: claude, codex, gemini, cursor-agent, amp, copilot, grok, pi,
// kiro-cli, antigravity (agy), kimi, opencode, aider, qwen.
//
// 2026-06-22: Session watcher + push notifications. 2026-06-22: Data-driven refactor.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

// ── State ───────────────────────────────────────────────────────────────────

struct PtyHandles {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    closed: Arc<AtomicBool>,
}

type PtyHandle = Arc<Mutex<Option<PtyHandles>>>;

fn pty_registry() -> &'static Mutex<HashMap<String, PtyHandle>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, PtyHandle>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_tasks() -> &'static Mutex<std::collections::HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

const PTY_READ_BUFFER_SIZE: usize = 32 * 1024;
const PTY_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const PTY_EMIT_MAX_BATCH_BYTES: usize = 64 * 1024;

// ── run_task ────────────────────────────────────────────────────────────────

// ── Agent definitions (data-driven, inspired by kooky's AgentTemplate) ───────

struct AgentSpec {
    /// Binary name on PATH. Also used as the lookup key from the frontend.
    bin: &'static str,
    /// Display label (for logs / notifications).
    #[allow(dead_code)]
    label: &'static str,
    /// CLI flag(s) for permission mode: (ask, auto_edit, full_access).
    /// Empty vec = agent doesn't support permission modes.
    perm_flags: Option<(&'static str, &'static str, &'static str)>,
    /// Flag the binary expects before a prompt argument. None = positional
    /// (e.g. Claude takes `claude "prompt"` directly). Some("-p") = `copilot -p "prompt"`.
    /// Some("--") = `codex -- "prompt"` (POSIX separator).
    prompt_flag: Option<&'static str>,
    /// Flag for resuming a conversation. None = resume not supported yet.
    #[allow(dead_code)]
    resume_flag: Option<&'static str>,
    /// Whether this agent reports per-tool-call activity (Claude via hooks,
    /// Pi via extension events). Drives the frontend's tool-call pill.
    reports_tool_calls: bool,
}

/// All known agent templates. Ordered by popularity / default preference.
/// `resume_flag` + `reports_tool_calls` are stored for future resume / tool-call UI.
static AGENTS: &[AgentSpec] = &[
    AgentSpec {
        bin: "claude",
        label: "Claude Code",
        perm_flags: Some((
            "--permission-mode default",
            "--permission-mode acceptEdits",
            "--dangerously-skip-permissions",
        )),
        prompt_flag: None,
        resume_flag: Some("--resume"),
        reports_tool_calls: true,
    },
    AgentSpec {
        bin: "codex",
        label: "Codex",
        perm_flags: Some((
            "--permission-mode default",
            "--permission-mode auto",
            "--dangerously-bypass-approvals",
        )),
        prompt_flag: Some("--"),
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "gemini",
        label: "Gemini CLI",
        perm_flags: None,
        prompt_flag: None,
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "cursor-agent",
        label: "Cursor CLI",
        perm_flags: None,
        prompt_flag: None,
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "amp",
        label: "Amp",
        perm_flags: None,
        prompt_flag: Some("-x"),
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "copilot",
        label: "Copilot CLI",
        perm_flags: None,
        prompt_flag: Some("-p"),
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "grok",
        label: "Grok Build",
        perm_flags: None,
        prompt_flag: None,
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "pi",
        label: "Pi",
        perm_flags: None,
        prompt_flag: Some("-p"),
        resume_flag: Some("--session"),
        reports_tool_calls: true,
    },
    AgentSpec {
        bin: "kiro-cli",
        label: "Kiro CLI",
        perm_flags: None,
        prompt_flag: None,
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "agy",
        label: "Antigravity CLI",
        perm_flags: None,
        prompt_flag: Some("-i"),
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "kimi",
        label: "Kimi Code",
        perm_flags: None,
        prompt_flag: Some("-p"),
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "opencode",
        label: "OpenCode",
        perm_flags: None,
        prompt_flag: None,
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "aider",
        label: "Aider",
        perm_flags: None,
        prompt_flag: Some("--msg"),
        resume_flag: None,
        reports_tool_calls: false,
    },
    AgentSpec {
        bin: "qwen",
        label: "Qwen CLI",
        perm_flags: None,
        prompt_flag: None,
        resume_flag: None,
        reports_tool_calls: false,
    },
];

fn find_agent(agent_id: &str) -> Option<&'static AgentSpec> {
    AGENTS.iter().find(|a| a.bin == agent_id)
}

fn list_agent_ids() -> Vec<&'static str> {
    AGENTS.iter().map(|a| a.bin).collect()
}

/// Map `permission_mode` to the CLI flag the agent expects.
fn permission_flag(agent: &str, mode: &str) -> Vec<String> {
    let Some(spec) = find_agent(agent) else {
        return Vec::new();
    };
    let Some((ask, auto, full)) = spec.perm_flags else {
        return Vec::new();
    };
    let flag = match mode {
        "ask" => ask,
        "auto_edit" => auto,
        "full_access" => full,
        _ => return Vec::new(),
    };
    vec![flag.to_string()]
}

#[tauri::command]
pub async fn run_task(
    app: AppHandle,
    task_id: String,
    project_path: String,
    prompt: String,
    agent: String,
    permission_mode: String,
    cols: Option<u16>,
    rows: Option<u16>,
    on_output: Channel<String>,
    resume_id: Option<String>,
) -> Result<(), String> {
    // Clear any cancellation flag from a previous run.
    let _ = cancelled_tasks().lock().unwrap().remove(&task_id);

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.unwrap_or(50),
            cols: cols.unwrap_or(220),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // ── Build command from agent spec ──────────────────────────────────────
    let spec = find_agent(&agent).ok_or_else(|| {
        format!(
            "Unknown agent '{}'. Supported: {}",
            agent,
            list_agent_ids().join(", ")
        )
    })?;

    let mut cmd = CommandBuilder::new(spec.bin);
    cmd.cwd(&project_path);
    for arg in permission_flag(&agent, &permission_mode) {
        cmd.arg(arg);
    }
    // Resume flag: prepend --resume <id> before the prompt.
    if let Some(flag) = spec.resume_flag {
        if let Some(ref rid) = resume_id {
            if !rid.is_empty() {
                cmd.arg(flag);
                cmd.arg(rid.clone());
            }
        }
    }
    if !prompt.is_empty() {
        if let Some(flag) = spec.prompt_flag {
            cmd.arg(flag);
        }
        cmd.arg(&prompt);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let closed = Arc::new(AtomicBool::new(false));

    let handle = Arc::new(Mutex::new(Some(PtyHandles {
        master: pair.master,
        writer: Mutex::new(writer),
        child: Arc::new(Mutex::new(child)),
        closed: closed.clone(),
    })));

    pty_registry()
        .lock()
        .unwrap()
        .insert(task_id.clone(), handle);

    // Emit "running" so the frontend can update task status without polling.
    let _ = app.emit(
        "task-status",
        serde_json::json!({ "task_id": task_id, "status": "running" }),
    );

    // ── Tool-call activity watcher (kooky-style event strip) ─────────────────
    spawn_toolcall_watcher(app.clone(), task_id.clone());

    // ── Session watcher: discover JSONL in background ────────────────────────
    spawn_session_watcher(
        app.clone(),
        task_id.clone(),
        project_path.clone(),
        agent.clone(),
    );

    // ── Background reader: batched flush via Channel ─────────────────────────
    let app_for_reader = app.clone();
    let task_id_for_reader = task_id.clone();
    std::thread::spawn(move || {
        let mut buffer = Vec::with_capacity(PTY_EMIT_MAX_BATCH_BYTES);
        let mut last_flush = std::time::Instant::now();
        let mut reader = reader;
        let mut chunk = vec![0u8; PTY_READ_BUFFER_SIZE];

        loop {
            let closed_now = closed.load(Ordering::Relaxed);
            if closed_now && buffer.is_empty() {
                break;
            }
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    buffer.extend_from_slice(&chunk[..n]);
                }
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }

            // Flush if batch is full or interval elapsed.
            let should_flush = buffer.len() >= PTY_EMIT_MAX_BATCH_BYTES
                || (!buffer.is_empty() && last_flush.elapsed() >= PTY_EMIT_FLUSH_INTERVAL);
            if should_flush {
                let payload = String::from_utf8_lossy(&buffer).into_owned();
                buffer.clear();
                last_flush = std::time::Instant::now();
                if let Err(e) = on_output.send(payload) {
                    eprintln!("[run_task] on_output.send failed: {e}");
                    break;
                }
            }
        }

        // Final flush.
        if !buffer.is_empty() {
            let payload = String::from_utf8_lossy(&buffer).into_owned();
            let _ = on_output.send(payload);
        }

        // Determine exit status from the child process result.
        let child_exited_ok = {
            let registry = pty_registry().lock().unwrap();
            if let Some(handle) = registry.get(&task_id_for_reader) {
                if let Some(handles) = handle.lock().unwrap().as_ref() {
                    handles
                        .child
                        .lock()
                        .unwrap()
                        .try_wait()
                        .ok()
                        .flatten()
                        .map(|s| s.success())
                        .unwrap_or(true)
                } else {
                    true
                }
            } else {
                true
            }
        };

        let final_status = if closed.load(Ordering::Relaxed) {
            "cancelled"
        } else if child_exited_ok {
            "done"
        } else {
            "failed"
        };

        // Cleanup on exit.
        pty_registry().lock().unwrap().remove(&task_id_for_reader);
        let _ = app_for_reader.emit(
            "task-status",
            serde_json::json!({ "task_id": task_id_for_reader, "status": final_status }),
        );

        // Push notification
        let notif_title = match final_status {
            "cancelled" => "Task cancelled",
            "failed" => "Task failed",
            _ => "Task completed",
        };
        let notif_level = match final_status {
            "cancelled" | "failed" => "warning",
            _ => "info",
        };
        super::notification::push_local_notification(
            notif_level,
            notif_title,
            &format!(
                "Agent task {} ended with status: {}",
                &task_id_for_reader[..task_id_for_reader.len().min(16)],
                final_status
            ),
            None,
        );
    });

    Ok(())
}

// ── Session watcher ──────────────────────────────────────────────────────────
//
// After the agent PTY spawns, Claude Code writes session JSONL to
//   ~/.claude/projects/<project-hash>/*.jsonl
// and Codex writes to
//   <project>/.codex/sessions/*.jsonl
//
// This background task polls the expected directory for new files (by mtime
// after task start time), and emits `task-session` when a match is found.

fn spawn_session_watcher(app: AppHandle, task_id: String, project_path: String, agent: String) {
    std::thread::spawn(move || {
        let start_time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // Determine scan directory.
        let scan_dir = if agent == "codex" {
            std::path::PathBuf::from(&project_path)
                .join(".codex")
                .join("sessions")
        } else {
            // Claude: resolve ~/.claude/projects/<hash> by scanning subdirs
            let home = dirs_next().unwrap_or_else(|| {
                std::path::PathBuf::from(
                    std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string()),
                )
            });
            home.join(".claude").join("projects")
        };

        // Poll up to 60 seconds (30 attempts × 2s).
        for _attempt in 0..30 {
            std::thread::sleep(std::time::Duration::from_secs(2));

            let Ok(entries) = std::fs::read_dir(&scan_dir) else {
                continue;
            };

            for entry in entries.flatten() {
                let path = entry.path();

                // Only consider .jsonl files.
                if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                    // Claude: the sessions dir contains project-hash subdirs.
                    if agent != "codex" && path.is_dir() {
                        // Recurse one level: ~/.claude/projects/<hash>/*.jsonl
                        if let Ok(inner) = std::fs::read_dir(&path) {
                            for inner_entry in inner.flatten() {
                                let inner_path = inner_entry.path();
                                if inner_path.extension().and_then(|e| e.to_str()) == Some("jsonl")
                                    && file_newer_than(&inner_path, start_time)
                                {
                                    let session_id = inner_path
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("unknown");
                                    let session_path_str = inner_path.to_string_lossy().to_string();
                                    let _ = app.emit(
                                        "task-session",
                                        serde_json::json!({
                                            "task_id": task_id,
                                            "session_id": session_id,
                                            "session_path": &session_path_str,
                                        }),
                                    );
                                    super::notification::push_local_notification(
                                        "info",
                                        "Session discovered",
                                        &format!(
                                            "Task {} session file found at {}",
                                            &task_id[..task_id.len().min(12)],
                                            session_path_str
                                        ),
                                        Some(&format!(
                                            "/session?path={}",
                                            url_encode(&session_path_str)
                                        )),
                                    );
                                    return;
                                }
                            }
                        }
                    }
                    continue;
                }

                if file_newer_than(&path, start_time) {
                    let session_id = path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("unknown");
                    let session_path_str = path.to_string_lossy().to_string();
                    let _ = app.emit(
                        "task-session",
                        serde_json::json!({
                            "task_id": task_id,
                            "session_id": session_id,
                            "session_path": &session_path_str,
                        }),
                    );
                    super::notification::push_local_notification(
                        "info",
                        "Session discovered",
                        &format!(
                            "Task {} session file found",
                            &task_id[..task_id.len().min(12)]
                        ),
                        Some(&format!("/session?path={}", url_encode(&session_path_str))),
                    );
                    return;
                }
            }
        }

        // Timed out — emit a sentinel so the frontend knows discovery failed.
        let _ = app.emit(
            "task-session-timeout",
            serde_json::json!({ "task_id": task_id }),
        );
    });
}

/// Tool-call activity watcher — kooky ToolCallActivityStrip model.
///
/// Scans the running session's JSONL file (once discovered) for tool_use
/// events emitted by Claude Code / Pi. Bash / Edit / Read / Other
/// counters stream to the frontend in real-time so the status bar's
/// tool-call pill reflects what the agent is doing.
///
/// Until the session file is discovered, we watch the task registry's
/// PTY output buffer via a polling hook: as soon as the session file
/// exists, we tail it for tool_use blocks.
fn spawn_toolcall_watcher(app: tauri::AppHandle, task_id: String) {
    std::thread::spawn(move || {
        // Wait for session file to appear (poll for up to 60s).
        let mut session_path: Option<String> = None;
        for _ in 0..60 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            // We don't know the session file path here — it's in the
            // session watcher. Listen via the global state instead:
            // scan the task registry's recent output by checking
            // ~/.claude/projects and .codex/sessions.
            let candidates = recent_session_files();
            if let Some(p) = candidates.first() {
                session_path = Some(p.clone());
                break;
            }
        }
        let Some(path) = session_path else {
            return;
        };

        // Tail JSONL file: every line is a Claude / Codex session entry.
        // Count tool_use blocks by name.
        let mut last_size: u64 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(500));
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            if (text.len() as u64) <= last_size {
                continue;
            }
            last_size = text.len() as u64;

            // Count tool names in the new portion.
            let mut bash = 0u32;
            let mut edit = 0u32;
            let mut read = 0u32;
            let mut other = 0u32;
            let mut latest_tool = String::new();
            for line in text.lines() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(name) = v
                        .pointer("/message/content/0/name")
                        .and_then(|n| n.as_str())
                    {
                        latest_tool = name.to_string();
                        match name.to_lowercase().as_str() {
                            "bash" => bash += 1,
                            "edit" | "write" | "multiedit" | "notebookedit" => edit += 1,
                            "read" => read += 1,
                            _ => other += 1,
                        }
                    }
                }
            }
            let _ = app.emit(
                "task-toolcall",
                serde_json::json!({
                    "task_id": task_id,
                    "bash": bash,
                    "edit": edit,
                    "read": read,
                    "other": other,
                    "latest": latest_tool,
                }),
            );
        }
    });
}

/// Find the most recent Claude/Codex session file across known directories.
/// Cheap scan: list_dir + sort by mtime, return the newest .jsonl.
fn recent_session_files() -> Vec<String> {
    let home = match dirs_next() {
        Some(h) => h,
        None => return Vec::new(),
    };
    let mut paths: Vec<(std::time::SystemTime, String)> = Vec::new();

    // Claude: ~/.claude/projects/*/*.jsonl
    let claude_dir = home.join(".claude").join("projects");
    if let Ok(read) = std::fs::read_dir(&claude_dir) {
        for proj in read.flatten() {
            if let Ok(read2) = std::fs::read_dir(proj.path()) {
                for f in read2.flatten() {
                    let p = f.path();
                    if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                        if let Ok(meta) = f.metadata() {
                            if let Ok(mtime) = meta.modified() {
                                paths.push((mtime, p.to_string_lossy().to_string()));
                            }
                        }
                    }
                }
            }
        }
    }

    // Codex: $cwd/.codex/sessions/*.jsonl (search common cwd candidates)
    if let Ok(cwd) = std::env::current_dir() {
        let codex_dir = cwd.join(".codex").join("sessions");
        if let Ok(read) = std::fs::read_dir(&codex_dir) {
            for f in read.flatten() {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                    if let Ok(meta) = f.metadata() {
                        if let Ok(mtime) = meta.modified() {
                            paths.push((mtime, p.to_string_lossy().to_string()));
                        }
                    }
                }
            }
        }
    }

    paths.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    paths.into_iter().take(1).map(|(_, p)| p).collect()
}

/// Minimal URL-encode for file paths used in notification deep-links.
fn url_encode(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            '/' => "%2F".to_string(),
            ':' => "%3A".to_string(),
            ' ' => "%20".to_string(),
            '\\' => "%5C".to_string(),
            other if other.is_ascii_alphanumeric() || ".-_~".contains(other) => other.to_string(),
            other => {
                let mut buf = [0u8; 4];
                let encoded = other.encode_utf8(&mut buf);
                encoded.bytes().map(|b| format!("%{:02X}", b)).collect()
            }
        })
        .collect()
}

fn file_newer_than(path: &std::path::Path, threshold_secs: u64) -> bool {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() >= threshold_secs)
        .unwrap_or(false)
}

/// Resolve the user's home directory.
fn dirs_next() -> Option<std::path::PathBuf> {
    std::env::var("HOME")
        .or_else(|_| {
            if cfg!(target_os = "windows") {
                std::env::var("USERPROFILE")
            } else {
                Err(std::env::VarError::NotPresent)
            }
        })
        .ok()
        .map(std::path::PathBuf::from)
}

#[tauri::command]
pub async fn agent_send_input(task_id: String, data: String) -> Result<(), String> {
    let registry = pty_registry().lock().unwrap();
    let Some(handle) = registry.get(&task_id) else {
        return Ok(()); // PTY closed; silently drop.
    };
    {
        let handle_guard = handle.lock().unwrap();
        let Some(handles) = handle_guard.as_ref() else {
            return Ok(());
        };
        let mut writer = handles.writer.lock().unwrap();
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn agent_resize_pty(task_id: String, cols: u16, rows: u16) -> Result<(), String> {
    // Sanity bounds — defends against bogus frontend resize calls that would
    // otherwise trigger SIGWINCH and reset agent TUIs to single-column.
    if cols < 2 || rows < 2 || cols > 10_000 || rows > 10_000 {
        return Ok(());
    }
    let registry = pty_registry().lock().unwrap();
    if let Some(handle) = registry.get(&task_id) {
        let handle_guard = handle.lock().unwrap();
        if let Some(handles) = handle_guard.as_ref() {
            handles
                .master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_task(task_id: String) -> Result<(), String> {
    let _ = cancelled_tasks().lock().unwrap().insert(task_id.clone());
    let registry = pty_registry().lock().unwrap();
    if let Some(handle) = registry.get(&task_id) {
        if let Some(handles) = handle.lock().unwrap().as_ref() {
            handles.closed.store(true, Ordering::Relaxed);
            let mut child = handles.child.lock().unwrap();
            let _ = child.kill();
        }
    }
    Ok(())
}

/// Diagnostic: list all currently live task IDs. Useful for testing and
/// for the frontend's "active task" indicator.
#[tauri::command]
pub fn get_active_task_ids() -> Vec<String> {
    pty_registry().lock().unwrap().keys().cloned().collect()
}
