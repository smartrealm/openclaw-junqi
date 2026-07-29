use super::model::{
    resolve_cwd, shell_command, take_utf8_ready, validate_id, validate_value, SnapshotBuffer,
    WorkbenchPtyCreateResult, WorkbenchPtyExit, WorkbenchPtyOutput, MAX_COMPLETED_RUNS,
    MAX_OWNER_ID_BYTES,
};
use portable_pty::{native_pty_system, ChildKiller, MasterPty, PtySize};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

pub(super) struct WorkbenchPtyHandle {
    pub(super) run_id: String,
    pub(super) worktree_id: String,
    pub(super) pane_id: String,
    pub(super) cwd: PathBuf,
    pub(super) master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    pub(super) writer: Mutex<Box<dyn Write + Send>>,
    pub(super) killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub(super) snapshot: Mutex<SnapshotBuffer>,
    pub(super) stopping: AtomicBool,
}

pub(super) type Handle = Arc<WorkbenchPtyHandle>;

pub(super) struct CreateWorkbenchPtyRequest {
    pub(super) pty_id: String,
    pub(super) run_id: String,
    pub(super) cwd: String,
    pub(super) worktree_id: String,
    pub(super) pane_id: String,
    pub(super) cols: u16,
    pub(super) rows: u16,
    pub(super) allow_create: bool,
}

pub(super) fn registry() -> &'static Mutex<HashMap<String, Handle>> {
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

pub(super) fn remember_completed_run(pty_id: &str, run_id: &str) {
    let Ok(mut runs) = completed_runs().lock() else {
        return;
    };
    runs.retain(|(id, _)| id != pty_id);
    runs.push_back((pty_id.to_string(), run_id.to_string()));
    while runs.len() > MAX_COMPLETED_RUNS {
        runs.pop_front();
    }
}

pub(super) fn is_completed_run(pty_id: &str, run_id: &str) -> bool {
    completed_runs()
        .lock()
        .is_ok_and(|runs| runs.iter().any(|(id, run)| id == pty_id && run == run_id))
}

pub(super) fn consume_completed_run(pty_id: &str, run_id: &str) -> bool {
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

pub(super) fn current_handle(pty_id: &str, run_id: &str) -> Result<Handle, String> {
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

pub(super) fn remove_if_current(pty_id: &str, handle: &Handle) -> Result<(), String> {
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

pub(super) fn stop_handle(handle: &Handle) -> Result<(), String> {
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

pub(super) fn create_workbench_pty(
    app: AppHandle,
    request: CreateWorkbenchPtyRequest,
) -> Result<WorkbenchPtyCreateResult, String> {
    let CreateWorkbenchPtyRequest {
        pty_id,
        run_id,
        cwd,
        worktree_id,
        pane_id,
        cols,
        rows,
        allow_create,
    } = request;
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
    let reader = pair
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
        snapshot: Mutex::new(SnapshotBuffer::new()),
        stopping: AtomicBool::new(false),
    });
    registry()
        .lock()
        .map_err(|_| "workbench PTY registry lock poisoned".to_string())?
        .insert(pty_id.clone(), handle.clone());

    spawn_output_reader(
        app.clone(),
        pty_id.clone(),
        run_id.clone(),
        handle.clone(),
        reader,
    );

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
                super::super::workbench_provider::release_claims_for_pty_locked(&exit_id).ok()?;
                remember_completed_run(&exit_id, &exit_run);
                Some(())
            })
            .is_some();
        if committed {
            let _ = app.emit(
                "workbench-pty-exit",
                WorkbenchPtyExit {
                    pty_id: exit_id,
                    run_id: exit_run,
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

fn spawn_output_reader(
    app: AppHandle,
    pty_id: String,
    run_id: String,
    handle: Handle,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::spawn(move || {
        let mut bytes = [0_u8; 32 * 1024];
        let mut pending_utf8 = Vec::new();
        loop {
            match reader.read(&mut bytes) {
                Ok(0) => break,
                Ok(read) => {
                    let sequence = match handle.snapshot.lock() {
                        Ok(mut snapshot) => snapshot.push(&bytes[..read]),
                        Err(_) => break,
                    };
                    pending_utf8.extend_from_slice(&bytes[..read]);
                    let data = take_utf8_ready(&mut pending_utf8);
                    // Keep sequence continuity while a multibyte codepoint awaits its tail.
                    let _ = app.emit(
                        "workbench-pty-output",
                        WorkbenchPtyOutput {
                            pty_id: pty_id.clone(),
                            run_id: run_id.clone(),
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
            let sequence = handle
                .snapshot
                .lock()
                .map_or(0, |snapshot| snapshot.sequence);
            let _ = app.emit(
                "workbench-pty-output",
                WorkbenchPtyOutput {
                    pty_id,
                    run_id,
                    sequence,
                    data: String::from_utf8_lossy(&pending_utf8).into_owned(),
                },
            );
        }
    });
}
