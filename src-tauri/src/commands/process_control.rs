use std::process::{Output, Stdio};
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt};

#[cfg(windows)]
const PROCESS_TREE_TERMINATION_TIMEOUT: Duration = Duration::from_secs(15);
const PROCESS_REAP_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy)]
pub(crate) struct ControlledOutputLimits {
    pub timeout: Duration,
    pub stdout_bytes: usize,
    pub stderr_bytes: usize,
}

#[derive(Debug)]
pub(crate) enum ControlledOutputError {
    Spawn(String),
    Execution {
        message: String,
        cleanup_error: Option<String>,
    },
    Timeout {
        timeout: Duration,
        cleanup_error: Option<String>,
    },
}

impl ControlledOutputError {
    pub(crate) fn is_timeout(&self) -> bool {
        matches!(self, Self::Timeout { .. })
    }

    pub(crate) fn cleanup_confirmed(&self) -> bool {
        match self {
            Self::Spawn(_) => true,
            Self::Execution { cleanup_error, .. } | Self::Timeout { cleanup_error, .. } => {
                cleanup_error.is_none()
            }
        }
    }
}

impl std::fmt::Display for ControlledOutputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Spawn(message) => formatter.write_str(message),
            Self::Execution {
                message,
                cleanup_error,
            } => {
                formatter.write_str(message)?;
                if let Some(cleanup_error) = cleanup_error {
                    write!(formatter, "; process-tree cleanup failed: {cleanup_error}")?;
                }
                Ok(())
            }
            Self::Timeout {
                timeout,
                cleanup_error,
            } => {
                write!(
                    formatter,
                    "process timed out after {} seconds",
                    timeout.as_secs()
                )?;
                if let Some(cleanup_error) = cleanup_error {
                    write!(formatter, "; process-tree cleanup failed: {cleanup_error}")?;
                }
                Ok(())
            }
        }
    }
}

/// Run one non-interactive command with a complete process-tree contract.
///
/// A plain `timeout(command.output())` drops only the root child future. On
/// Windows, descendants may continue holding migration locks or service-manager
/// handles while the caller starts a replacement command. This runner keeps the
/// child handle, captures bounded output concurrently, and confirms cleanup
/// before returning any timeout or stream failure.
pub(crate) async fn run_command_output_confirmed(
    mut command: tokio::process::Command,
    limits: ControlledOutputLimits,
) -> Result<Output, ControlledOutputError> {
    if limits.stdout_bytes == 0 || limits.stderr_bytes == 0 {
        return Err(ControlledOutputError::Execution {
            message: "process output limits must be greater than zero".into(),
            cleanup_error: None,
        });
    }

    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_grouped_process(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| ControlledOutputError::Spawn(error.to_string()))?;
    let pid = child.id();
    let mut drop_guard = GroupedProcessDropGuard::new(pid);
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let cleanup_error = terminate_grouped_process_tree_confirmed(&mut child, pid)
                .await
                .err();
            if cleanup_error.is_none() {
                drop_guard.disarm();
            }
            return Err(ControlledOutputError::Execution {
                message: "process stdout was not captured".into(),
                cleanup_error,
            });
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let cleanup_error = terminate_grouped_process_tree_confirmed(&mut child, pid)
                .await
                .err();
            if cleanup_error.is_none() {
                drop_guard.disarm();
            }
            return Err(ControlledOutputError::Execution {
                message: "process stderr was not captured".into(),
                cleanup_error,
            });
        }
    };

    let execution = tokio::time::timeout(limits.timeout, async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|error| format!("process wait failed: {error}"))
            },
            read_limited_output(stdout, limits.stdout_bytes, "stdout"),
            read_limited_output(stderr, limits.stderr_bytes, "stderr"),
        )
    })
    .await;

    match execution {
        Ok(Ok((status, stdout, stderr))) => {
            drop_guard.disarm();
            Ok(Output {
                status,
                stdout,
                stderr,
            })
        }
        Ok(Err(error)) => {
            let cleanup = terminate_grouped_process_tree_confirmed(&mut child, pid).await;
            if cleanup.is_ok() {
                drop_guard.disarm();
            }
            Err(ControlledOutputError::Execution {
                message: error,
                cleanup_error: cleanup.err(),
            })
        }
        Err(_) => {
            let cleanup_error = terminate_grouped_process_tree_confirmed(&mut child, pid)
                .await
                .err();
            if cleanup_error.is_none() {
                drop_guard.disarm();
            }
            Err(ControlledOutputError::Timeout {
                timeout: limits.timeout,
                cleanup_error,
            })
        }
    }
}

fn configure_grouped_process(command: &mut tokio::process::Command) {
    #[cfg(unix)]
    command.process_group(0);

    #[cfg(windows)]
    {
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
}

async fn read_limited_output<R>(
    mut reader: R,
    limit: usize,
    stream: &str,
) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8_192];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|error| format!("{stream} read failed: {error}"))?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > limit {
            return Err(format!("{stream} exceeded the {limit} byte limit"));
        }
        output.extend_from_slice(&chunk[..count]);
    }
}

struct GroupedProcessDropGuard {
    pid: Option<u32>,
    armed: bool,
}

impl GroupedProcessDropGuard {
    fn new(pid: Option<u32>) -> Self {
        Self { pid, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for GroupedProcessDropGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Some(pid) = self.pid else {
            return;
        };
        #[cfg(windows)]
        request_windows_process_tree_termination(pid);
        #[cfg(unix)]
        if let Ok(process_group) = i32::try_from(pid) {
            let _ = unsafe { libc::kill(-process_group, libc::SIGKILL) };
        }
    }
}

async fn terminate_grouped_process_tree_confirmed(
    child: &mut tokio::process::Child,
    pid: Option<u32>,
) -> Result<(), String> {
    #[cfg(unix)]
    if let Some(process_group) = pid.and_then(|pid| i32::try_from(pid).ok()) {
        let _ = unsafe { libc::kill(-process_group, libc::SIGKILL) };
    }
    terminate_process_tree_confirmed(child, pid).await
}

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
