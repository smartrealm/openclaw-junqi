//! Setup operation lifecycle: cancellation, mutual exclusion,
//! time budgets, and controlled child-process supervision.

use super::*;

/// Native setup work is registered independently from the surrounding UI flow.
/// A run can cancel exactly the process it started without a late request
/// affecting a newer retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SetupOperationKind {
    Node,
    Git,
    OpenClaw,
    DockerImage,
}

impl SetupOperationKind {
    pub(crate) fn step(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Git => "git",
            Self::OpenClaw => "openclaw",
            Self::DockerImage => "pull",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Node => "Node.js",
            Self::Git => "Git",
            Self::OpenClaw => "OpenClaw",
            Self::DockerImage => "OpenClaw Docker image",
        }
    }
}

#[derive(Clone)]
pub(crate) struct SetupOperationCancellation {
    pub(super) requested: Arc<AtomicBool>,
    pub(super) changes: tokio::sync::watch::Sender<bool>,
}

impl SetupOperationCancellation {
    pub(super) fn new() -> Self {
        let (changes, _) = tokio::sync::watch::channel(false);
        Self {
            requested: Arc::new(AtomicBool::new(false)),
            changes,
        }
    }

    pub(super) fn request(&self) {
        if !self.requested.swap(true, Ordering::SeqCst) {
            self.changes.send_replace(true);
        }
    }

    pub(super) fn is_requested(&self) -> bool {
        self.requested.load(Ordering::SeqCst)
    }

    pub(super) async fn cancelled(&self) {
        if self.is_requested() {
            return;
        }
        let mut changes = self.changes.subscribe();
        while !*changes.borrow() {
            if changes.changed().await.is_err() {
                return;
            }
        }
    }
}

#[derive(Clone)]
pub(crate) struct ActiveSetupOperation {
    pub(super) app: tauri::AppHandle,
    pub(super) kind: SetupOperationKind,
    pub(super) cancellation: SetupOperationCancellation,
    /// Only renderer-requested operations have a progress identity. Internal
    /// maintenance commands still emit progress, but must not be attributed to
    /// a setup screen that does not own them.
    pub(super) progress_id: Option<String>,
}

#[derive(Default)]
pub(crate) struct SetupOperationCoordinator {
    pub(super) active: HashMap<String, ActiveSetupOperation>,
}

pub(crate) fn setup_operations() -> &'static Mutex<SetupOperationCoordinator> {
    SETUP_OPERATIONS.get_or_init(|| Mutex::new(SetupOperationCoordinator::default()))
}

pub(crate) fn lock_setup_operations() -> std::sync::MutexGuard<'static, SetupOperationCoordinator> {
    setup_operations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// An RAII lease for one cancellable native setup action. The coordinator
/// only stores active leases; dropping a completed or failed lease removes its
/// identifier so a later retry can reuse neither its cancellation signal nor
/// its progress ownership.
pub(crate) struct SetupOperation {
    pub(super) id: String,
    pub(super) cancellation: SetupOperationCancellation,
    progress_id: Option<String>,
}

impl SetupOperation {
    pub(crate) fn begin(
        app: &tauri::AppHandle,
        kind: SetupOperationKind,
        requested_id: Option<String>,
    ) -> Result<Self, String> {
        let progress_id = requested_id
            .map(|requested_id| -> Result<String, String> {
                let id = requested_id.trim();
                if id.is_empty()
                    || id.len() > SETUP_OPERATION_ID_MAX_LEN
                    || id.chars().any(char::is_control)
                {
                    return Err("Invalid setup operation identifier".into());
                }
                Ok(id.to_owned())
            })
            .transpose()?;
        let id = progress_id
            .clone()
            .unwrap_or_else(|| format!("internal-setup-operation-{}", uuid::Uuid::new_v4()));
        let cancellation = SetupOperationCancellation::new();
        let mut coordinator = lock_setup_operations();
        if coordinator.active.contains_key(&id) {
            return Err(format!(
                "A setup operation is already active for this identifier ({})",
                kind.label()
            ));
        }
        coordinator.active.insert(
            id.clone(),
            ActiveSetupOperation {
                app: app.clone(),
                kind,
                cancellation: cancellation.clone(),
                progress_id: progress_id.clone(),
            },
        );
        Ok(Self {
            id,
            cancellation,
            progress_id,
        })
    }

    pub(crate) fn ensure_active(&self) -> Result<(), String> {
        if self.cancellation.is_requested() {
            Err(SETUP_OPERATION_CANCELLED_MESSAGE.into())
        } else {
            Ok(())
        }
    }

    pub(crate) fn cancellation_requested(&self) -> bool {
        self.cancellation.is_requested()
    }

    pub(crate) async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }

    pub(crate) fn progress_id(&self) -> Option<String> {
        self.progress_id.clone()
    }
}

impl Drop for SetupOperation {
    fn drop(&mut self) {
        let mut coordinator = lock_setup_operations();
        let is_current = coordinator.active.get(&self.id).is_some_and(|active| {
            Arc::ptr_eq(&active.cancellation.requested, &self.cancellation.requested)
        });
        if is_current {
            coordinator.active.remove(&self.id);
        }
    }
}

pub(super) async fn wait_for_setup_operation_lock<'a>(
    lock: &'a tokio::sync::Mutex<()>,
    operation: &SetupOperation,
) -> Result<tokio::sync::MutexGuard<'a, ()>, String> {
    tokio::select! {
        guard = lock.lock() => {
            operation.ensure_active()?;
            Ok(guard)
        }
        _ = operation.cancelled() => Err(SETUP_OPERATION_CANCELLED_MESSAGE.into()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupOperationCancellationResult {
    pub accepted: bool,
    pub queued: bool,
}

/// Request cancellation for one frontend-owned setup action. A Windows
/// UAC prompt cannot be interrupted while ShellExecuteExW is inside the OS,
/// so cancellation is reported as queued. As soon as a process handle is
/// available, the normal process-tree cleanup path terminates and reaps it.
#[tauri::command]
pub fn cancel_setup_operation(operation_id: String) -> SetupOperationCancellationResult {
    let active = lock_setup_operations().active.get(&operation_id).cloned();
    let Some(active) = active else {
        return SetupOperationCancellationResult {
            accepted: false,
            queued: false,
        };
    };

    active.cancellation.request();
    crate::commands::setup_progress::emit_for_operation(
        &active.app,
        active.progress_id.as_deref(),
        active.kind.step(),
        &format!(
            "Cancellation requested. JunQi is safely stopping the active {} installer before setup continues.",
            active.kind.label()
        ),
        0.0,
    );
    SetupOperationCancellationResult {
        accepted: true,
        queued: true,
    }
}

/// A single Node.js or Git system-install transaction has one deadline shared
/// by download, elevated installer, and package-manager fallback. Keeping the
/// budget explicit prevents an outer timeout from dropping an installer future
/// while its Windows child process continues in the background.
#[derive(Debug, Clone, Copy)]
pub(super) struct DependencyInstallBudget {
    pub(super) deadline: std::time::Instant,
}

impl DependencyInstallBudget {
    pub(super) fn new() -> Self {
        Self {
            deadline: std::time::Instant::now() + DEPENDENCY_INSTALL_DEADLINE,
        }
    }

    pub(super) fn remaining(self) -> Option<std::time::Duration> {
        self.deadline
            .checked_duration_since(std::time::Instant::now())
    }

    #[cfg(any(windows, test))]
    pub(super) fn process_policy(self, operation: &str) -> Result<ControlledProcessPolicy, String> {
        let remaining = self
            .remaining()
            .filter(|remaining| !remaining.is_zero())
            .ok_or_else(|| {
                format!(
                    "{operation} exceeded the 30-minute dependency installation deadline before it could start"
                )
            })?;
        Ok(ControlledProcessPolicy::new(
            remaining.min(WINDOWS_INSTALLER_MAX_WAIT),
            PROCESS_HEARTBEAT_INTERVAL,
        ))
    }
}

/// The transaction budget belongs to the whole dependency install; this
/// nested budget gives each mirror a fair, bounded attempt. It prevents a
/// merely slow first source from starving every later mirror and nodejs.org.
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
pub(super) struct DownloadAttemptBudget {
    pub(super) transaction: DependencyInstallBudget,
    pub(super) source_deadline: std::time::Instant,
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
pub(super) enum DownloadTimeout {
    Transaction,
    Source,
    Idle,
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
impl DownloadAttemptBudget {
    pub(super) fn new(transaction: DependencyInstallBudget) -> Result<Self, DownloadTimeout> {
        let remaining = transaction
            .remaining()
            .ok_or(DownloadTimeout::Transaction)?;
        Ok(Self {
            transaction,
            source_deadline: std::time::Instant::now() + remaining.min(DOWNLOAD_SOURCE_TIMEOUT),
        })
    }

    pub(super) fn absolute_remaining(
        self,
    ) -> Result<(std::time::Duration, DownloadTimeout), DownloadTimeout> {
        let transaction = self
            .transaction
            .remaining()
            .ok_or(DownloadTimeout::Transaction)?;
        let source = self
            .source_deadline
            .checked_duration_since(std::time::Instant::now())
            .ok_or(DownloadTimeout::Source)?;
        if transaction <= source {
            Ok((transaction, DownloadTimeout::Transaction))
        } else {
            Ok((source, DownloadTimeout::Source))
        }
    }

    pub(super) fn next_chunk_timeout(
        self,
    ) -> Result<(std::time::Duration, DownloadTimeout), DownloadTimeout> {
        let (remaining, limit) = self.absolute_remaining()?;
        if remaining <= DOWNLOAD_IDLE_TIMEOUT {
            Ok((remaining, limit))
        } else {
            Ok((DOWNLOAD_IDLE_TIMEOUT, DownloadTimeout::Idle))
        }
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) fn download_timeout_message(timeout: DownloadTimeout) -> &'static str {
    match timeout {
        DownloadTimeout::Transaction => "the 30-minute dependency deadline",
        DownloadTimeout::Source => "the per-source download deadline",
        DownloadTimeout::Idle => "the 30-second download idle deadline",
    }
}

/// The lifecycle contract for an external installer: it is polled for UI
/// heartbeats, terminated as a tree on timeout, and reaped before the caller
/// can try another source.
#[cfg(any(windows, test))]
#[derive(Debug, Clone, Copy)]
pub(super) struct ControlledProcessPolicy {
    pub(super) timeout: std::time::Duration,
    pub(super) heartbeat_interval: std::time::Duration,
}

#[cfg(any(windows, test))]
impl ControlledProcessPolicy {
    pub(super) fn new(
        timeout: std::time::Duration,
        heartbeat_interval: std::time::Duration,
    ) -> Self {
        Self {
            timeout,
            heartbeat_interval,
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Debug)]
pub(super) enum ControlledProcessWaitError {
    Monitoring(String),
    Cancelled,
    TimedOut,
    CleanupIncomplete(String),
}

#[cfg(any(windows, test))]
pub(super) async fn wait_for_controlled_child<F>(
    child: &mut tokio::process::Child,
    policy: ControlledProcessPolicy,
    operation: Option<&SetupOperation>,
    mut report_heartbeat: F,
) -> Result<std::process::ExitStatus, ControlledProcessWaitError>
where
    F: FnMut(),
{
    let deadline = std::time::Instant::now() + policy.timeout;
    report_heartbeat();
    loop {
        if operation.is_some_and(SetupOperation::cancellation_requested) {
            let cleanup = terminate_process_tree_confirmed(child, child.id()).await;
            return match cleanup {
                Ok(()) => Err(ControlledProcessWaitError::Cancelled),
                Err(error) => Err(ControlledProcessWaitError::CleanupIncomplete(format!(
                    "Dependency installation was cancelled, but its process tree could not be confirmed stopped: {error}"
                ))),
            };
        }
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(error) => {
                let cleanup = terminate_process_tree_confirmed(child, child.id()).await;
                return match cleanup {
                    Ok(()) => Err(ControlledProcessWaitError::Monitoring(format!(
                        "Failed to monitor installer process after it was stopped: {error}"
                    ))),
                    Err(cleanup_error) => Err(ControlledProcessWaitError::CleanupIncomplete(
                        format!("Failed to monitor installer process: {error}; {cleanup_error}"),
                    )),
                };
            }
        }

        let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
            let cleanup = terminate_process_tree_confirmed(child, child.id()).await;
            return match cleanup {
                Ok(()) => Err(ControlledProcessWaitError::TimedOut),
                Err(error) => Err(ControlledProcessWaitError::CleanupIncomplete(error)),
            };
        };

        let sleep_for = remaining.min(policy.heartbeat_interval);
        if let Some(operation) = operation {
            tokio::select! {
                _ = tokio::time::sleep(sleep_for) => {}
                _ = operation.cancelled() => {}
            }
        } else {
            tokio::time::sleep(sleep_for).await;
        }
        if sleep_for == policy.heartbeat_interval {
            report_heartbeat();
        }
    }
}

pub(super) async fn next_download_chunk(
    response: &mut reqwest::Response,
) -> Result<Option<Vec<u8>>, reqwest::Error> {
    let chunk = response.chunk().await;
    chunk.map(|chunk| chunk.map(|bytes| bytes.to_vec()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dependency_budget_caps_an_installer_to_its_remaining_time() {
        let budget = DependencyInstallBudget {
            deadline: std::time::Instant::now() + std::time::Duration::from_secs(3),
        };

        let policy = budget
            .process_policy("test installer")
            .expect("a future budget should create a process policy");

        assert!(policy.timeout <= std::time::Duration::from_secs(3));
        assert!(policy.timeout > std::time::Duration::ZERO);
        assert_eq!(policy.heartbeat_interval, PROCESS_HEARTBEAT_INTERVAL);

        let expired = DependencyInstallBudget {
            deadline: std::time::Instant::now(),
        };
        assert!(expired.process_policy("expired installer").is_err());
    }
    #[tokio::test]
    async fn dependency_install_cancellation_wakes_waiters_without_reusing_the_signal() {
        let first = SetupOperationCancellation::new();
        let second = SetupOperationCancellation::new();
        let waiting = first.clone();
        let waiter = tokio::spawn(async move {
            waiting.cancelled().await;
        });

        tokio::task::yield_now().await;
        first.request();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("cancelled dependency install must wake its waiter")
            .expect("dependency cancellation waiter task must complete");

        assert!(first.is_requested());
        assert!(!second.is_requested());
    }

    #[tokio::test]
    async fn controlled_process_timeout_reaps_the_child_before_returning() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => {}, 10000)"])
            .kill_on_drop(true)
            .spawn()
            .expect("Node.js is required by the desktop build");

        let result = wait_for_controlled_child(
            &mut child,
            ControlledProcessPolicy::new(
                std::time::Duration::from_millis(25),
                std::time::Duration::from_millis(5),
            ),
            None,
            || {},
        )
        .await;

        assert!(matches!(result, Err(ControlledProcessWaitError::TimedOut)));
        assert!(
            child
                .try_wait()
                .expect("the controlled child should be inspectable after cleanup")
                .is_some(),
            "timeout must wait until the child is reaped before returning"
        );
    }

    #[test]
    fn controlled_process_errors_preserve_the_cleanup_diagnostic() {
        let monitoring = ControlledProcessWaitError::Monitoring("wait failed".into());
        assert!(matches!(
            monitoring,
            ControlledProcessWaitError::Monitoring(message) if message == "wait failed"
        ));

        let cleanup = ControlledProcessWaitError::CleanupIncomplete("tree not stopped".into());
        assert!(matches!(
            cleanup,
            ControlledProcessWaitError::CleanupIncomplete(message) if message == "tree not stopped"
        ));
    }
}
