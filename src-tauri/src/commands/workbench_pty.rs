mod model;
mod runtime;

#[cfg(test)]
mod tests;

pub use model::{WorkbenchPtyCreateResult, WorkbenchPtyIdentity, WorkbenchPtySnapshot};
pub(crate) use runtime::{assert_current_owner_locked, lifecycle_gate};

use model::{validate_id, MAX_INPUT_BYTES};
use portable_pty::PtySize;
use runtime::{
    consume_completed_run, current_handle, is_completed_run, registry, remove_if_current,
    stop_handle, CreateWorkbenchPtyRequest,
};
use std::io::Write;
use std::sync::atomic::Ordering;
use tauri::AppHandle;

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    runtime::create_workbench_pty(
        app,
        CreateWorkbenchPtyRequest {
            pty_id,
            run_id,
            cwd,
            worktree_id,
            pane_id,
            cols,
            rows,
            allow_create,
        },
    )
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
    let stop_failures = collect_stop_failures(handles, stop_handle);
    let claim_failure = super::workbench_provider::clear_claims_locked().err();
    finish_shutdown(count, stop_failures, claim_failure)
}

fn collect_stop_failures<T>(items: Vec<T>, stop: impl Fn(&T) -> Result<(), String>) -> Vec<String> {
    items.iter().filter_map(|item| stop(item).err()).collect()
}

fn finish_shutdown(
    count: u64,
    stop_failures: Vec<String>,
    claim_failure: Option<String>,
) -> Result<u64, String> {
    let mut details = Vec::with_capacity(2);
    if !stop_failures.is_empty() {
        details.push(format!(
            "{} PTY stop failure(s): {}",
            stop_failures.len(),
            stop_failures.join("; ")
        ));
    }
    if let Some(error) = claim_failure {
        details.push(format!("provider claim cleanup failed: {error}"));
    }
    if details.is_empty() {
        return Ok(count);
    }
    Err(format!(
        "failed to clean up workbench PTYs ({count} registered): {}",
        details.join("; ")
    ))
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
