use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const MAX_ID_BYTES: usize = 160;
const MAX_OWNER_ID_BYTES: usize = 16 * 1024;
const MAX_INPUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;
const MAX_COMPLETED_RUNS: usize = 512;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPtyOutput {
    pty_id: String,
    run_id: String,
    sequence: u64,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkbenchPtyExit {
    pty_id: String,
    run_id: String,
    exit_code: Option<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPtyIdentity {
    pty_id: String,
    run_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPtyCreateResult {
    pty_id: String,
    run_id: String,
    cwd: String,
    created: bool,
    completed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPtySnapshot {
    pty_id: String,
    run_id: String,
    sequence: u64,
    data: String,
    truncated: bool,
}

struct SnapshotBuffer {
    chunks: VecDeque<Vec<u8>>,
    bytes: usize,
    sequence: u64,
    truncated: bool,
}

impl SnapshotBuffer {
    fn push(&mut self, data: &[u8]) -> u64 {
        if data.is_empty() {
            return self.sequence;
        }
        self.chunks.push_back(data.to_vec());
        self.bytes += data.len();
        while self.bytes > MAX_SNAPSHOT_BYTES {
            let overflow = self.bytes - MAX_SNAPSHOT_BYTES;
            let Some(mut front) = self.chunks.pop_front() else {
                break;
            };
            if front.len() > overflow {
                front.drain(..overflow);
                self.bytes -= overflow;
                self.chunks.push_front(front);
            } else {
                self.bytes -= front.len();
            }
            self.truncated = true;
        }
        self.sequence = self.sequence.saturating_add(1);
        self.sequence
    }

    fn text(&self) -> String {
        let bytes = self.chunks.iter().flatten().copied().collect::<Vec<_>>();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

struct WorkbenchPtyHandle {
    run_id: String,
    worktree_id: String,
    pane_id: String,
    cwd: PathBuf,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    snapshot: Mutex<SnapshotBuffer>,
    stopping: AtomicBool,
}

type Handle = Arc<WorkbenchPtyHandle>;

fn registry() -> &'static Mutex<HashMap<String, Handle>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Handle>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn lifecycle_gate() -> &'static Mutex<()> {
    static GATE: OnceLock<Mutex<()>> = OnceLock::new();
    GATE.get_or_init(|| Mutex::new(()))
}

fn completed_runs() -> &'static Mutex<VecDeque<(String, String)>> {
    static RUNS: OnceLock<Mutex<VecDeque<(String, String)>>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn remember_completed_run(pty_id: &str, run_id: &str) {
    let Ok(mut runs) = completed_runs().lock() else {
        return;
    };
    runs.retain(|(id, _)| id != pty_id);
    runs.push_back((pty_id.to_string(), run_id.to_string()));
    while runs.len() > MAX_COMPLETED_RUNS {
        runs.pop_front();
    }
}

fn is_completed_run(pty_id: &str, run_id: &str) -> bool {
    completed_runs()
        .lock()
        .is_ok_and(|runs| runs.iter().any(|(id, run)| id == pty_id && run == run_id))
}

fn consume_completed_run(pty_id: &str, run_id: &str) -> bool {
    let Ok(mut runs) = completed_runs().lock() else {
        return false;
    };
    let Some(index) = runs
        .iter()
        .position(|(id, run)| id == pty_id && run == run_id)
    else {
        return false;
    };
    runs.remove(index);
    true
}

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
                    output.push_str(&String::from_utf8_lossy(&bytes[..valid_len]));
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

fn validate_value(label: &str, value: &str, max_bytes: usize) -> Result<(), String> {
    if value.is_empty()
        || value.len() > max_bytes
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(format!("invalid workbench {label}"));
    }
    Ok(())
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    validate_value(label, value, MAX_ID_BYTES)
}

fn resolve_cwd(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    if !path.is_dir() {
        return Err("workbench PTY cwd is not an existing directory".into());
    }
    path.canonicalize()
        .map_err(|error| format!("resolve workbench PTY cwd: {error}"))
}

fn shell_command(cwd: &std::path::Path) -> CommandBuilder {
    let shell = crate::platform::default_shell_command();
    let mut command = CommandBuilder::new(shell.program);
    command.args(shell.args);
    command.cwd(cwd);
    for (key, value) in crate::platform::login_shell_env() {
        command.env(key, value);
    }
    command.env("JUNQI_WORKBENCH", "1");
    command
}

pub(crate) fn assert_current_owner_locked(
    pty_id: &str,
    run_id: &str,
    worktree_id: &str,
    pane_id: &str,
) -> Result<PathBuf, String> {
    let handle = registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?
        .get(pty_id)
        .cloned()
        .ok_or_else(|| format!("unknown workbench PTY: {pty_id}"))?;
    if handle.run_id != run_id || handle.stopping.load(Ordering::Acquire) {
        return Err(format!("stale workbench PTY run: {pty_id}"));
    }
    if handle.worktree_id != worktree_id || handle.pane_id != pane_id {
        return Err(format!("workbench PTY owner mismatch: {pty_id}"));
    }
    Ok(handle.cwd.clone())
}

fn current_handle(pty_id: &str, run_id: &str) -> Result<Handle, String> {
    let handle = registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?
        .get(pty_id)
        .cloned()
        .ok_or_else(|| format!("unknown workbench PTY: {pty_id}"))?;
    if handle.run_id != run_id {
        return Err(format!("stale workbench PTY run: {pty_id}"));
    }
    if handle.stopping.load(Ordering::Acquire) {
        return Err(format!("workbench PTY is stopping: {pty_id}"));
    }
    Ok(handle)
}

fn remove_if_current(pty_id: &str, handle: &Handle) -> Result<(), String> {
    let mut entries = registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?;
    if entries
        .get(pty_id)
        .is_some_and(|current| Arc::ptr_eq(current, handle))
    {
        entries.remove(pty_id);
    }
    Ok(())
}

fn stop_handle(handle: &Handle) -> Result<(), String> {
    handle.stopping.store(true, Ordering::Release);
    handle
        .killer
        .lock()
        .map_err(|_| "workbench PTY killer lock poisoned".to_string())?
        .kill()
        .map_err(|error| format!("failed to stop workbench PTY: {error}"))?;
    handle
        .master
        .lock()
        .map_err(|_| "workbench PTY master lock poisoned".to_string())?
        .take();
    Ok(())
}

#[tauri::command]
pub fn create_workbench_pty(
    app: AppHandle,
    pty_id: String,
    run_id: String,
    cwd: String,
    worktree_id: String,
    pane_id: String,
    cols: u16,
    rows: u16,
    allow_create: bool,
) -> Result<WorkbenchPtyCreateResult, String> {
    validate_id("PTY id", &pty_id)?;
    validate_id("run id", &run_id)?;
    validate_value("worktree id", &worktree_id, MAX_OWNER_ID_BYTES)?;
    validate_value("pane id", &pane_id, MAX_OWNER_ID_BYTES)?;
    if !(2..=10_000).contains(&cols) || !(2..=10_000).contains(&rows) {
        return Err("invalid workbench PTY dimensions".into());
    }
    let cwd = resolve_cwd(&cwd)?;
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    if is_completed_run(&pty_id, &run_id) {
        return Ok(WorkbenchPtyCreateResult {
            pty_id,
            run_id,
            cwd: cwd.to_string_lossy().into_owned(),
            created: false,
            completed: true,
        });
    }
    if !allow_create {
        return Err("workbench PTY is not running; explicit restart required".into());
    }
    if let Ok(mut runs) = completed_runs().lock() {
        runs.retain(|(id, _)| id != &pty_id);
    }
    {
        let entries = registry()
            .lock()
            .map_err(|_| "workbench PTY registry lock poisoned".to_string())?;
        if let Some(existing) = entries.get(&pty_id) {
            if existing.run_id == run_id
                && existing.worktree_id == worktree_id
                && existing.pane_id == pane_id
                && !existing.stopping.load(Ordering::Acquire)
            {
                return Ok(WorkbenchPtyCreateResult {
                    pty_id,
                    run_id,
                    cwd: cwd.to_string_lossy().into_owned(),
                    created: false,
                    completed: false,
                });
            }
            return Err("workbench PTY id is owned by another run".into());
        }
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("open workbench PTY: {error}"))?;
    let mut child = pair
        .slave
        .spawn_command(shell_command(&cwd))
        .map_err(|error| format!("start workbench PTY: {error}"))?;
    drop(pair.slave);
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("open workbench PTY reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("open workbench PTY writer: {error}"))?;
    let handle = Arc::new(WorkbenchPtyHandle {
        run_id: run_id.clone(),
        worktree_id,
        pane_id,
        cwd: cwd.clone(),
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
        snapshot: Mutex::new(SnapshotBuffer {
            chunks: VecDeque::new(),
            bytes: 0,
            sequence: 0,
            truncated: false,
        }),
        stopping: AtomicBool::new(false),
    });
    registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?
        .insert(pty_id.clone(), handle.clone());

    let output_app = app.clone();
    let output_id = pty_id.clone();
    let output_run = run_id.clone();
    let output_handle = handle.clone();
    std::thread::spawn(move || {
        let mut bytes = [0_u8; 32 * 1024];
        let mut pending_utf8 = Vec::new();
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(read) => {
                    let sequence = match output_handle.snapshot.lock() {
                        Ok(mut snapshot) => snapshot.push(&bytes[..read]),
                        Err(_) => break,
                    };
                    pending_utf8.extend_from_slice(&bytes[..read]);
                    let data = take_utf8_ready(&mut pending_utf8);
                    // Emit even an empty data frame so sequence continuity is
                    // preserved while a multibyte codepoint awaits its tail.
                    let _ = output_app.emit(
                        "workbench-pty-output",
                        WorkbenchPtyOutput {
                            pty_id: output_id.clone(),
                            run_id: output_run.clone(),
                            sequence,
                            data,
                        },
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        if !pending_utf8.is_empty() {
            let sequence = output_handle
                .snapshot
                .lock()
                .map_or(0, |snapshot| snapshot.sequence);
            let _ = output_app.emit(
                "workbench-pty-output",
                WorkbenchPtyOutput {
                    pty_id: output_id.clone(),
                    run_id: output_run.clone(),
                    sequence,
                    data: String::from_utf8_lossy(&pending_utf8).into_owned(),
                },
            );
        }
        // Reader EOF does not own process completion. The child monitor removes
        // the registry entry and records the completed-run tombstone atomically
        // under the lifecycle gate.
    });

    let exit_id = pty_id.clone();
    let exit_run = run_id.clone();
    let exit_handle = handle;
    std::thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code());
        let committed = lifecycle_gate()
            .lock()
            .ok()
            .and_then(|_operation| {
                exit_handle.stopping.store(true, Ordering::Release);
                remove_if_current(&exit_id, &exit_handle).ok()?;
                super::workbench_provider::release_claims_for_pty_locked(&exit_id).ok()?;
                remember_completed_run(&exit_id, &exit_run);
                Some(())
            })
            .is_some();
        if committed {
            let _ = app.emit(
                "workbench-pty-exit",
                WorkbenchPtyExit {
                    pty_id: exit_id.clone(),
                    run_id: exit_run.clone(),
                    exit_code,
                },
            );
        }
    });

    Ok(WorkbenchPtyCreateResult {
        pty_id,
        run_id,
        cwd: cwd.to_string_lossy().into_owned(),
        created: true,
        completed: false,
    })
}

#[tauri::command]
pub fn input_workbench_pty(pty_id: String, run_id: String, data: String) -> Result<(), String> {
    if data.len() > MAX_INPUT_BYTES {
        return Err("workbench PTY input exceeds 4 MiB".into());
    }
    let handle = current_handle(&pty_id, &run_id)?;
    let mut writer = handle
        .writer
        .lock()
        .map_err(|_| "workbench PTY writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| error.to_string())?;
    writer.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_workbench_pty(
    pty_id: String,
    run_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    if !(2..=10_000).contains(&cols) || !(2..=10_000).contains(&rows) {
        return Err("invalid workbench PTY dimensions".into());
    }
    let handle = current_handle(&pty_id, &run_id)?;
    let mut master = handle
        .master
        .lock()
        .map_err(|_| "workbench PTY master lock poisoned".to_string())?;
    master
        .as_mut()
        .ok_or("workbench PTY master is closed")?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn snapshot_workbench_pty(
    pty_id: String,
    run_id: String,
) -> Result<WorkbenchPtySnapshot, String> {
    let handle = current_handle(&pty_id, &run_id)?;
    let snapshot = handle
        .snapshot
        .lock()
        .map_err(|_| "workbench PTY snapshot lock poisoned".to_string())?;
    Ok(WorkbenchPtySnapshot {
        pty_id,
        run_id,
        sequence: snapshot.sequence,
        data: snapshot.text(),
        truncated: snapshot.truncated,
    })
}

#[tauri::command]
pub fn stop_workbench_pty(pty_id: String, run_id: String) -> Result<(), String> {
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    match current_handle(&pty_id, &run_id) {
        Ok(handle) => {
            stop_handle(&handle)?;
            remove_if_current(&pty_id, &handle)?;
            super::workbench_provider::release_claims_for_pty_locked(&pty_id)?;
            Ok(())
        }
        Err(_) if consume_completed_run(&pty_id, &run_id) => Ok(()),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn close_workbench_pty_tab(pty_id: String, run_id: String) -> Result<(), String> {
    validate_id("PTY id", &pty_id)?;
    validate_id("run id", &run_id)?;
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    let current = registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?
        .get(&pty_id)
        .cloned();
    match current {
        Some(handle) if handle.run_id == run_id && !handle.stopping.load(Ordering::Acquire) => {
            stop_handle(&handle)?;
            remove_if_current(&pty_id, &handle)?;
            super::workbench_provider::release_claims_for_pty_locked(&pty_id)?;
            Ok(())
        }
        Some(_) => Err(format!("stale workbench PTY run: {pty_id}")),
        None => {
            consume_completed_run(&pty_id, &run_id);
            Ok(())
        }
    }
}

#[tauri::command]
pub fn close_workbench_pty_tabs(identities: Vec<WorkbenchPtyIdentity>) -> Result<(), String> {
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    let entries = registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?;
    let mut handles = Vec::with_capacity(identities.len());
    for identity in &identities {
        validate_id("PTY id", &identity.pty_id)?;
        validate_id("run id", &identity.run_id)?;
        match entries.get(&identity.pty_id) {
            Some(handle)
                if handle.run_id == identity.run_id && !handle.stopping.load(Ordering::Acquire) =>
            {
                handles.push(Some(handle.clone()));
            }
            Some(_) => return Err(format!("stale workbench PTY run: {}", identity.pty_id)),
            None => handles.push(None),
        }
    }
    drop(entries);
    for (identity, handle) in identities.iter().zip(handles) {
        if let Some(handle) = handle {
            stop_handle(&handle)?;
            remove_if_current(&identity.pty_id, &handle)?;
            super::workbench_provider::release_claims_for_pty_locked(&identity.pty_id)?;
        } else {
            consume_completed_run(&identity.pty_id, &identity.run_id);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn stop_all_workbench_ptys() -> Result<u64, String> {
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    let handles = {
        let mut entries = registry()
            .lock()
            .map_err(|_| "workbench PTY registry lock poisoned".to_string())?;
        entries
            .drain()
            .map(|(_, handle)| handle)
            .collect::<Vec<_>>()
    };
    let count = handles.len() as u64;
    for handle in handles {
        stop_handle(&handle)?;
    }
    super::workbench_provider::clear_claims_locked()?;
    Ok(count)
}

#[tauri::command]
pub fn stop_workbench_ptys(identities: Vec<WorkbenchPtyIdentity>) -> Result<(), String> {
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    let mut handles = Vec::with_capacity(identities.len());
    // Validate the complete ownership set before physically stopping anything.
    for identity in &identities {
        validate_id("PTY id", &identity.pty_id)?;
        validate_id("run id", &identity.run_id)?;
        match current_handle(&identity.pty_id, &identity.run_id) {
            Ok(handle) => handles.push((identity.pty_id.clone(), Some(handle))),
            Err(_) if is_completed_run(&identity.pty_id, &identity.run_id) => {
                handles.push((identity.pty_id.clone(), None));
            }
            Err(error) => return Err(error),
        }
    }
    for (identity, (pty_id, handle)) in identities.iter().zip(handles) {
        if let Some(handle) = handle {
            stop_handle(&handle)?;
            remove_if_current(&pty_id, &handle)?;
            super::workbench_provider::release_claims_for_pty_locked(&pty_id)?;
        } else {
            consume_completed_run(&identity.pty_id, &identity.run_id);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        consume_completed_run, is_completed_run, remember_completed_run, take_utf8_ready,
        validate_id, SnapshotBuffer, MAX_COMPLETED_RUNS, MAX_SNAPSHOT_BYTES,
    };
    use std::collections::VecDeque;

    #[test]
    fn ids_reject_empty_control_and_unbounded_values() {
        assert!(validate_id("id", "").is_err());
        assert!(validate_id("id", "bad\nrun").is_err());
        assert!(validate_id("id", &"x".repeat(161)).is_err());
        assert!(validate_id("id", "workbench:pty:one").is_ok());
    }

    #[test]
    fn utf8_decoder_retains_split_multibyte_characters() {
        let mut pending = vec![0xe4, 0xb8];
        assert_eq!(take_utf8_ready(&mut pending), "");
        pending.push(0xad);
        assert_eq!(take_utf8_ready(&mut pending), "中");
        assert!(pending.is_empty());
    }

    #[test]
    fn completed_runs_are_exact_idempotent_and_bounded() {
        for index in 0..MAX_COMPLETED_RUNS + 1 {
            remember_completed_run(&format!("pty-{index}"), &format!("run-{index}"));
        }
        assert!(!is_completed_run("pty-0", "run-0"));
        assert!(is_completed_run("pty-1", "run-1"));
        assert!(!consume_completed_run("pty-1", "wrong-run"));
        assert!(consume_completed_run("pty-1", "run-1"));
        assert!(!is_completed_run("pty-1", "run-1"));
    }

    #[test]
    fn snapshot_is_bounded_and_marks_truncation() {
        let mut snapshot = SnapshotBuffer {
            chunks: VecDeque::new(),
            bytes: 0,
            sequence: 0,
            truncated: false,
        };
        snapshot.push(&vec![b'a'; MAX_SNAPSHOT_BYTES]);
        snapshot.push(b"tail");
        assert_eq!(snapshot.bytes, MAX_SNAPSHOT_BYTES);
        assert!(snapshot.truncated);
        assert!(snapshot.text().ends_with("tail"));
    }
}
