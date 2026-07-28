use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const MAX_ID_BYTES: usize = 160;
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
    truncated: bool,
}

impl SnapshotBuffer {
    fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
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
    }

    fn text(&self) -> String {
        let bytes = self.chunks.iter().flatten().copied().collect::<Vec<_>>();
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

struct WorkbenchPtyHandle {
    run_id: String,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    sequence: AtomicU64,
    snapshot: Mutex<SnapshotBuffer>,
    stopping: AtomicBool,
}

type Handle = Arc<WorkbenchPtyHandle>;

fn registry() -> &'static Mutex<HashMap<String, Handle>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Handle>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lifecycle_gate() -> &'static Mutex<()> {
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

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_BYTES
        || value.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err(format!("invalid workbench {label}"));
    }
    Ok(())
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

fn remove_if_current(pty_id: &str, handle: &Handle) {
    let Ok(mut entries) = registry().lock() else {
        return;
    };
    if entries
        .get(pty_id)
        .is_some_and(|current| Arc::ptr_eq(current, handle))
    {
        entries.remove(pty_id);
    }
}

fn stop_handle(handle: &Handle) {
    handle.stopping.store(true, Ordering::Release);
    if let Ok(mut killer) = handle.killer.lock() {
        let _ = killer.kill();
    }
    if let Ok(mut master) = handle.master.lock() {
        master.take();
    }
}

#[tauri::command]
pub fn create_workbench_pty(
    app: AppHandle,
    pty_id: String,
    run_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<WorkbenchPtyCreateResult, String> {
    validate_id("PTY id", &pty_id)?;
    validate_id("run id", &run_id)?;
    if !(2..=10_000).contains(&cols) || !(2..=10_000).contains(&rows) {
        return Err("invalid workbench PTY dimensions".into());
    }
    let cwd = resolve_cwd(&cwd)?;
    let _operation = lifecycle_gate()
        .lock()
        .map_err(|_| "workbench PTY lifecycle lock poisoned".to_string())?;
    if let Ok(mut runs) = completed_runs().lock() {
        runs.retain(|(id, _)| id != &pty_id);
    }
    {
        let entries = registry()
            .lock()
            .map_err(|_| "workbench PTY registry lock poisoned".to_string())?;
        if let Some(existing) = entries.get(&pty_id) {
            if existing.run_id == run_id && !existing.stopping.load(Ordering::Acquire) {
                return Ok(WorkbenchPtyCreateResult {
                    pty_id,
                    run_id,
                    cwd: cwd.to_string_lossy().into_owned(),
                    created: false,
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
        master: Mutex::new(Some(pair.master)),
        writer: Mutex::new(writer),
        killer: Mutex::new(child.clone_killer()),
        sequence: AtomicU64::new(0),
        snapshot: Mutex::new(SnapshotBuffer {
            chunks: VecDeque::new(),
            bytes: 0,
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
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(read) => {
                    if let Ok(mut snapshot) = output_handle.snapshot.lock() {
                        snapshot.push(&bytes[..read]);
                    }
                    let sequence = output_handle.sequence.fetch_add(1, Ordering::AcqRel) + 1;
                    let _ = output_app.emit(
                        "workbench-pty-output",
                        WorkbenchPtyOutput {
                            pty_id: output_id.clone(),
                            run_id: output_run.clone(),
                            sequence,
                            data: String::from_utf8_lossy(&bytes[..read]).into_owned(),
                        },
                    );
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        remove_if_current(&output_id, &output_handle);
    });

    let exit_id = pty_id.clone();
    let exit_run = run_id.clone();
    let exit_handle = handle;
    std::thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code());
        let _ = app.emit(
            "workbench-pty-exit",
            WorkbenchPtyExit {
                pty_id: exit_id.clone(),
                run_id: exit_run.clone(),
                exit_code,
            },
        );
        exit_handle.stopping.store(true, Ordering::Release);
        remove_if_current(&exit_id, &exit_handle);
        remember_completed_run(&exit_id, &exit_run);
    });

    Ok(WorkbenchPtyCreateResult {
        pty_id,
        run_id,
        cwd: cwd.to_string_lossy().into_owned(),
        created: true,
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
        sequence: handle.sequence.load(Ordering::Acquire),
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
            stop_handle(&handle);
            remove_if_current(&pty_id, &handle);
            Ok(())
        }
        Err(_) if consume_completed_run(&pty_id, &run_id) => Ok(()),
        Err(error) => Err(error),
    }
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
            stop_handle(&handle);
            remove_if_current(&pty_id, &handle);
        } else {
            consume_completed_run(&identity.pty_id, &identity.run_id);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        consume_completed_run, is_completed_run, remember_completed_run, validate_id,
        SnapshotBuffer, MAX_COMPLETED_RUNS, MAX_SNAPSHOT_BYTES,
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
            truncated: false,
        };
        snapshot.push(&vec![b'a'; MAX_SNAPSHOT_BYTES]);
        snapshot.push(b"tail");
        assert_eq!(snapshot.bytes, MAX_SNAPSHOT_BYTES);
        assert!(snapshot.truncated);
        assert!(snapshot.text().ends_with("tail"));
    }
}
