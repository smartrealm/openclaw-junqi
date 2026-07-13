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

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
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

fn manually_completed_tasks() -> &'static Mutex<std::collections::HashSet<String>> {
    static COMPLETED: OnceLock<Mutex<std::collections::HashSet<String>>> = OnceLock::new();
    COMPLETED.get_or_init(|| Mutex::new(std::collections::HashSet::new()))
}

fn reset_task_process_inner(task_id: &str) {
    let _ = cancelled_tasks().lock().unwrap().remove(task_id);
    let _ = manually_completed_tasks().lock().unwrap().remove(task_id);
    let handle = pty_registry().lock().unwrap().remove(task_id);
    if let Some(handle) = handle {
        if let Some(handles) = handle.lock().unwrap().as_ref() {
            handles.closed.store(true, Ordering::Relaxed);
            let _ = handles.child.lock().unwrap().kill();
        }
    }
    task_output_buffers().lock().unwrap().remove(task_id);
}

fn task_output_buffers() -> &'static Mutex<HashMap<String, String>> {
    static OUTPUTS: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    OUTPUTS.get_or_init(|| Mutex::new(HashMap::new()))
}

const PTY_READ_BUFFER_SIZE: usize = 32 * 1024;
const PTY_EMIT_FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const PTY_EMIT_MAX_BATCH_BYTES: usize = 64 * 1024;
const MAX_TASK_OUTPUT_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;
const MAX_TASK_ATTACHMENT_IMAGES: usize = 10;
const MAX_TASK_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
const MAX_TASK_TEXT_ATTACHMENTS: usize = 10;
const MAX_TASK_TEXT_BYTES: usize = 256 * 1024;

fn append_task_output(task_id: &str, output: &str) {
    let mut buffers = task_output_buffers().lock().unwrap();
    let buffer = buffers.entry(task_id.to_string()).or_default();
    buffer.push_str(output);
    if buffer.len() <= MAX_TASK_OUTPUT_SNAPSHOT_BYTES {
        return;
    }

    let mut trim_at = buffer.len() - MAX_TASK_OUTPUT_SNAPSHOT_BYTES;
    while trim_at < buffer.len() && !buffer.is_char_boundary(trim_at) {
        trim_at += 1;
    }
    buffer.drain(..trim_at);
}

pub(crate) fn safe_task_id(task_id: &str) -> String {
    task_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn task_attachments_dir(project_path: &str, task_id: &str) -> PathBuf {
    PathBuf::from(project_path)
        .join(".junqi")
        .join("attachments")
        .join(safe_task_id(task_id))
}

fn cleanup_task_attachments(project_path: &str, task_id: &str) {
    let _ = fs::remove_dir_all(task_attachments_dir(project_path, task_id));
}

fn decode_task_image(data_url: &str) -> Result<(&str, Vec<u8>), String> {
    let (header, encoded) = data_url
        .split_once(',')
        .ok_or_else(|| "attachment image is not a data URL".to_string())?;
    let extension = match header {
        "data:image/png;base64" => "png",
        "data:image/jpeg;base64" => "jpg",
        "data:image/webp;base64" => "webp",
        "data:image/gif;base64" => "gif",
        _ => return Err("unsupported attachment image type".to_string()),
    };
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "attachment image has invalid base64 data".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_TASK_ATTACHMENT_BYTES {
        return Err("attachment image exceeds the 10 MiB limit".to_string());
    }
    Ok((extension, bytes))
}

fn save_task_attachments(
    project_path: &str,
    task_id: &str,
    images: &[String],
    texts: &[String],
) -> Result<(Vec<String>, Vec<String>), String> {
    if images.len() > MAX_TASK_ATTACHMENT_IMAGES {
        return Err(format!(
            "at most {MAX_TASK_ATTACHMENT_IMAGES} image attachments are allowed"
        ));
    }
    if texts.len() > MAX_TASK_TEXT_ATTACHMENTS {
        return Err(format!(
            "at most {MAX_TASK_TEXT_ATTACHMENTS} text attachments are allowed"
        ));
    }
    if images.is_empty() && texts.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    let directory = task_attachments_dir(project_path, task_id);
    fs::create_dir_all(&directory)
        .map_err(|error| format!("create attachment directory: {error}"))?;

    let mut image_paths = Vec::with_capacity(images.len());
    for (index, image) in images.iter().enumerate() {
        let (extension, bytes) = decode_task_image(image)?;
        let path = directory.join(format!("image-{:02}.{extension}", index + 1));
        fs::write(&path, bytes).map_err(|error| format!("write image attachment: {error}"))?;
        image_paths.push(path.to_string_lossy().into_owned());
    }

    let mut text_paths = Vec::with_capacity(texts.len());
    for (index, text) in texts.iter().enumerate() {
        if text.is_empty() || text.len() > MAX_TASK_TEXT_BYTES {
            return Err("text attachment exceeds the 256 KiB limit".to_string());
        }
        let path = directory.join(format!("text-{:02}.txt", index + 1));
        fs::write(&path, text).map_err(|error| format!("write text attachment: {error}"))?;
        text_paths.push(path.to_string_lossy().into_owned());
    }
    Ok((image_paths, text_paths))
}

fn prompt_with_attachments(
    prompt: String,
    image_paths: &[String],
    text_paths: &[String],
) -> String {
    let mut result = prompt;
    if !image_paths.is_empty() {
        result.push_str("\n\n[Attached images - inspect these files]\n");
        result.push_str(&image_paths.join("\n"));
    }
    if !text_paths.is_empty() {
        result.push_str("\n\n[Attached text files - read these for full context]\n");
        result.push_str(&text_paths.join("\n"));
    }
    result
}

fn prompt_with_project_prefix(prompt: String, project_path: &str) -> String {
    let prefix = crate::commands::project_config::read_project_config(project_path.to_string())
        .map(|config| config.agent.prompt_prefix)
        .unwrap_or_default();
    let prefix = prefix.trim();
    if prefix.is_empty() {
        prompt
    } else if prompt.trim().is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}\n{prompt}")
    }
}

fn task_final_status(
    manually_completed: bool,
    closed: bool,
    child_exited_ok: bool,
) -> &'static str {
    if manually_completed {
        "done"
    } else if closed {
        "cancelled"
    } else if child_exited_ok {
        "done"
    } else {
        "failed"
    }
}

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
            "",
            "--sandbox workspace-write -a on-request",
            "--dangerously-bypass-approvals-and-sandbox",
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
    flag.split_ascii_whitespace().map(str::to_string).collect()
}

fn resume_arguments(agent: &str, session_id: &str) -> Option<Vec<String>> {
    if session_id.is_empty() {
        return None;
    }
    match agent {
        "codex" => Some(vec!["resume".to_string(), session_id.to_string()]),
        _ => find_agent(agent)
            .and_then(|spec| spec.resume_flag)
            .map(|flag| vec![flag.to_string(), session_id.to_string()]),
    }
}

#[tauri::command]
pub async fn run_task(
    app: AppHandle,
    task_id: String,
    project_path: String,
    prompt: String,
    agent: String,
    permission_mode: String,
    images: Option<Vec<String>>,
    texts: Option<Vec<String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    on_output: Channel<String>,
    resume_id: Option<String>,
) -> Result<(), String> {
    // A retry reuses the task id. Retire the previous PTY generation before
    // installing the new one so its reader cannot remain alive in parallel.
    reset_task_process_inner(&task_id);

    // Browser-side attachments are data URLs. Stage them under the active
    // project, then pass only their paths to the agent CLI.
    let attachment_project_path = project_path.clone();
    let attachment_task_id = task_id.clone();
    let (image_paths, text_paths) = tokio::task::spawn_blocking(move || {
        save_task_attachments(
            &attachment_project_path,
            &attachment_task_id,
            &images.unwrap_or_default(),
            &texts.unwrap_or_default(),
        )
    })
    .await
    .map_err(|error| format!("stage task attachments: {error}"))??;
    let prompt = prompt_with_project_prefix(prompt, &project_path);
    let prompt = prompt_with_attachments(prompt, &image_paths, &text_paths);

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

    let program = super::app_settings::get_agent_program(spec.bin);
    let mut cmd = CommandBuilder::new(&program);
    cmd.cwd(&project_path);
    let hook_status = super::hooks::ensure_installed();
    if hook_status.script_installed {
        let hooks_usable = if agent == "codex" {
            hook_status.codex_installed
        } else {
            agent == "claude" && hook_status.settings_linked
        };
        if hooks_usable {
            if agent == "codex" {
                cmd.arg("--dangerously-bypass-hook-trust");
            }
            if agent == "claude" {
                if let Ok(settings_path) = super::hooks::settings_path() {
                    cmd.arg("--settings");
                    cmd.arg(settings_path);
                }
            }
            if let Ok(event_dir) = super::hooks::events_dir_for(&task_id) {
                let _ = fs::create_dir_all(&event_dir);
                cmd.env("NEZHA_TASK_ID", &task_id);
                cmd.env("NEZHA_EVENT_DIR", event_dir);
                cmd.env("NEZHA_AGENT", &agent);
            }
        }
    }
    for arg in permission_flag(&agent, &permission_mode) {
        cmd.arg(arg);
    }
    let resume_args = resume_id
        .as_deref()
        .and_then(|session_id| resume_arguments(&agent, session_id));
    if let Some(arguments) = &resume_args {
        for argument in arguments {
            cmd.arg(argument);
        }
    }
    // Resume continues the existing conversation; neither Claude nor Codex
    // should receive the original task prompt a second time.
    if !prompt.is_empty() && resume_args.is_none() {
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
        .insert(task_id.clone(), handle.clone());
    task_output_buffers()
        .lock()
        .unwrap()
        .insert(task_id.clone(), String::new());

    // Emit "running" so the frontend can update task status without polling.
    let _ = app.emit(
        "task-status",
        serde_json::json!({ "task_id": task_id, "status": "running" }),
    );

    // ── Session watcher: discover JSONL in background ────────────────────────
    spawn_session_watcher(
        app.clone(),
        task_id.clone(),
        project_path.clone(),
        agent.clone(),
        spec.reports_tool_calls,
    );

    // ── Background reader: batched flush via Channel ─────────────────────────
    let app_for_reader = app.clone();
    let task_id_for_reader = task_id.clone();
    let handle_for_reader = handle.clone();
    std::thread::spawn(move || {
        let mut buffer = Vec::with_capacity(PTY_EMIT_MAX_BATCH_BYTES);
        let mut last_flush = std::time::Instant::now();
        let mut reader = reader;
        let mut chunk = vec![0u8; PTY_READ_BUFFER_SIZE];
        let mut output_receiver_alive = true;

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
                append_task_output(&task_id_for_reader, &payload);
                let _ = app_for_reader.emit(
                    "task-output",
                    serde_json::json!({ "task_id": task_id_for_reader.clone(), "output": payload.clone() }),
                );
                if output_receiver_alive {
                    if let Err(e) = on_output.send(payload) {
                        // A page can unmount while its agent continues in the
                        // background. Keep draining the PTY so the process,
                        // task-status, and session watcher remain authoritative.
                        eprintln!("[run_task] output receiver dropped: {e}");
                        output_receiver_alive = false;
                    }
                }
            }
        }

        // Final flush.
        if !buffer.is_empty() {
            let payload = String::from_utf8_lossy(&buffer).into_owned();
            append_task_output(&task_id_for_reader, &payload);
            let _ = app_for_reader.emit(
                "task-output",
                serde_json::json!({ "task_id": task_id_for_reader.clone(), "output": payload.clone() }),
            );
            if output_receiver_alive {
                let _ = on_output.send(payload);
            }
        }

        // Determine exit status from the child process result.
        let child_exited_ok = {
            if let Some(handles) = handle_for_reader.lock().unwrap().as_ref() {
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
        };

        let manually_completed = manually_completed_tasks()
            .lock()
            .unwrap()
            .remove(&task_id_for_reader);
        let final_status = task_final_status(
            manually_completed,
            closed.load(Ordering::Relaxed),
            child_exited_ok,
        );

        // Cleanup and status emission belong only to this PTY generation. A
        // retry may already have installed another handle under the same id.
        let owns_registry = {
            let mut registry = pty_registry().lock().unwrap();
            let owns = registry
                .get(&task_id_for_reader)
                .is_some_and(|current| Arc::ptr_eq(current, &handle_for_reader));
            if owns {
                registry.remove(&task_id_for_reader);
            }
            owns
        };
        if !owns_registry {
            return;
        }
        task_output_buffers()
            .lock()
            .unwrap()
            .remove(&task_id_for_reader);
        super::agent_event_watcher::cleanup_task_events(&task_id_for_reader);
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
            Some(&task_notification_url(&task_id_for_reader)),
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

fn spawn_session_watcher(
    app: AppHandle,
    task_id: String,
    project_path: String,
    agent: String,
    reports_tool_calls: bool,
) {
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
        } else if agent == "claude" {
            match claude_sessions_dir_for_project(&project_path) {
                Some(path) => path,
                None => return,
            }
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
                    if agent != "codex" && agent != "claude" && path.is_dir() {
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
                                    if reports_tool_calls {
                                        spawn_toolcall_watcher(
                                            app.clone(),
                                            task_id.clone(),
                                            inner_path.clone(),
                                        );
                                    }
                                    super::notification::push_local_notification(
                                        "info",
                                        "Session discovered",
                                        &format!(
                                            "Task {} session file found at {}",
                                            &task_id[..task_id.len().min(12)],
                                            session_path_str
                                        ),
                                        Some(&task_notification_url(&task_id)),
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
                    if reports_tool_calls {
                        spawn_toolcall_watcher(app.clone(), task_id.clone(), path.clone());
                    }
                    super::notification::push_local_notification(
                        "info",
                        "Session discovered",
                        &format!(
                            "Task {} session file found",
                            &task_id[..task_id.len().min(12)]
                        ),
                        Some(&task_notification_url(&task_id)),
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

fn claude_project_directory_name(project_path: &str) -> String {
    project_path
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn claude_sessions_dir_for_project(project_path: &str) -> Option<PathBuf> {
    let home = dirs_next()?;
    Some(
        home.join(".claude")
            .join("projects")
            .join(claude_project_directory_name(project_path)),
    )
}

/// Tool-call activity watcher — kooky ToolCallActivityStrip model.
///
/// Scans the running session's JSONL file (once discovered) for tool_use
/// events emitted by Claude Code / Pi. Bash / Edit / Read / Other
/// counters stream to the frontend in real-time so the status bar's
/// tool-call pill reflects what the agent is doing.
///
/// The session watcher supplies the task's exact JSONL path before this
/// watcher starts, so concurrent tasks never share a global newest-file scan.
fn spawn_toolcall_watcher(app: tauri::AppHandle, task_id: String, path: PathBuf) {
    std::thread::spawn(move || {
        // The session watcher has already associated this exact JSONL with the
        // task. Stop with the PTY so completed tasks cannot leak polling threads.
        let mut last_size: u64 = 0;
        while pty_registry()
            .lock()
            .map(|registry| registry.contains_key(&task_id))
            .unwrap_or(false)
        {
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

fn task_notification_url(task_id: &str) -> String {
    format!("/ai-workspace?task={}", url_encode(task_id))
}

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
pub async fn cancel_task(task_id: String, project_path: Option<String>) -> Result<(), String> {
    let _ = cancelled_tasks().lock().unwrap().insert(task_id.clone());
    let _ = manually_completed_tasks().lock().unwrap().remove(&task_id);
    let registry = pty_registry().lock().unwrap();
    if let Some(handle) = registry.get(&task_id) {
        if let Some(handles) = handle.lock().unwrap().as_ref() {
            handles.closed.store(true, Ordering::Relaxed);
            let mut child = handles.child.lock().unwrap();
            let _ = child.kill();
        }
    }
    if let Some(project_path) = project_path.filter(|path| !path.trim().is_empty()) {
        cleanup_task_attachments(&project_path, &task_id);
    }
    Ok(())
}

/// Mark an active task complete and stop its child process. The reader owns
/// final cleanup, while the marker prevents its exit code from overriding the
/// user-confirmed completion with `cancelled` or `failed`.
#[tauri::command]
pub async fn complete_task(task_id: String) -> Result<(), String> {
    manually_completed_tasks()
        .lock()
        .unwrap()
        .insert(task_id.clone());
    let _ = cancelled_tasks().lock().unwrap().remove(&task_id);

    let registry = pty_registry().lock().unwrap();
    if let Some(handle) = registry.get(&task_id) {
        if let Some(handles) = handle.lock().unwrap().as_ref() {
            let mut child = handles.child.lock().unwrap();
            let _ = child.kill();
        }
    } else {
        let _ = manually_completed_tasks().lock().unwrap().remove(&task_id);
    }
    Ok(())
}

#[tauri::command]
pub fn reset_task_process(task_id: String) -> Result<(), String> {
    reset_task_process_inner(&task_id);
    Ok(())
}

/// Return a bounded active-task terminal snapshot for a workbench remount.
#[tauri::command]
pub fn get_task_output_snapshot(task_id: String) -> String {
    task_output_buffers()
        .lock()
        .unwrap()
        .get(&task_id)
        .cloned()
        .unwrap_or_default()
}

/// Diagnostic: list all currently live task IDs. Useful for testing and
/// for the frontend's "active task" indicator.
#[tauri::command]
pub fn get_active_task_ids() -> Vec<String> {
    pty_registry().lock().unwrap().keys().cloned().collect()
}

pub(crate) fn is_task_active(task_id: &str) -> bool {
    pty_registry()
        .lock()
        .map(|registry| registry.contains_key(task_id))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::{
        append_task_output, claude_project_directory_name, cleanup_task_attachments,
        decode_task_image, permission_flag, prompt_with_attachments, prompt_with_project_prefix,
        resume_arguments, safe_task_id, task_final_status, task_notification_url,
        task_output_buffers, MAX_TASK_OUTPUT_SNAPSHOT_BYTES,
    };

    #[test]
    fn tool_call_watcher_is_task_scoped_without_global_session_scan() {
        let source = include_str!("agent_task_pty.rs");
        let removed_global_scan = ["candidates = ", "recent_session_files"].concat();
        assert!(!source.contains(&removed_global_scan));
        assert!(
            source.contains("spawn_toolcall_watcher(app.clone(), task_id.clone(), path.clone())")
        );
        assert!(source.contains("registry.contains_key(&task_id)"));
    }

    #[test]
    fn trusted_hook_tasks_receive_event_environment_and_codex_trust_flag() {
        let source = include_str!("agent_task_pty.rs");
        assert!(source.contains("--dangerously-bypass-hook-trust"));
        assert!(source.contains("NEZHA_TASK_ID"));
        assert!(source.contains("NEZHA_EVENT_DIR"));
        assert!(source.contains("NEZHA_AGENT"));
    }

    #[test]
    fn claude_session_directory_name_is_project_scoped() {
        assert_eq!(
            claude_project_directory_name("/Users/wei/Jun Qi"),
            "-Users-wei-Jun-Qi"
        );
        assert_eq!(
            claude_project_directory_name(r"C:\Work\junqi"),
            "C--Work-junqi"
        );
    }

    #[test]
    fn permission_modes_expand_to_real_cli_arguments() {
        assert_eq!(
            permission_flag("claude", "auto_edit"),
            vec!["--permission-mode", "acceptEdits"],
        );
        assert_eq!(permission_flag("codex", "ask"), Vec::<String>::new(),);
        assert_eq!(
            permission_flag("codex", "auto_edit"),
            vec!["--sandbox", "workspace-write", "-a", "on-request"],
        );
        assert_eq!(
            permission_flag("codex", "full_access"),
            vec!["--dangerously-bypass-approvals-and-sandbox"],
        );
    }

    #[test]
    fn agents_without_permission_flags_receive_no_arguments() {
        assert!(permission_flag("pi", "ask").is_empty());
        assert!(permission_flag("unknown", "ask").is_empty());
    }

    #[test]
    fn resume_arguments_follow_each_agent_cli_shape() {
        assert_eq!(
            resume_arguments("claude", "session-1"),
            Some(vec!["--resume".to_string(), "session-1".to_string()]),
        );
        assert_eq!(
            resume_arguments("codex", "session-2"),
            Some(vec!["resume".to_string(), "session-2".to_string()]),
        );
        assert_eq!(resume_arguments("codex", ""), None);
    }

    #[test]
    fn task_attachment_paths_are_safe_on_windows_and_unix() {
        assert_eq!(safe_task_id("agent-task:run/1"), "agent-task_run_1");
    }

    #[test]
    fn cancelling_a_task_removes_its_staged_attachments() {
        let root =
            std::env::temp_dir().join(format!("junqi-cancel-attachments-{}", uuid::Uuid::new_v4()));
        let directory = super::task_attachments_dir(&root.to_string_lossy(), "task:1");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("image-01.png"), b"data").unwrap();

        cleanup_task_attachments(&root.to_string_lossy(), "task:1");

        assert!(!directory.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn image_data_url_is_validated_before_writing() {
        let (extension, bytes) = decode_task_image("data:image/png;base64,aGVsbG8=").unwrap();
        assert_eq!(extension, "png");
        assert_eq!(bytes, b"hello");
        assert!(decode_task_image("data:image/svg+xml;base64,aGVsbG8=").is_err());
    }

    #[test]
    fn staged_attachment_paths_are_added_to_agent_context() {
        assert_eq!(
            prompt_with_attachments(
                "Review this".to_string(),
                &["/repo/.junqi/attachments/image-01.png".to_string()],
                &["/repo/.junqi/attachments/text-01.txt".to_string()],
            ),
            "Review this\n\n[Attached images - inspect these files]\n/repo/.junqi/attachments/image-01.png\n\n[Attached text files - read these for full context]\n/repo/.junqi/attachments/text-01.txt",
        );
    }

    #[test]
    fn project_prompt_prefix_is_prepended_to_task_content() {
        let root =
            std::env::temp_dir().join(format!("junqi-prompt-prefix-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        crate::commands::project_config::write_project_config(
            root.to_string_lossy().into_owned(),
            crate::commands::project_config::ProjectConfig {
                agent: crate::commands::project_config::AgentConfig {
                    default: "claude".to_string(),
                    default_permission_mode: "ask".to_string(),
                    prompt_prefix: "请使用中文回复。".to_string(),
                },
                git: crate::commands::project_config::GitConfig::default(),
            },
        )
        .unwrap();

        assert_eq!(
            prompt_with_project_prefix("检查项目".to_string(), &root.to_string_lossy()),
            "请使用中文回复。\n检查项目",
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn manual_completion_wins_over_the_process_exit_status() {
        assert_eq!(task_final_status(true, true, false), "done");
        assert_eq!(task_final_status(false, true, true), "cancelled");
        assert_eq!(task_final_status(false, false, false), "failed");
    }

    #[test]
    fn task_notifications_link_back_to_the_ai_workspace() {
        assert_eq!(
            task_notification_url("agent-task:123"),
            "/ai-workspace?task=agent-task%3A123"
        );
    }

    #[test]
    fn output_snapshot_is_bounded_without_breaking_utf8() {
        let task_id = "task-output-test";
        task_output_buffers().lock().unwrap().remove(task_id);
        append_task_output(task_id, &"a".repeat(MAX_TASK_OUTPUT_SNAPSHOT_BYTES + 5));
        append_task_output(task_id, "你好");
        let snapshot = task_output_buffers()
            .lock()
            .unwrap()
            .remove(task_id)
            .unwrap();
        assert!(snapshot.len() <= MAX_TASK_OUTPUT_SNAPSHOT_BYTES);
        assert!(snapshot.ends_with("你好"));
    }
}
