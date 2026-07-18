use std::time::Duration;

#[cfg(windows)]
const PROCESS_TREE_TERMINATION_TIMEOUT: Duration = Duration::from_secs(15);
const PROCESS_REAP_TIMEOUT: Duration = Duration::from_secs(10);

/// Ask Windows to terminate a process tree without awaiting the result. This
/// is reserved for cancellation/drop paths where an async cleanup future would
/// itself be abandoned. Normal error recovery must use the confirmed variant.
#[cfg(windows)]
pub(crate) fn request_windows_process_tree_termination(pid: u32) {
    let mut taskkill = std::process::Command::new("taskkill");
    taskkill.args(["/PID", &pid.to_string(), "/T", "/F"]);
    crate::platform::configure_background_std_command(&mut taskkill);
    let _ = taskkill.spawn();
}

/// Terminate a Windows process tree and wait for the request itself to finish.
/// The caller still owns root-process reaping, because elevated processes use
/// a Win32 handle while ordinary commands use `tokio::process::Child`.
#[cfg(windows)]
pub(crate) async fn terminate_windows_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    let mut taskkill = tokio::process::Command::new("taskkill");
    taskkill.args(["/PID", &pid_text, "/T", "/F"]);
    crate::platform::configure_background_command(&mut taskkill);
    match tokio::time::timeout(PROCESS_TREE_TERMINATION_TIMEOUT, taskkill.output()).await {
        Ok(Ok(output)) if output.status.success() => Ok(()),
        Ok(Ok(output)) => {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let detail = (!detail.is_empty())
                .then_some(detail)
                .unwrap_or_else(|| String::from_utf8_lossy(&output.stdout).trim().to_string());
            Err(format!(
                "taskkill could not terminate process tree {pid} (exit {}{})",
                output.status,
                detail
                    .is_empty()
                    .then_some(String::new())
                    .unwrap_or_else(|| format!(": {detail}"))
            ))
        }
        Ok(Err(error)) => Err(format!(
            "failed to start taskkill for process tree {pid}: {error}"
        )),
        Err(_) => Err(format!(
            "taskkill did not finish for process tree {pid} within {} seconds",
            PROCESS_TREE_TERMINATION_TIMEOUT.as_secs()
        )),
    }
}

/// `taskkill` can race a child that exits between the supervising poll and the
/// cleanup request. The root handle is still reaped separately; this matcher
/// only suppresses the known "already gone" result after that reaping succeeds.
#[cfg(windows)]
pub(crate) fn process_tree_was_already_gone(error: &str) -> bool {
    let error = error.to_ascii_lowercase();
    error.contains("not found")
        || error.contains("no running instance")
        || error.contains("找不到")
        || error.contains("不存在")
}

/// Terminate the complete owned process tree on Windows and the owned child on
/// Unix. The bounded waits keep error recovery from hanging the desktop app.
pub async fn terminate_process_tree(child: &mut tokio::process::Child, pid: Option<u32>) {
    let _ = terminate_process_tree_confirmed(child, pid).await;
}

/// Stop an owned process and confirm that its root process has been reaped.
/// Installers use this strict form before starting any fallback source: a
/// background descendant can otherwise retain MSI locks, pipes, or a package
/// staging directory after the root launcher exits.
pub async fn terminate_process_tree_confirmed(
    child: &mut tokio::process::Child,
    pid: Option<u32>,
) -> Result<(), String> {
    #[cfg(windows)]
    let tree_result = match pid {
        Some(pid) => terminate_windows_process_tree(pid).await,
        None => Err("the process did not expose a PID for tree cleanup".into()),
    };

    #[cfg(not(windows))]
    let tree_result: Result<(), String> = {
        let _ = pid;
        Ok(())
    };

    let root_result = match child.start_kill() {
        Ok(()) => match tokio::time::timeout(PROCESS_REAP_TIMEOUT, child.wait()).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(error)) => Err(format!("failed while reaping process: {error}")),
            Err(_) => Err("process did not exit within 10 seconds after termination".into()),
        },
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => {
            match tokio::time::timeout(PROCESS_REAP_TIMEOUT, child.wait()).await {
                Ok(Ok(_)) => Ok(()),
                Ok(Err(wait_error)) => Err(format!(
                    "process ended before termination, but could not be reaped: {wait_error}"
                )),
                Err(_) => Err("ended process could not be reaped within 10 seconds".into()),
            }
        }
        Err(error) => Err(format!("failed to terminate process: {error}")),
    };

    match (tree_result, root_result) {
        (Ok(()), Ok(())) => Ok(()),
        #[cfg(windows)]
        (Err(tree_error), Ok(())) if process_tree_was_already_gone(&tree_error) => Ok(()),
        (Err(tree_error), Ok(())) => Err(format!(
            "root process exited, but process-tree cleanup was not confirmed: {tree_error}"
        )),
        (Ok(()), Err(root_error)) => Err(root_error),
        (Err(tree_error), Err(root_error)) => Err(format!("{tree_error}; {root_error}")),
    }
}
