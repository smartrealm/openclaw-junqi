#[cfg(windows)]
use crate::commands::git_runtime::{
    verified_managed_git_artifact, verified_system_git_installer_artifact,
};
#[cfg(windows)]
use crate::commands::node_runtime::node_installer_sources;
use crate::commands::node_runtime::{
    node_archive_sources, node_checksum_sources, node_index_sources, select_preferred_release,
    ManagedNodePlatform, NodeArchiveFormat, NodeDistributionRelease, NodeRequirementSource,
    NodeRuntimeRequirement,
};
#[cfg(target_os = "macos")]
use crate::commands::node_runtime::{node_macos_installer_filename, node_macos_installer_sources};
use crate::commands::npm_registry;
#[cfg(test)]
use crate::commands::process_control::terminate_process_tree;
use crate::commands::process_control::terminate_process_tree_confirmed;
#[cfg(windows)]
use crate::commands::process_control::{
    process_tree_was_already_gone, request_windows_process_tree_termination,
    terminate_windows_process_tree,
};
#[cfg(windows)]
use crate::commands::setup_diagnostics::diagnostic_artifact_path;
use crate::commands::setup_diagnostics::{
    record_process_finished, record_process_output, record_process_started, record_timeline_note,
    reset_timeline_log,
};
use crate::commands::setup_progress::{
    emit, emit_coalesced, emit_diagnostic, emit_keyed, emit_keyed_with_params,
};
use crate::paths;
use crate::platform;
use crate::state::GatewayProcess;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Mutex, OnceLock,
};

static OPENCLAW_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static NODE_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static GIT_INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static DEPENDENCY_INSTALL_OPERATIONS: OnceLock<Mutex<DependencyInstallOperationCoordinator>> =
    OnceLock::new();
#[cfg(windows)]
const WINGET_NODE_LTS_PACKAGE: &str = "OpenJS.NodeJS.LTS";
#[cfg(windows)]
const WINGET_NODE_CURRENT_PACKAGE: &str = "OpenJS.NodeJS";
#[cfg(windows)]
const WINGET_GIT_PACKAGE: &str = "Git.Git";
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
const RUNTIME_NETWORK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
/// One dependency installation is a transaction. Individual mirrors and
/// package-manager operations may retry, but they must share one upper bound
/// so a slow Windows network or installer cannot hold the setup lock forever.
const DEPENDENCY_INSTALL_DEADLINE: std::time::Duration = std::time::Duration::from_secs(30 * 60);
/// A stalled mirror must not consume the full installation transaction before
/// the official fallback gets a chance. Continuous progress is still shown to
/// the user, but one source has a bounded attempt window.
const DOWNLOAD_SOURCE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2 * 60);
const DOWNLOAD_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const NODE_INDEX_STAGGER: std::time::Duration = std::time::Duration::from_millis(250);
// A normal Node.js/Git MSI or Inno Setup transaction completes well within a
// few minutes. A longer wait hides a blocked Windows Installer service and
// prevents the controlled fallback from producing a useful diagnostic.
#[cfg(any(windows, test))]
const WINDOWS_INSTALLER_MAX_WAIT: std::time::Duration = std::time::Duration::from_secs(5 * 60);
#[cfg(any(windows, test))]
const PROCESS_HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(2);
#[cfg(windows)]
const WINDOWS_RUNTIME_SETTLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);
const PROCESS_REAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

const DEPENDENCY_INSTALL_OPERATION_ID_MAX_LEN: usize = 160;
const DEPENDENCY_INSTALL_CANCELLED_MESSAGE: &str =
    "Dependency installation was cancelled before JunQi activated a runtime";

/// The dependency installer is intentionally a separate operation from the
/// surrounding setup flow. It lets a UI run cancel exactly the Node.js or Git
/// work it started without a late cancel request affecting a newer retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DependencyInstallTool {
    Node,
    Git,
}

impl DependencyInstallTool {
    fn step(self) -> &'static str {
        match self {
            Self::Node => "node",
            Self::Git => "git",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Node => "Node.js",
            Self::Git => "Git",
        }
    }
}

#[derive(Clone)]
struct DependencyInstallCancellation {
    requested: Arc<AtomicBool>,
    changes: tokio::sync::watch::Sender<bool>,
}

impl DependencyInstallCancellation {
    fn new() -> Self {
        let (changes, _) = tokio::sync::watch::channel(false);
        Self {
            requested: Arc::new(AtomicBool::new(false)),
            changes,
        }
    }

    fn request(&self) {
        if !self.requested.swap(true, Ordering::SeqCst) {
            self.changes.send_replace(true);
        }
    }

    fn is_requested(&self) -> bool {
        self.requested.load(Ordering::SeqCst)
    }

    async fn cancelled(&self) {
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
struct ActiveDependencyInstallOperation {
    app: tauri::AppHandle,
    tool: DependencyInstallTool,
    cancellation: DependencyInstallCancellation,
}

#[derive(Default)]
struct DependencyInstallOperationCoordinator {
    active: HashMap<String, ActiveDependencyInstallOperation>,
}

fn dependency_install_operations() -> &'static Mutex<DependencyInstallOperationCoordinator> {
    DEPENDENCY_INSTALL_OPERATIONS
        .get_or_init(|| Mutex::new(DependencyInstallOperationCoordinator::default()))
}

fn lock_dependency_install_operations(
) -> std::sync::MutexGuard<'static, DependencyInstallOperationCoordinator> {
    dependency_install_operations()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// An RAII lease for one cancellable Node.js or Git install. The coordinator
/// only stores active leases; dropping a completed or failed lease removes its
/// identifier so a later retry can reuse neither its cancellation signal nor
/// its progress ownership.
struct DependencyInstallOperation {
    id: String,
    cancellation: DependencyInstallCancellation,
}

impl DependencyInstallOperation {
    fn begin(
        app: &tauri::AppHandle,
        tool: DependencyInstallTool,
        requested_id: Option<String>,
    ) -> Result<Self, String> {
        let id = match requested_id {
            Some(id) => {
                let id = id.trim();
                if id.is_empty()
                    || id.len() > DEPENDENCY_INSTALL_OPERATION_ID_MAX_LEN
                    || id.chars().any(char::is_control)
                {
                    return Err("Invalid dependency installation operation identifier".into());
                }
                id.to_owned()
            }
            None => format!("internal-dependency-install-{}", uuid::Uuid::new_v4()),
        };
        let cancellation = DependencyInstallCancellation::new();
        let mut coordinator = lock_dependency_install_operations();
        if coordinator.active.contains_key(&id) {
            return Err(format!(
                "A dependency installation is already active for this setup operation ({})",
                tool.label()
            ));
        }
        coordinator.active.insert(
            id.clone(),
            ActiveDependencyInstallOperation {
                app: app.clone(),
                tool,
                cancellation: cancellation.clone(),
            },
        );
        Ok(Self { id, cancellation })
    }

    fn ensure_active(&self) -> Result<(), String> {
        if self.cancellation.is_requested() {
            Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into())
        } else {
            Ok(())
        }
    }

    fn cancellation_requested(&self) -> bool {
        self.cancellation.is_requested()
    }

    async fn cancelled(&self) {
        self.cancellation.cancelled().await;
    }
}

impl Drop for DependencyInstallOperation {
    fn drop(&mut self) {
        let mut coordinator = lock_dependency_install_operations();
        let is_current = coordinator.active.get(&self.id).is_some_and(|active| {
            Arc::ptr_eq(&active.cancellation.requested, &self.cancellation.requested)
        });
        if is_current {
            coordinator.active.remove(&self.id);
        }
    }
}

async fn wait_for_dependency_install_lock<'a>(
    lock: &'a tokio::sync::Mutex<()>,
    operation: &DependencyInstallOperation,
) -> Result<tokio::sync::MutexGuard<'a, ()>, String> {
    tokio::select! {
        guard = lock.lock() => {
            operation.ensure_active()?;
            Ok(guard)
        }
        _ = operation.cancelled() => Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInstallCancellationResult {
    pub accepted: bool,
    pub queued: bool,
}

/// Request cancellation for one frontend-owned dependency install. A Windows
/// UAC prompt cannot be interrupted while ShellExecuteExW is inside the OS,
/// so cancellation is reported as queued. As soon as a process handle is
/// available, the normal process-tree cleanup path terminates and reaps it.
#[tauri::command]
pub fn cancel_dependency_install(operation_id: String) -> DependencyInstallCancellationResult {
    let active = lock_dependency_install_operations()
        .active
        .get(&operation_id)
        .cloned();
    let Some(active) = active else {
        return DependencyInstallCancellationResult {
            accepted: false,
            queued: false,
        };
    };

    active.cancellation.request();
    emit(
        &active.app,
        active.tool.step(),
        &format!(
            "Cancellation requested. JunQi is safely stopping the active {} installer before setup continues.",
            active.tool.label()
        ),
        0.0,
    );
    DependencyInstallCancellationResult {
        accepted: true,
        queued: true,
    }
}

/// A single Node.js or Git system-install transaction has one deadline shared
/// by download, elevated installer, and package-manager fallback. Keeping the
/// budget explicit prevents an outer timeout from dropping an installer future
/// while its Windows child process continues in the background.
#[derive(Debug, Clone, Copy)]
struct DependencyInstallBudget {
    deadline: std::time::Instant,
}

impl DependencyInstallBudget {
    fn new() -> Self {
        Self {
            deadline: std::time::Instant::now() + DEPENDENCY_INSTALL_DEADLINE,
        }
    }

    fn remaining(self) -> Option<std::time::Duration> {
        self.deadline
            .checked_duration_since(std::time::Instant::now())
    }

    #[cfg(any(windows, test))]
    fn process_policy(self, operation: &str) -> Result<ControlledProcessPolicy, String> {
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
struct DownloadAttemptBudget {
    transaction: DependencyInstallBudget,
    source_deadline: std::time::Instant,
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
#[derive(Debug, Clone, Copy)]
enum DownloadTimeout {
    Transaction,
    Source,
    Idle,
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
impl DownloadAttemptBudget {
    fn new(transaction: DependencyInstallBudget) -> Result<Self, DownloadTimeout> {
        let remaining = transaction
            .remaining()
            .ok_or(DownloadTimeout::Transaction)?;
        Ok(Self {
            transaction,
            source_deadline: std::time::Instant::now() + remaining.min(DOWNLOAD_SOURCE_TIMEOUT),
        })
    }

    fn absolute_remaining(self) -> Result<(std::time::Duration, DownloadTimeout), DownloadTimeout> {
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

    fn next_chunk_timeout(self) -> Result<(std::time::Duration, DownloadTimeout), DownloadTimeout> {
        let (remaining, limit) = self.absolute_remaining()?;
        if remaining <= DOWNLOAD_IDLE_TIMEOUT {
            Ok((remaining, limit))
        } else {
            Ok((DOWNLOAD_IDLE_TIMEOUT, DownloadTimeout::Idle))
        }
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn download_timeout_message(timeout: DownloadTimeout) -> &'static str {
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
struct ControlledProcessPolicy {
    timeout: std::time::Duration,
    heartbeat_interval: std::time::Duration,
}

#[cfg(any(windows, test))]
impl ControlledProcessPolicy {
    fn new(timeout: std::time::Duration, heartbeat_interval: std::time::Duration) -> Self {
        Self {
            timeout,
            heartbeat_interval,
        }
    }
}

#[cfg(any(windows, test))]
#[derive(Debug)]
enum ControlledProcessWaitError {
    Monitoring(String),
    Cancelled,
    TimedOut,
    CleanupIncomplete(String),
}

#[cfg(any(windows, test))]
async fn wait_for_controlled_child<F>(
    child: &mut tokio::process::Child,
    policy: ControlledProcessPolicy,
    operation: Option<&DependencyInstallOperation>,
    mut report_heartbeat: F,
) -> Result<std::process::ExitStatus, ControlledProcessWaitError>
where
    F: FnMut(),
{
    let deadline = std::time::Instant::now() + policy.timeout;
    report_heartbeat();
    loop {
        if operation.is_some_and(DependencyInstallOperation::cancellation_requested) {
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

async fn next_download_chunk(
    response: &mut reqwest::Response,
) -> Result<Option<Vec<u8>>, reqwest::Error> {
    let chunk = response.chunk().await;
    chunk.map(|chunk| chunk.map(|bytes| bytes.to_vec()))
}

#[cfg(windows)]
struct WindowsInstallProgress<'a> {
    app: &'a tauri::AppHandle,
    step: &'a str,
    tool: &'a str,
    started_at: std::time::Instant,
    progress_start: f64,
    progress_end: f64,
}

#[cfg(windows)]
impl<'a> WindowsInstallProgress<'a> {
    fn new(
        app: &'a tauri::AppHandle,
        step: &'a str,
        tool: &'a str,
        progress_start: f64,
        progress_end: f64,
    ) -> Self {
        Self {
            app,
            step,
            tool,
            started_at: std::time::Instant::now(),
            progress_start,
            progress_end,
        }
    }

    fn progress(&self) -> f64 {
        // Installer APIs do not expose a trustworthy percentage. Keep the
        // progress bar at the phase boundary and expose elapsed time through
        // the heartbeat text instead of presenting a fabricated completion
        // percentage that can look stuck or falsely complete.
        self.progress_start.min(self.progress_end)
    }

    fn elapsed(&self) -> String {
        let seconds = self.started_at.elapsed().as_secs();
        format!("{:02}:{:02}", seconds / 60, seconds % 60)
    }

    fn report_installer_wait(&self) {
        let elapsed = self.elapsed();
        emit_keyed_with_params(
            self.app,
            self.step,
            &format!("{} installer is running (elapsed {elapsed})", self.tool),
            "setup.windows.installerWaiting",
            &[("tool", self.tool), ("elapsed", &elapsed)],
            self.progress(),
        );
    }

    fn report_admin_prompt(&self) {
        emit_keyed_with_params(
            self.app,
            self.step,
            &format!(
                "Waiting for Windows administrator approval before starting the {} installer…",
                self.tool
            ),
            "setup.windows.adminPrompt",
            &[("tool", self.tool)],
            self.progress_start,
        );
    }

    fn report_package_manager_wait(&self) {
        let elapsed = self.elapsed();
        emit_keyed_with_params(
            self.app,
            self.step,
            &format!(
                "Windows Package Manager is processing {} (elapsed {elapsed})",
                self.tool
            ),
            "setup.windows.packageManagerWaiting",
            &[("tool", self.tool), ("elapsed", &elapsed)],
            self.progress(),
        );
    }
}

struct TemporaryDirectory(PathBuf);

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const MANAGED_RUNTIME_MARKER: &str = ".junqi-managed-runtime.json";
const MANAGED_RUNTIME_SCHEMA: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct ManagedRuntimeMarker {
    schema: u32,
    owner: String,
    tool: String,
}

fn runtime_path_is_reparse_point(path: &Path) -> bool {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn runtime_path_has_reparse_ancestor(path: &Path) -> bool {
    let mut cursor = path;
    loop {
        if runtime_path_is_reparse_point(cursor) {
            return true;
        }
        let Some(parent) = cursor.parent() else {
            return false;
        };
        if parent == cursor {
            return false;
        }
        cursor = parent;
    }
}

fn runtime_marker_path(root: &Path) -> PathBuf {
    root.join(MANAGED_RUNTIME_MARKER)
}

fn runtime_marker_matches(root: &Path, tool: &str) -> bool {
    let Ok(raw) = std::fs::read_to_string(runtime_marker_path(root)) else {
        return false;
    };
    serde_json::from_str::<ManagedRuntimeMarker>(&raw).is_ok_and(|marker| {
        marker.schema == MANAGED_RUNTIME_SCHEMA
            && marker.owner == "junqi-desktop"
            && marker.tool == tool
    })
}

fn write_runtime_marker(root: &Path, tool: &str) -> Result<(), String> {
    let marker = ManagedRuntimeMarker {
        schema: MANAGED_RUNTIME_SCHEMA,
        owner: "junqi-desktop".into(),
        tool: tool.into(),
    };
    let raw = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("Failed to serialize {tool} runtime marker: {error}"))?;
    crate::paths::atomic_write_text(&runtime_marker_path(root), &raw)
}

fn runtime_target_is_empty(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    if runtime_path_is_reparse_point(path) || !path.is_dir() {
        return Ok(false);
    }
    Ok(std::fs::read_dir(path)
        .map_err(|error| {
            format!(
                "Failed to inspect runtime directory {}: {error}",
                path.display()
            )
        })?
        .next()
        .is_none())
}

fn validate_runtime_target_for_activation(target: &Path, tool: &str) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    if runtime_path_has_reparse_ancestor(target) {
        return Err(format!(
            "Selected {tool} runtime directory {} is a symbolic link or Windows junction; choose a real empty directory managed by JunQi",
            target.display()
        ));
    }
    if runtime_target_is_empty(target)? || runtime_marker_matches(target, tool) {
        return Ok(());
    }
    Err(format!(
        "Selected {tool} runtime directory {} contains files not owned by JunQi. It will not be replaced; choose an empty directory or clear the custom runtime selection",
        target.display()
    ))
}

struct ManagedRuntimeActivation {
    target: PathBuf,
    backup: Option<PathBuf>,
    committed: bool,
}

enum ManagedRuntimeCommit {
    Finalized,
    BackupCleanupDeferred(String),
}

impl ManagedRuntimeActivation {
    /// Finalize a validated activation without recursively deleting the old
    /// user-selected directory. A backup can receive external files while an
    /// installer runs, so only an empty backup is removed automatically.
    fn commit(mut self) -> ManagedRuntimeCommit {
        self.committed = true;
        if let Some(backup) = self.backup.take() {
            if backup.exists() {
                return match crate::commands::directory_transaction::remove_empty_directory(
                    &backup,
                    "previous managed runtime backup",
                ) {
                    Ok(()) => ManagedRuntimeCommit::Finalized,
                    Err(error) => ManagedRuntimeCommit::BackupCleanupDeferred(format!(
                        "Managed runtime activated, but its previous backup remains at {}: {}",
                        backup.display(),
                        error
                    )),
                };
            }
        }
        ManagedRuntimeCommit::Finalized
    }

    fn rollback(&mut self) -> Result<Option<PathBuf>, String> {
        if self.committed {
            return Ok(None);
        }
        let recovery = crate::commands::directory_transaction::preserve_directory_for_recovery(
            &self.target,
            "unverified activated runtime",
        )?;
        if let Some(backup) = self.backup.as_ref().filter(|backup| backup.exists()) {
            std::fs::rename(backup, &self.target).map_err(|error| {
                format!(
                    "Failed to restore the previous managed runtime from {}: {}",
                    backup.display(),
                    error
                )
            })?;
        }
        self.committed = true;
        Ok(recovery)
    }
}

impl Drop for ManagedRuntimeActivation {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        // Ordinary validation failures call `rollback` explicitly so their
        // diagnostics reach the user. Drop is only an unwind backstop.
        let _ = self.rollback();
    }
}

fn rollback_cancelled_runtime_activation(activation: &mut ManagedRuntimeActivation) -> String {
    match activation.rollback() {
        Ok(Some(recovery)) => format!(
            "{DEPENDENCY_INSTALL_CANCELLED_MESSAGE}; the partially activated runtime was preserved for recovery at {}",
            recovery.display()
        ),
        Ok(None) => DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into(),
        Err(rollback_error) => format!(
            "{DEPENDENCY_INSTALL_CANCELLED_MESSAGE}; runtime rollback also failed: {rollback_error}"
        ),
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn runtime_binary(root: &Path, tool: &str) -> PathBuf {
    match (tool, cfg!(windows)) {
        ("node", true) => root.join("node.exe"),
        ("node", false) => root.join("bin").join("node"),
        ("git", true) => root.join("cmd").join("git.exe"),
        ("git", false) => root.join("bin").join("git"),
        _ => root.join(tool),
    }
}

async fn read_runtime_version(path: &Path) -> Option<String> {
    let mut command = tokio::process::Command::new(path);
    command
        .arg("--version")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let output = tokio::time::timeout(std::time::Duration::from_secs(10), command.output())
        .await
        .ok()?
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|version| !version.is_empty())
}

/// Validate the complete executable contract of one Node.js distribution.
///
/// Checking for `npm-cli.js` is insufficient: partial installers and damaged
/// portable directories can retain that file while the selected Node can no
/// longer execute it. This helper is used both before and after activation so
/// the runtime transaction never reports success for a Node-only install.
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn validate_node_runtime_pair(
    node_path: &Path,
    requirement: &NodeRuntimeRequirement,
) -> Result<(String, String), String> {
    let version = read_runtime_version(node_path).await.ok_or_else(|| {
        format!(
            "Node.js executable could not be verified at {}",
            node_path.display()
        )
    })?;
    if !requirement.supports(&version) {
        return Err(format!(
            "Node.js {version} at {} does not satisfy OpenClaw requirement {}",
            node_path.display(),
            requirement.expression()
        ));
    }
    let node = crate::commands::system::NodeStatus {
        available: true,
        version: Some(version.clone()),
        path: Some(node_path.to_string_lossy().into_owned()),
        source: None,
    };
    let npm = crate::commands::system::check_npm_for_node(&node).await;
    let npm_version = npm.version.ok_or_else(|| {
        format!(
            "Node.js {version} at {} does not provide an executable bundled npm CLI: {}",
            node_path.display(),
            npm.reason.unwrap_or_else(|| "npm was unavailable".into())
        )
    })?;
    Ok((version, npm_version))
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn activate_staged_runtime(
    staging: &Path,
    target: &Path,
    name: &str,
) -> Result<ManagedRuntimeActivation, String> {
    if !runtime_marker_matches(staging, name) {
        return Err(format!(
            "Refusing to activate an unmarked {name} runtime staging directory"
        ));
    }
    validate_runtime_target_for_activation(target, name)?;
    let parent = target
        .parent()
        .ok_or_else(|| format!("Managed {name} target has no parent directory"))?;
    let backup = parent.join(format!(".{name}-backup-{}", uuid::Uuid::new_v4()));
    let had_target = target.exists();
    if had_target {
        std::fs::rename(target, &backup)
            .map_err(|error| format!("Failed to stage existing managed {name}: {error}"))?;
    }
    if let Err(error) = std::fs::rename(staging, target) {
        if backup.exists() {
            std::fs::rename(&backup, target).map_err(|rollback_error| {
                format!(
                    "Failed to activate managed {name}: {error}; rollback failed: {rollback_error}"
                )
            })?;
        }
        return Err(format!("Failed to activate managed {name}: {error}"));
    }
    Ok(ManagedRuntimeActivation {
        target: target.to_path_buf(),
        backup: had_target.then_some(backup),
        committed: false,
    })
}

/// Immutable description of one verified runtime download. The transaction
/// budget is deliberately separate because callers may share it with an
/// installer process and package-manager fallback.
#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
struct DownloadRequest<'a> {
    app: &'a tauri::AppHandle,
    step: &'a str,
    sources: &'a [(String, &'static str)],
    destination: &'a Path,
    expected_sha256: &'a str,
    progress: std::ops::Range<f64>,
}

fn compact_elapsed(duration: std::time::Duration) -> String {
    let seconds = duration.as_secs();
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let seconds = seconds % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

fn transfer_rate_mib_per_second(bytes: u64, elapsed: std::time::Duration) -> f64 {
    let seconds = elapsed.as_secs_f64().max(0.001);
    bytes as f64 / 1024.0 / 1024.0 / seconds
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn download_with_fallback(
    request: DownloadRequest<'_>,
    operation: &DependencyInstallOperation,
) -> Result<u64, String> {
    download_with_fallback_with_budget(request, DependencyInstallBudget::new(), operation).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn download_with_fallback_with_budget(
    request: DownloadRequest<'_>,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<u64, String> {
    operation.ensure_active()?;
    let DownloadRequest {
        app,
        step,
        sources,
        destination,
        expected_sha256,
        progress,
    } = request;
    let prog_start = progress.start;
    let prog_end = progress.end;
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(DOWNLOAD_SOURCE_TIMEOUT)
        .user_agent("JunQi Desktop runtime downloader")
        .build()
        .map_err(|error| format!("Failed to initialize downloader: {error}"))?;
    let mut last_error = "no download source responded".to_string();
    let download_run_id = uuid::Uuid::new_v4().simple().to_string();
    for (index, (url, label)) in sources.iter().enumerate() {
        operation.ensure_active()?;
        let log_slot = format!("download-{download_run_id}-{}", index + 1);
        let source_started = std::time::Instant::now();
        // A mirror that stalls or errors out must still leave a trace: without
        // this, hopping to the next source looks identical to a slow single
        // attempt in the timeline log.
        let note_source_failure = |reason: &str| {
            record_timeline_note(
                app,
                step,
                &format!(
                    "{label} failed after {:.1}s: {reason}",
                    source_started.elapsed().as_secs_f64()
                ),
            );
        };
        let attempt = match DownloadAttemptBudget::new(budget) {
            Ok(attempt) => attempt,
            Err(DownloadTimeout::Transaction) => {
                return Err(format!(
                    "下载 {} 超过 30 分钟总时限。最后错误：{}",
                    step, last_error
                ));
            }
            Err(_) => {
                unreachable!("a new download attempt cannot start with an expired source deadline")
            }
        };
        emit_coalesced(
            app,
            step,
            &format!(
                "【下载 {}/{}】正在连接 {}...",
                index + 1,
                sources.len(),
                label
            ),
            &log_slot,
            prog_start,
        );
        let (connect_timeout, connect_limit) = attempt.absolute_remaining().map_err(|timeout| {
            format!(
                "下载 {} 超过 {}。最后错误：{}",
                step,
                download_timeout_message(timeout),
                last_error
            )
        })?;
        let connection = tokio::select! {
            response = tokio::time::timeout(connect_timeout, client.get(url).send()) => response,
            _ = operation.cancelled() => return Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into()),
        };
        let mut response = match connection {
            Ok(result) => match result {
                Ok(response) => match response.error_for_status() {
                    Ok(response) => response,
                    Err(error) => {
                        last_error = format!("{label}: {error}");
                        note_source_failure(&error.to_string());
                        continue;
                    }
                },
                Err(error) => {
                    last_error = format!("{label}: {error}");
                    note_source_failure(&error.to_string());
                    continue;
                }
            },
            Err(_) => {
                if matches!(connect_limit, DownloadTimeout::Transaction) {
                    note_source_failure("30-minute transaction deadline exceeded while connecting");
                    return Err(format!(
                        "下载 {} 超过 30 分钟总时限。最后错误：{}",
                        step, last_error
                    ));
                }
                last_error = format!(
                    "{label}: connection exceeded {}",
                    download_timeout_message(connect_limit)
                );
                note_source_failure(&format!(
                    "connection exceeded {}",
                    download_timeout_message(connect_limit)
                ));
                continue;
            }
        };
        let header_elapsed = source_started.elapsed();
        let response_status = response.status();
        let total = response.content_length().unwrap_or(0);
        let response_detail = format!(
            "{label} response headers received in {:.2}s (HTTP {}, content-length={})",
            header_elapsed.as_secs_f64(),
            response_status.as_u16(),
            if total > 0 {
                format!("{:.1} MB", total as f64 / 1024.0 / 1024.0)
            } else {
                "unknown".to_string()
            },
        );
        record_timeline_note(app, step, &response_detail);
        emit_diagnostic(app, step, &response_detail, prog_start);
        let mut file = match tokio::fs::File::create(destination).await {
            Ok(file) => file,
            Err(error) => {
                return Err(format!(
                    "Failed to create {}: {error}",
                    destination.display()
                ));
            }
        };
        if let Err(error) = operation.ensure_active() {
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            return Err(error);
        }
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        let mut last_reported_percent = 0_u64;
        let mut stream_error = None;
        loop {
            let (chunk_timeout, chunk_limit) = match attempt.next_chunk_timeout() {
                Ok(timeout) => timeout,
                Err(DownloadTimeout::Transaction) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(destination).await;
                    return Err(format!(
                        "下载 {} 超过 30 分钟总时限。最后错误：{}",
                        step, last_error
                    ));
                }
                Err(timeout) => {
                    stream_error = Some(format!(
                        "{label}: exceeded {}",
                        download_timeout_message(timeout)
                    ));
                    break;
                }
            };
            let chunk_result = tokio::select! {
                chunk = tokio::time::timeout(chunk_timeout, next_download_chunk(&mut response)) => chunk,
                _ = operation.cancelled() => {
                    drop(file);
                    let _ = tokio::fs::remove_file(destination).await;
                    return Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into());
                }
            };
            let chunk = match chunk_result {
                Ok(Ok(Some(chunk))) => chunk,
                Ok(Ok(None)) => break,
                Ok(Err(error)) => {
                    stream_error = Some(error.to_string());
                    break;
                }
                Err(_) => {
                    if matches!(chunk_limit, DownloadTimeout::Transaction) {
                        drop(file);
                        let _ = tokio::fs::remove_file(destination).await;
                        return Err(format!(
                            "下载 {} 超过 30 分钟总时限。最后错误：{}",
                            step, last_error
                        ));
                    }
                    stream_error = Some(format!(
                        "{label}: exceeded {}",
                        download_timeout_message(chunk_limit)
                    ));
                    break;
                }
            };
            if chunk.is_empty() {
                continue;
            }
            use tokio::io::AsyncWriteExt;
            if let Err(error) = file.write_all(&chunk).await {
                return Err(format!(
                    "Failed to write {}: {error}",
                    destination.display()
                ));
            }
            if let Err(error) = operation.ensure_active() {
                drop(file);
                let _ = tokio::fs::remove_file(destination).await;
                return Err(error);
            }
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;

            let percent = downloaded
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(downloaded / (5 * 1024 * 1024));
            if percent > last_reported_percent {
                last_reported_percent = percent;
                let fraction = if total > 0 {
                    (downloaded as f64 / total as f64).clamp(0.0, 1.0)
                } else {
                    0.5
                };
                let progress = prog_start + (prog_end - prog_start) * fraction;
                let elapsed = source_started.elapsed();
                let rate = transfer_rate_mib_per_second(downloaded, elapsed);
                let detail = if total > 0 {
                    format!(
                        "【下载 {}/{}】{}：{:.1}/{:.1} MB（{}%，{:.2} MB/s，已用时 {}）",
                        index + 1,
                        sources.len(),
                        label,
                        downloaded as f64 / 1024.0 / 1024.0,
                        total as f64 / 1024.0 / 1024.0,
                        (fraction * 100.0).round() as u64,
                        rate,
                        compact_elapsed(elapsed),
                    )
                } else {
                    format!(
                        "【下载 {}/{}】{}：已下载 {:.1} MB（{:.2} MB/s，已用时 {}）",
                        index + 1,
                        sources.len(),
                        label,
                        downloaded as f64 / 1024.0 / 1024.0,
                        rate,
                        compact_elapsed(elapsed),
                    )
                };
                emit_coalesced(app, step, &detail, &log_slot, progress);
            }
        }
        if let Some(error) = stream_error {
            last_error = format!("{label}: {error}");
            note_source_failure(&error);
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            continue;
        }
        if downloaded == 0 {
            last_error = format!("{label}: empty response");
            note_source_failure("empty response");
            drop(file);
            let _ = tokio::fs::remove_file(destination).await;
            continue;
        }
        use tokio::io::AsyncWriteExt;
        if let Err(error) = file.flush().await {
            return Err(format!(
                "Failed to flush {}: {error}",
                destination.display()
            ));
        }
        drop(file);
        operation.ensure_active()?;
        let actual = format!("{:x}", hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            last_error = format!("{label}: SHA-256 mismatch");
            note_source_failure("SHA-256 mismatch");
            let _ = tokio::fs::remove_file(destination).await;
            continue;
        }
        let completed_elapsed = source_started.elapsed();
        record_timeline_note(
            app,
            step,
            &format!(
                "{label} succeeded after {:.1}s; downloaded {:.1} MB; average {:.2} MB/s",
                completed_elapsed.as_secs_f64(),
                downloaded as f64 / 1024.0 / 1024.0,
                transfer_rate_mib_per_second(downloaded, completed_elapsed),
            ),
        );
        emit_coalesced(
            app,
            step,
            &format!(
                "Download verified via {} ({:.1} MB)",
                label,
                total.max(downloaded) as f64 / 1024.0 / 1024.0
            ),
            &log_slot,
            prog_end,
        );
        return Ok(downloaded);
    }
    Err(format!("所有下载源均失败。最后错误：{last_error}"))
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
fn extract_zip(
    app: &tauri::AppHandle,
    step: &str,
    archive: &Path,
    dest: &Path,
    strip_top_level: bool,
    progress: f64,
    operation: &DependencyInstallOperation,
) -> Result<(), String> {
    operation.ensure_active()?;
    let file =
        std::fs::File::open(archive).map_err(|error| format!("Failed to open archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read zip archive: {error}"))?;
    emit(
        app,
        step,
        &format!("Extracting {} files...", archive.len()),
        progress,
    );
    let total_entries = archive.len().max(1);
    let mut last_reported_percent = 0_usize;
    for index in 0..archive.len() {
        operation.ensure_active()?;
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(mut relative) = entry.enclosed_name() else {
            continue;
        };
        if strip_top_level {
            relative = relative.components().skip(1).collect();
            if relative.as_os_str().is_empty() {
                continue;
            }
        }
        let output = dest.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            let mut file = std::fs::File::create(&output)
                .map_err(|error| format!("Failed to create {}: {error}", output.display()))?;
            std::io::copy(&mut entry, &mut file)
                .map_err(|error| format!("Failed to extract {}: {error}", output.display()))?;
        }
        let percent = (index + 1) * 100 / total_entries;
        if percent >= last_reported_percent + 5 || index + 1 == total_entries {
            last_reported_percent = percent;
            emit(
                app,
                step,
                &format!(
                    "Extracting files: {}/{} ({}%)",
                    index + 1,
                    total_entries,
                    percent
                ),
                progress + (1.0 - progress) * (percent as f64 / 100.0) * 0.35,
            );
        }
    }
    Ok(())
}

fn extract_tar_gz(
    app: &tauri::AppHandle,
    step: &str,
    archive: &Path,
    dest: &Path,
    progress: f64,
    operation: &DependencyInstallOperation,
) -> Result<(), String> {
    operation.ensure_active()?;
    let file =
        std::fs::File::open(archive).map_err(|error| format!("Failed to open archive: {error}"))?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    emit(app, step, "Extracting Node.js runtime...", progress);
    let entries = archive
        .entries()
        .map_err(|error| format!("Failed to inspect Node.js archive: {error}"))?;
    let mut extracted = 0_usize;
    for entry in entries {
        operation.ensure_active()?;
        entry
            .map_err(|error| format!("Failed to read Node.js archive entry: {error}"))?
            .unpack_in(dest)
            .map_err(|error| format!("Failed to extract Node.js archive: {error}"))?;
        extracted += 1;
        if extracted.is_multiple_of(128) {
            emit(
                app,
                step,
                &format!("Extracting Node.js runtime: {extracted} archive entries processed"),
                progress,
            );
        }
    }
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
async fn extract_node_archive(
    app: &tauri::AppHandle,
    archive: &Path,
    stage_container: &Path,
    version: &str,
    platform: ManagedNodePlatform,
    operation: &DependencyInstallOperation,
) -> Result<PathBuf, String> {
    operation.ensure_active()?;
    match platform.archive_format {
        NodeArchiveFormat::Zip => {
            tokio::task::block_in_place(|| {
                extract_zip(app, "node", archive, stage_container, true, 0.65, operation)
            })?;
            Ok(stage_container.to_path_buf())
        }
        NodeArchiveFormat::TarGz => {
            tokio::task::block_in_place(|| {
                extract_tar_gz(app, "node", archive, stage_container, 0.65, operation)
            })?;
            let top_level = platform
                .extracted_root(version)
                .ok_or("The Node.js platform model did not provide an extracted root")?;
            let extracted = stage_container.join(top_level);
            if !extracted.is_dir() {
                return Err("Downloaded Node.js archive has an unexpected directory layout".into());
            }
            Ok(extracted)
        }
    }
}

// ─── npm install with registry fallback ───────────────────────────────────────

const NPM_INACTIVITY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);
const NPM_SLOW_FETCH_THRESHOLD: std::time::Duration = std::time::Duration::from_secs(90);
const NPM_DIAGNOSTIC_LINE_LIMIT: usize = 24;

const NPM_NOISY_LOG_PREFIXES: &[&str] = &[
    "npm verbose",
    "npm sill",
    "npm timing",
    "npm notice",
    "npm http fetch",
];

const NPM_SECRET_MARKERS: &[&str] = &[
    "_authtoken",
    "authorization",
    "bearer ",
    "password",
    "api_key",
    "apikey",
];

fn npm_log_line_is_noisy(line: &str) -> bool {
    let lowercase = line.trim().to_ascii_lowercase();
    NPM_NOISY_LOG_PREFIXES
        .iter()
        .any(|prefix| lowercase.starts_with(prefix))
}

fn npm_log_line_is_http_fetch(line: &str) -> bool {
    line.trim()
        .to_ascii_lowercase()
        .starts_with("npm http fetch")
}

#[derive(Default)]
struct NpmStreamProgress {
    milestone: AtomicUsize,
    http_requests: AtomicUsize,
}

impl NpmStreamProgress {
    fn observe(&self, line: &str) -> f64 {
        let lower = line.trim().to_ascii_lowercase();
        let candidate = if lower.contains("npm http fetch") {
            let requests = self.http_requests.fetch_add(1, Ordering::Relaxed) + 1;
            300 + requests.min(250)
        } else if lower.contains("preinstall")
            || lower.contains("postinstall")
            || lower.contains("node-gyp-build")
            || lower.contains("install script")
            || lower.contains("foreground script")
        {
            720
        } else if lower.starts_with("added ")
            || lower.starts_with("changed ")
            || lower.starts_with("removed ")
            || lower.contains("packages in")
        {
            880
        } else if lower.contains("reify")
            || lower.contains("extract")
            || lower.contains("unpack")
            || lower.contains("package tree")
            || lower.contains("staging")
        {
            620
        } else if lower.contains("resolv")
            || lower.contains("ideal tree")
            || lower.contains("idealtree")
            || lower.contains("fetch manifest")
        {
            220
        } else {
            self.milestone.load(Ordering::Relaxed)
        };
        let milestone = self
            .milestone
            .fetch_max(candidate, Ordering::Relaxed)
            .max(candidate);
        milestone as f64 / 1_000.0
    }

    fn overall(&self, start: f64, end: f64) -> f64 {
        start + (end - start) * (self.milestone.load(Ordering::Relaxed) as f64 / 1_000.0)
    }
}

/// Keep npm's verbose stream available for inactivity detection without
/// forwarding internal chatter or credentials into the primary setup console.
fn npm_log_line_for_display(line: &str) -> Option<String> {
    if npm_log_line_is_noisy(line) {
        return None;
    }
    npm_log_line_redacted(line)
}

/// Redact credentials/registry URLs from a retained npm diagnostic line.
/// Per-request HTTP lines stay only in the raw process artifact; the UI uses
/// a coalesced network summary instead.
fn npm_log_line_redacted(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }

    let lowercase = line.to_ascii_lowercase();
    if NPM_SECRET_MARKERS
        .iter()
        .any(|marker| lowercase.contains(marker))
    {
        return Some("[authentication details redacted]".into());
    }

    let redacted = line
        .split_whitespace()
        .map(|token| {
            let contains_url_credentials = token
                .find("://")
                .and_then(|scheme_end| token[scheme_end + 3..].find('@'))
                .is_some();
            if contains_url_credentials {
                "[registry URL redacted]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    const MAX_DISPLAY_CHARS: usize = 1_000;
    if redacted.chars().count() <= MAX_DISPLAY_CHARS {
        Some(redacted)
    } else {
        Some(
            redacted
                .chars()
                .take(MAX_DISPLAY_CHARS)
                .chain(std::iter::once('…'))
                .collect(),
        )
    }
}

fn npm_fetch_duration_ms(line: &str) -> Option<u64> {
    if !line.to_ascii_lowercase().contains("npm http fetch") {
        return None;
    }
    line.split_whitespace().rev().find_map(|token| {
        token
            .strip_suffix("ms")
            .and_then(|value| value.parse::<u64>().ok())
    })
}

#[derive(Default)]
struct NpmFetchMetrics {
    requests: u64,
    cache_hits: u64,
    cache_misses: u64,
    total_duration_ms: u128,
    slowest_duration_ms: u64,
    slow_requests: u64,
}

type SharedNpmFetchMetrics = Arc<Mutex<NpmFetchMetrics>>;

fn observe_npm_fetch(
    line: &str,
    source_label: &str,
    slow_fetch_tx: &tokio::sync::watch::Sender<Option<String>>,
    slow_fetch_triggered: &AtomicBool,
    metrics: &SharedNpmFetchMetrics,
) -> Option<u64> {
    let Some(duration_ms) = npm_fetch_duration_ms(line) else {
        return None;
    };
    let request_count = {
        let lowercase = line.to_ascii_lowercase();
        let mut metrics = metrics
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        metrics.requests += 1;
        metrics.total_duration_ms += duration_ms as u128;
        metrics.slowest_duration_ms = metrics.slowest_duration_ms.max(duration_ms);
        if lowercase.contains("cache hit") {
            metrics.cache_hits += 1;
        } else if lowercase.contains("cache miss") {
            metrics.cache_misses += 1;
        }
        if duration_ms >= NPM_SLOW_FETCH_THRESHOLD.as_millis() as u64 {
            metrics.slow_requests += 1;
        }
        metrics.requests
    };
    if duration_ms < NPM_SLOW_FETCH_THRESHOLD.as_millis() as u64
        || slow_fetch_triggered.swap(true, Ordering::AcqRel)
    {
        return Some(request_count);
    }
    let reason = format!(
        "{} npm tarball request took {}ms (slow-source threshold: {}s)",
        source_label,
        duration_ms,
        NPM_SLOW_FETCH_THRESHOLD.as_secs()
    );
    let _ = slow_fetch_tx.send(Some(reason));
    Some(request_count)
}

fn npm_fetch_summary(source_label: &str, metrics: &SharedNpmFetchMetrics) -> Option<String> {
    let metrics = metrics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if metrics.requests == 0 {
        return None;
    }
    let average_ms = metrics.total_duration_ms / metrics.requests as u128;
    Some(format!(
        "npm network summary for {source_label}: requests={}, cache hits={}, cache misses={}, average={}ms, slowest={}ms, requests >= {}s={}",
        metrics.requests,
        metrics.cache_hits,
        metrics.cache_misses,
        average_ms,
        metrics.slowest_duration_ms,
        NPM_SLOW_FETCH_THRESHOLD.as_secs(),
        metrics.slow_requests,
    ))
}

fn emit_npm_fetch_summary(
    app: &tauri::AppHandle,
    step: &str,
    source_label: &str,
    metrics: &SharedNpmFetchMetrics,
    progress: f64,
) {
    if let Some(summary) = npm_fetch_summary(source_label, metrics) {
        emit_diagnostic(app, step, &summary, progress);
    }
}

type NpmDiagnostics = Arc<Mutex<Vec<String>>>;

fn record_npm_diagnostic(diagnostics: &NpmDiagnostics, line: &str) {
    let mut lines = diagnostics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if lines.last().is_some_and(|last| last == line) {
        return;
    }
    if lines.len() == NPM_DIAGNOSTIC_LINE_LIMIT {
        lines.remove(0);
    }
    lines.push(line.to_owned());
}

fn npm_diagnostic_text(diagnostics: &NpmDiagnostics) -> String {
    diagnostics
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .join(" | ")
}

enum NpmWaitResult {
    Exited(std::io::Result<std::process::ExitStatus>),
    Inactive,
    DeadlineExceeded,
    SlowSource(String),
}

struct NpmOutputTasks {
    stdout: Option<tokio::task::JoinHandle<Result<(), String>>>,
    stderr: Option<tokio::task::JoinHandle<Result<(), String>>>,
}

impl NpmOutputTasks {
    async fn finish(self) -> Result<(), String> {
        let stdout = finish_npm_output_task("stdout", self.stdout).await;
        let stderr = finish_npm_output_task("stderr", self.stderr).await;
        match (stdout, stderr) {
            (Ok(()), Ok(())) => Ok(()),
            (Err(error), Ok(())) | (Ok(()), Err(error)) => Err(error),
            (Err(stdout_error), Err(stderr_error)) => {
                Err(format!("{stdout_error}; {stderr_error}"))
            }
        }
    }
}

async fn finish_npm_output_task(
    stream: &str,
    task: Option<tokio::task::JoinHandle<Result<(), String>>>,
) -> Result<(), String> {
    let Some(mut task) = task else {
        return Ok(());
    };
    match tokio::time::timeout(PROCESS_REAP_TIMEOUT, &mut task).await {
        Ok(Ok(Ok(()))) => Ok(()),
        Ok(Ok(Err(error))) => Err(format!("Failed to read npm {stream}: {error}")),
        Ok(Err(error)) => Err(format!("npm {stream} reader task failed: {error}")),
        Err(_) => {
            task.abort();
            Err(format!(
                "npm {stream} did not close within {} seconds after its process stopped",
                PROCESS_REAP_TIMEOUT.as_secs()
            ))
        }
    }
}

async fn stop_npm_process(
    child: &mut tokio::process::Child,
    pid: Option<u32>,
    output: NpmOutputTasks,
) -> Result<(), String> {
    let process = terminate_process_tree_confirmed(child, pid).await;
    let output = output.finish().await;
    match (process, output) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(process_error), Ok(())) => Err(process_error),
        (Ok(()), Err(output_error)) => Err(output_error),
        (Err(process_error), Err(output_error)) => Err(format!("{process_error}; {output_error}")),
    }
}

#[cfg(test)]
async fn wait_for_process_activity(
    child: &mut tokio::process::Child,
    activity: &mut tokio::sync::watch::Receiver<u64>,
    inactivity_timeout: std::time::Duration,
    deadline: std::time::Instant,
) -> NpmWaitResult {
    let (_slow_fetch_tx, mut slow_fetch_rx) = tokio::sync::watch::channel(None);
    wait_for_process_activity_with_slow_signal(
        child,
        activity,
        &mut slow_fetch_rx,
        inactivity_timeout,
        deadline,
    )
    .await
}

async fn wait_for_process_activity_with_slow_signal(
    child: &mut tokio::process::Child,
    activity: &mut tokio::sync::watch::Receiver<u64>,
    slow_fetch: &mut tokio::sync::watch::Receiver<Option<String>>,
    inactivity_timeout: std::time::Duration,
    deadline: std::time::Instant,
) -> NpmWaitResult {
    let wait = child.wait();
    tokio::pin!(wait);
    let deadline_wait = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline));
    tokio::pin!(deadline_wait);
    loop {
        // This timer is intentionally recreated after activity. The deadline
        // timer above is not: output can reset the inactivity watchdog, but it
        // must never extend the installation transaction's absolute budget.
        let inactivity_wait = tokio::time::sleep(inactivity_timeout);
        tokio::pin!(inactivity_wait);
        tokio::select! {
            status = &mut wait => return NpmWaitResult::Exited(status),
            _ = &mut deadline_wait => return NpmWaitResult::DeadlineExceeded,
            changed = slow_fetch.changed() => {
                if changed.is_ok() {
                    if let Some(reason) = slow_fetch.borrow().clone() {
                        return NpmWaitResult::SlowSource(reason);
                    }
                }
            }
            changed = activity.changed() => {
                if changed.is_err() {
                    return NpmWaitResult::Exited(wait.await);
                }
            }
            _ = &mut inactivity_wait => return NpmWaitResult::Inactive,
        }
    }
}

/// Run `npm install -g <pinned-package>` against a user-writable global prefix
/// with live output streaming. The release contract is resolved once before
/// this function, so its registry order, version and Node.js requirement stay
/// aligned throughout a single installation attempt.
///
/// We deliberately use `-g` plus an `npm_config_prefix` env var rather than
/// `npm install --prefix <dir>`: `--prefix` is the project-local install
/// flag and produces non-standard bin layouts that diverge from a normal
/// global install. `-g` gives us the real global layout
/// (`<prefix>/bin/openclaw`, `<prefix>/lib/node_modules/openclaw/...`) and
/// respects whatever the user already has on `PATH` via `detect_openclaw`.
struct NpmInstallRequest<'a> {
    app: &'a tauri::AppHandle,
    step: &'a str,
    npm: &'a crate::commands::system::NpmExecutionContext,
    global_prefix: &'a std::path::Path,
    target: &'a npm_registry::OpenclawReleaseTarget,
    force: bool,
    progress: std::ops::Range<f64>,
}

async fn npm_install_with_fallback(request: NpmInstallRequest<'_>) -> Result<(), String> {
    let NpmInstallRequest {
        app,
        step,
        npm,
        global_prefix,
        target,
        force,
        progress,
    } = request;
    let prog_start = progress.start;
    let prog_end = progress.end;
    let deadline = std::time::Instant::now() + DEPENDENCY_INSTALL_DEADLINE;
    let install_nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    std::fs::create_dir_all(global_prefix).ok();
    let package_spec = target.package_spec();
    let sources = target.sources().to_vec();
    let mut last_err = String::new();
    let total_regs = sources.len();
    let registry_order = sources
        .iter()
        .map(npm_registry::NpmPackageSource::install_log_label)
        .collect::<Vec<_>>()
        .join(" -> ");
    let cache_directory = paths::configured_npm_cache_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "npm default cache".to_string());
    emit_diagnostic(
        app,
        step,
        &format!(
            "npm install context: platform={}/{}, node={}, npm-cli={}, prefix={}, cache={}, force={}",
            std::env::consts::OS,
            std::env::consts::ARCH,
            npm.node().display(),
            npm.npm_cli().display(),
            global_prefix.display(),
            cache_directory,
            force,
        ),
        prog_start,
    );
    emit_diagnostic(
        app,
        step,
        &format!(
            "npm network policy: fetch-retries=2, fetch-timeout=120000ms, slow-source-threshold={}s, inactivity-timeout={}s, transaction-deadline={}s",
            NPM_SLOW_FETCH_THRESHOLD.as_secs(),
            NPM_INACTIVITY_TIMEOUT.as_secs(),
            DEPENDENCY_INSTALL_DEADLINE.as_secs(),
        ),
        prog_start,
    );
    emit(
        app,
        step,
        &format!(
            "npm registry order for this installation: {}; OpenClaw target = {}",
            registry_order,
            target.version(),
        ),
        prog_start,
    );
    emit(
        app,
        step,
        &format!(
            "npm cache for this installation: {}; registry selection is transaction-scoped and does not overwrite the user's npm configuration",
            cache_directory,
        ),
        prog_start,
    );
    emit(
        app,
        step,
        &format!("npm source diagnostics: {}", target.source_diagnostic()),
        prog_start,
    );

    for (reg_idx, source) in sources.into_iter().enumerate() {
        if deadline
            .checked_duration_since(std::time::Instant::now())
            .is_none()
        {
            return Err(format!(
                "npm 安装 {} 超过 30 分钟总时限；未再启动备用源",
                package_spec
            ));
        }
        let staging_prefix = global_prefix.join(format!(
            ".junqi-openclaw-stage-{}-{}-{}",
            std::process::id(),
            install_nonce,
            reg_idx + 1
        ));
        let _staging_cleanup = TemporaryDirectory(staging_prefix.clone());
        let install_prefix = staging_prefix.as_path();
        let npm_prefix_str = install_prefix.to_string_lossy().to_string();
        std::fs::create_dir_all(&staging_prefix).map_err(|error| {
            format!(
                "Cannot prepare the isolated OpenClaw installer at {}: {}",
                staging_prefix.display(),
                error
            )
        })?;
        let reg_label = source.install_log_label();
        let attempt_started = std::time::Instant::now();
        emit(
            app,
            step,
            &format!(
                "【安装 {}/{}】使用 {} 安装 {}...",
                reg_idx + 1,
                total_regs,
                reg_label,
                package_spec
            ),
            prog_start,
        );

        let mut cmd = npm.command();

        cmd.args([
            "install",
            "-g",
            "--prefer-online",
            "--loglevel=http",
            "--foreground-scripts",
            "--fetch-retries=2",
            "--fetch-retry-mintimeout=1000",
            "--fetch-retry-maxtimeout=10000",
            "--fetch-timeout=120000",
            "--no-fund",
            "--no-audit",
        ]);
        if force {
            // An explicit reinstall must not be short-circuited by npm's
            // existing-package metadata. Keep the current payload in place
            // until npm has successfully replaced it.
            cmd.arg("--force");
        }
        cmd.arg(&package_spec)
            .env("npm_config_prefix", &npm_prefix_str)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        source.apply_to_command(&mut cmd);
        crate::commands::system::apply_configured_npm_cache(&mut cmd);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("Failed to spawn npm: {}", e);
                continue;
            }
        };
        let child_pid = child.id();
        let process_label = format!("npm-attempt-{}", reg_idx + 1);
        record_process_started(
            app,
            step,
            &process_label,
            child_pid,
            &format!("npm install via {reg_label}"),
        );
        let (activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);
        let (slow_fetch_tx, mut slow_fetch_rx) = tokio::sync::watch::channel(None::<String>);
        let slow_fetch_triggered = Arc::new(AtomicBool::new(false));
        let fetch_metrics = Arc::new(Mutex::new(NpmFetchMetrics::default()));
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let npm_progress = Arc::new(NpmStreamProgress::default());
        let npm_network_log_slot = format!("npm-network-attempt-{}", reg_idx + 1);

        // Stream stdout to progress events so the user sees live npm output
        let stdout_task = child.stdout.take().map(|stdout| {
            let app_c = app.clone();
            let step_c = step.to_string();
            let activity_tx = activity_tx.clone();
            let slow_fetch_tx = slow_fetch_tx.clone();
            let slow_fetch_triggered = Arc::clone(&slow_fetch_triggered);
            let fetch_metrics = Arc::clone(&fetch_metrics);
            let source_label = reg_label.clone();
            let diagnostics = Arc::clone(&diagnostics);
            let process_label = process_label.clone();
            let npm_progress = Arc::clone(&npm_progress);
            let npm_network_log_slot = npm_network_log_slot.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stdout).lines();
                while let Some(line) = lines
                    .next_line()
                    .await
                    .map_err(|error| format!("Failed to read npm stdout: {error}"))?
                {
                    record_process_output(&app_c, &step_c, &process_label, "stdout", &line);
                    activity_tx.send_modify(|sequence| *sequence += 1);
                    let progress =
                        prog_start + (prog_end - prog_start) * npm_progress.observe(&line);
                    let fetch_request_count = observe_npm_fetch(
                        &line,
                        &source_label,
                        &slow_fetch_tx,
                        &slow_fetch_triggered,
                        &fetch_metrics,
                    );
                    if npm_log_line_is_http_fetch(&line) {
                        if fetch_request_count.is_some_and(|count| count == 1 || count % 25 == 0) {
                            if let Some(summary) = npm_fetch_summary(&source_label, &fetch_metrics)
                            {
                                emit_coalesced(
                                    &app_c,
                                    &step_c,
                                    &summary,
                                    &npm_network_log_slot,
                                    progress,
                                );
                            }
                        }
                        continue;
                    }
                    match npm_log_line_for_display(&line) {
                        Some(display_line) => {
                            record_npm_diagnostic(&diagnostics, &display_line);
                            emit(
                                &app_c,
                                &step_c,
                                &format!("npm › {}", display_line),
                                progress,
                            );
                        }
                        // Noisy lines (npm verbose/sill/timing/notice) are dropped from
                        // the primary progress stream, but a raw diagnostic console
                        // still needs them to show a slow-but-alive install is doing
                        // something, not just silently stuck.
                        None => {
                            if let Some(raw_line) = npm_log_line_redacted(&line) {
                                emit_diagnostic(
                                    &app_c,
                                    &step_c,
                                    &format!("npm » {}", raw_line),
                                    progress,
                                );
                            }
                        }
                    }
                }
                Ok(())
            })
        });
        let tar_warning_count = Arc::new(AtomicUsize::new(0));
        let stderr_task = child.stderr.take().map(|stderr| {
            let app_e = app.clone();
            let step_e = step.to_string();
            let tar_warning_count_e = Arc::clone(&tar_warning_count);
            let activity_tx = activity_tx.clone();
            let slow_fetch_tx = slow_fetch_tx.clone();
            let slow_fetch_triggered = Arc::clone(&slow_fetch_triggered);
            let fetch_metrics = Arc::clone(&fetch_metrics);
            let source_label = reg_label.clone();
            let diagnostics = Arc::clone(&diagnostics);
            let process_label = process_label.clone();
            let npm_progress = Arc::clone(&npm_progress);
            let npm_network_log_slot = npm_network_log_slot.clone();
            tokio::spawn(async move {
                use tokio::io::{AsyncBufReadExt, BufReader};
                let mut lines = BufReader::new(stderr).lines();
                while let Some(line) = lines
                    .next_line()
                    .await
                    .map_err(|error| format!("Failed to read npm stderr: {error}"))?
                {
                    record_process_output(&app_e, &step_e, &process_label, "stderr", &line);
                    activity_tx.send_modify(|sequence| *sequence += 1);
                    let progress =
                        prog_start + (prog_end - prog_start) * npm_progress.observe(&line);
                    let fetch_request_count = observe_npm_fetch(
                        &line,
                        &source_label,
                        &slow_fetch_tx,
                        &slow_fetch_triggered,
                        &fetch_metrics,
                    );
                    if npm_log_line_is_http_fetch(&line) {
                        if fetch_request_count.is_some_and(|count| count == 1 || count % 25 == 0) {
                            if let Some(summary) = npm_fetch_summary(&source_label, &fetch_metrics)
                            {
                                emit_coalesced(
                                    &app_e,
                                    &step_e,
                                    &summary,
                                    &npm_network_log_slot,
                                    progress,
                                );
                            }
                        }
                        continue;
                    }
                    match npm_log_line_for_display(&line) {
                        Some(display_line) => {
                            if display_line.contains("TAR_ENTRY_ERROR")
                                && display_line.contains("ENOENT")
                            {
                                let seen = tar_warning_count_e.fetch_add(1, Ordering::Relaxed);
                                // Preserve the first diagnostic but avoid flooding the
                                // setup UI with hundreds of identical npm warnings.
                                if seen > 0 {
                                    continue;
                                }
                            }
                            record_npm_diagnostic(&diagnostics, &display_line);
                            emit(
                                &app_e,
                                &step_e,
                                &format!("npm › {}", display_line),
                                progress,
                            );
                        }
                        None => {
                            if let Some(raw_line) = npm_log_line_redacted(&line) {
                                emit_diagnostic(
                                    &app_e,
                                    &step_e,
                                    &format!("npm » {}", raw_line),
                                    progress,
                                );
                            }
                        }
                    }
                }
                Ok(())
            })
        });
        let (heartbeat_tx, mut heartbeat_rx) = tokio::sync::watch::channel(false);
        let heartbeat_app = app.clone();
        let heartbeat_step = step.to_string();
        let heartbeat_label = reg_label.to_string();
        let heartbeat_progress = Arc::clone(&npm_progress);
        let heartbeat_task = tokio::spawn(async move {
            let started = std::time::Instant::now();
            loop {
                tokio::select! {
                    changed = heartbeat_rx.changed() => {
                        if changed.is_err() || *heartbeat_rx.borrow() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                        emit(
                            &heartbeat_app,
                            &heartbeat_step,
                            &format!(
                                "npm is still installing via {} (elapsed {}s); waiting for network, extraction, or lifecycle scripts...",
                                heartbeat_label,
                                started.elapsed().as_secs(),
                            ),
                            heartbeat_progress.overall(prog_start, prog_end),
                        );
                    }
                }
            }
        });
        let wait_result = wait_for_process_activity_with_slow_signal(
            &mut child,
            &mut activity_rx,
            &mut slow_fetch_rx,
            NPM_INACTIVITY_TIMEOUT,
            deadline,
        )
        .await;
        let _ = heartbeat_tx.send(true);
        let _ = heartbeat_task.await;
        let output = NpmOutputTasks {
            stdout: stdout_task,
            stderr: stderr_task,
        };
        let prog_live = npm_progress.overall(prog_start, prog_end);
        let status = match wait_result {
            NpmWaitResult::Exited(Ok(status)) => {
                if let Err(error) = output.finish().await {
                    record_process_finished(
                        app,
                        step,
                        &process_label,
                        child_pid,
                        status.code().map(i64::from),
                        attempt_started.elapsed(),
                    );
                    return Err(format!(
                        "npm exited, but its output streams did not finish cleanly: {error}"
                    ));
                }
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    status.code().map(i64::from),
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(app, step, &reg_label, &fetch_metrics, prog_live);
                if std::time::Instant::now() >= deadline {
                    return Err("npm install exceeded the 30-minute dependency deadline".into());
                }
                status
            }
            NpmWaitResult::Exited(Err(e)) => {
                let diagnostic = npm_diagnostic_text(&diagnostics);
                last_err = if diagnostic.is_empty() {
                    format!("npm process error: {e}")
                } else {
                    format!("npm process error: {e}; {diagnostic}")
                };
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(app, step, &reg_label, &fetch_metrics, prog_live);
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
                if reg_idx + 1 < total_regs {
                    emit(
                        app,
                        step,
                        &format!(
                            "{} install errored, retrying with fallback source...",
                            reg_label
                        ),
                        prog_start,
                    );
                }
                continue;
            }
            NpmWaitResult::SlowSource(reason) => {
                let diagnostic = npm_diagnostic_text(&diagnostics);
                last_err = if diagnostic.is_empty() {
                    reason.clone()
                } else {
                    format!("{reason}; {diagnostic}")
                };
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(app, step, &reg_label, &fetch_metrics, prog_live);
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
                if reg_idx + 1 < total_regs {
                    emit(
                        app,
                        step,
                        &format!(
                            "{} detected a slow transfer; switching to the fallback source immediately...",
                            reg_label
                        ),
                        prog_start,
                    );
                }
                continue;
            }
            timeout @ (NpmWaitResult::Inactive | NpmWaitResult::DeadlineExceeded) => {
                let deadline_expired = matches!(timeout, NpmWaitResult::DeadlineExceeded)
                    || std::time::Instant::now() >= deadline;
                let diagnostic = npm_diagnostic_text(&diagnostics);
                let base_error = if deadline_expired {
                    "npm install exceeded the 30-minute dependency deadline"
                } else {
                    "npm install produced no child-process output for 10 minutes"
                };
                last_err = if diagnostic.is_empty() {
                    base_error.into()
                } else {
                    format!("{base_error}; {diagnostic}")
                };
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                emit_npm_fetch_summary(app, step, &reg_label, &fetch_metrics, prog_live);
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
                if deadline_expired {
                    return Err(last_err);
                }
                if reg_idx + 1 < total_regs {
                    emit(
                            app,
                            step,
                            &format!(
                                "{} install stopped after 10 minutes without child-process output; retrying with fallback source...",
                                reg_label
                            ),
                            prog_start,
                        );
                }
                continue;
            }
        };

        if status.success() {
            emit(
                app,
                step,
                &format!(
                    "{} npm process completed in {}s; validating the staged package...",
                    reg_label,
                    attempt_started.elapsed().as_secs()
                ),
                prog_live,
            );
            let tar_warnings = tar_warning_count.load(Ordering::Relaxed);
            if tar_warnings > 1 {
                emit(
                    app,
                    step,
                    &format!(
                        "npm reported {} duplicate extraction warnings; installation validation will confirm integrity",
                        tar_warnings
                    ),
                    prog_live,
                );
            }
            let finalization = if cfg!(windows) {
                validate_staged_openclaw_install(&staging_prefix)?;
                validate_staged_openclaw_package(
                    &staging_prefix,
                    target.version(),
                    &NodeRuntimeRequirement::parse(
                        target.node_requirement(),
                        NodeRequirementSource::RegistryPackage,
                    )?,
                    npm.node(),
                )
                .await?;
                promote_staged_openclaw_install(&staging_prefix, global_prefix).await?
            } else {
                validate_staged_unix_openclaw_install(&staging_prefix)?;
                validate_staged_openclaw_package(
                    &staging_prefix,
                    target.version(),
                    &NodeRuntimeRequirement::parse(
                        target.node_requirement(),
                        NodeRequirementSource::RegistryPackage,
                    )?,
                    npm.node(),
                )
                .await?;
                promote_staged_unix_openclaw_install(&staging_prefix, global_prefix)?
            };
            if let PromotionFinalization::CleanupDeferred(warning) = finalization {
                emit(app, step, &warning, prog_live);
            }
            emit(
                app,
                step,
                &format!("{} installed (via {}) ✓", package_spec, reg_label),
                prog_end,
            );
            return Ok(());
        }

        if deadline
            .checked_duration_since(std::time::Instant::now())
            .is_none()
        {
            return Err(format!(
                "npm 安装 {} 超过 30 分钟总时限；最后错误：{}",
                package_spec, last_err
            ));
        }

        let diagnostic = npm_diagnostic_text(&diagnostics);
        last_err = if diagnostic.is_empty() {
            format!("npm 退出码 {}", status.code().unwrap_or(-1))
        } else {
            format!("npm 退出码 {}: {}", status.code().unwrap_or(-1), diagnostic)
        };
        emit(
            app,
            step,
            &format!(
                "{} npm process exited after {}s: {}",
                reg_label,
                attempt_started.elapsed().as_secs(),
                last_err
            ),
            prog_start,
        );
        if reg_idx + 1 < total_regs {
            emit(
                app,
                step,
                &format!(
                    "{} install failed ({}), retrying with fallback source...",
                    reg_label, last_err
                ),
                prog_start,
            );
        }
    }

    Err(format!(
        "All npm registries failed. Last error: {}",
        last_err
    ))
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[cfg_attr(not(windows), allow(dead_code))]
async fn fetch_node_distribution_index(
    client: &reqwest::Client,
    url: &str,
) -> Option<Vec<NodeDistributionRelease>> {
    client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<Vec<NodeDistributionRelease>>()
        .await
        .ok()
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_managed_node_version(
    requirement: &NodeRuntimeRequirement,
    platform: ManagedNodePlatform,
) -> Result<String, String> {
    let artifact = platform.distribution_artifact();
    resolve_managed_node_version_for_artifact(requirement, &artifact).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_managed_node_version_for_artifact(
    requirement: &NodeRuntimeRequirement,
    artifact: &str,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(RUNTIME_NETWORK_TIMEOUT)
        .user_agent("JunQi Desktop Node.js release resolver")
        .build()
        .map_err(|error| format!("Failed to initialize Node.js resolver: {error}"))?;
    // Mirrors retain a short head start, but all sources are in flight before
    // a slow or stale index can block the official distribution for minutes.
    // A successful but outdated index is not terminal: only an index that
    // actually contains a compatible artifact wins the race.
    let mut requests = tokio::task::JoinSet::new();
    for (index, source) in node_index_sources().into_iter().enumerate() {
        let client = client.clone();
        requests.spawn(async move {
            let stagger = NODE_INDEX_STAGGER.saturating_mul(index as u32);
            if !stagger.is_zero() {
                tokio::time::sleep(stagger).await;
            }
            fetch_node_distribution_index(&client, &source).await
        });
    }
    let mut any_index_available = false;
    while let Some(result) = requests.join_next().await {
        if let Ok(Some(releases)) = result {
            any_index_available = true;
            if let Some(version) = select_preferred_release(requirement, &releases, artifact) {
                requests.abort_all();
                return Ok(version);
            }
        }
    }
    if !any_index_available {
        return Err(
            "All configured Node.js release indexes, including the official fallback, are unavailable"
                .into(),
        );
    }
    Err(format!(
        "No published Node.js release for artifact {artifact} satisfies OpenClaw requirement {}",
        requirement.expression()
    ))
}

fn parse_shasums(text: &str, filename: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let digest = fields.next()?;
        let listed = fields.next()?.trim_start_matches('*');
        (listed == filename
            && digest.len() == 64
            && digest.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| digest.to_ascii_lowercase())
    })
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_node_sha256(
    version: &str,
    platform: ManagedNodePlatform,
) -> Result<String, String> {
    let filename = platform.archive_filename(version);
    resolve_node_sha256_for_filename(version, &filename).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
async fn resolve_node_sha256_for_filename(version: &str, filename: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(RUNTIME_NETWORK_TIMEOUT)
        .timeout(RUNTIME_NETWORK_TIMEOUT)
        .user_agent("JunQi Desktop Node.js checksum resolver")
        .build()
        .map_err(|error| format!("Failed to initialize checksum resolver: {error}"))?;
    let mut requests = tokio::task::JoinSet::new();
    for source in node_checksum_sources(version) {
        let client = client.clone();
        let filename = filename.to_owned();
        requests.spawn(async move {
            let response = client
                .get(source.url)
                .send()
                .await
                .ok()?
                .error_for_status()
                .ok()?;
            let text = response.text().await.ok()?;
            parse_shasums(&text, &filename).map(|digest| (digest, source.label, source.is_official))
        });
    }
    let mut matches = std::collections::HashMap::<String, Vec<&'static str>>::new();
    let mut official_digest = None;
    while let Some(result) = requests.join_next().await {
        if let Ok(Some((digest, label, is_official))) = result {
            if is_official {
                official_digest = Some(digest.clone());
            }
            let providers = matches.entry(digest.clone()).or_default();
            providers.push(label);
            if providers.len() >= 2 {
                requests.abort_all();
                return Ok(digest);
            }
        }
    }
    // `nodejs.org` is the release authority. Mainland mirrors normally give
    // us independent corroboration, but requiring one to be reachable makes a
    // portable or macOS installation impossible on many non-mainland
    // networks. Accept the official manifest only after every mirror request
    // has been exhausted; artifacts remain SHA-256 checked against it.
    if let Some(digest) = official_digest {
        return Ok(digest);
    }
    Err(format!(
        "Unable to confirm the Node.js checksum for {filename} through independent sources or the official Node.js distribution"
    ))
}

struct OpenclawInstallTarget {
    release: npm_registry::OpenclawReleaseTarget,
    node_requirement: NodeRuntimeRequirement,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum OpenclawInstallTargetResolution {
    Latest,
    PinnedRelocation(paths::OpenclawRelocationContract),
}

impl OpenclawInstallTargetResolution {
    fn for_install(
        mode: OpenclawInstallMode,
        relocation: Option<&OpenclawRelocationRequest>,
    ) -> Self {
        if matches!(mode, OpenclawInstallMode::Relocate) {
            if let Some(contract) = relocation.and_then(OpenclawRelocationRequest::package_contract)
            {
                return Self::PinnedRelocation(contract.clone());
            }
        }
        Self::Latest
    }
}

async fn target_openclaw_install_target(
    node: &Path,
    resolution: OpenclawInstallTargetResolution,
) -> Result<OpenclawInstallTarget, String> {
    let release = match resolution {
        OpenclawInstallTargetResolution::Latest => {
            npm_registry::resolve_latest_openclaw_release_target(node).await?
        }
        OpenclawInstallTargetResolution::PinnedRelocation(contract) => {
            let release =
                npm_registry::resolve_openclaw_release_target(node, contract.version()).await?;
            if release.node_requirement() != contract.node_requirement() {
                return Err(format!(
                    "OpenClaw {} no longer matches the Node.js contract captured before relocation (expected {}, registry reported {}). Complete relocation with a registry that serves the original package contract, or finish the move and update OpenClaw explicitly afterwards.",
                    contract.version(),
                    contract.node_requirement(),
                    release.node_requirement(),
                ));
            }
            release
        }
    };
    let node_requirement = NodeRuntimeRequirement::parse(
        release.node_requirement(),
        NodeRequirementSource::RegistryPackage,
    )?;
    Ok(OpenclawInstallTarget {
        release,
        node_requirement,
    })
}

pub(crate) async fn target_openclaw_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    let fallback = NodeRuntimeRequirement::fallback();
    let runtime = crate::commands::system::NodeRuntimeContract::resolve(&fallback).await?;
    let node = runtime.node();
    if !node.available || !runtime.npm().available {
        return Ok(fallback);
    }
    let Some(path) = node.path.as_deref().map(Path::new) else {
        return Ok(fallback);
    };
    Ok(
        target_openclaw_install_target(path, OpenclawInstallTargetResolution::Latest)
            .await?
            .node_requirement,
    )
}

/// Setup has two runtime contracts: an existing local OpenClaw package is
/// authoritative for a reuse path, while a machine without OpenClaw must
/// resolve the exact target package before installing anything. Keeping this
/// distinction prevents an offline registry from blocking a healthy existing
/// installation and prevents a fresh installation from using a broad fallback.
async fn setup_node_requirement() -> Result<NodeRuntimeRequirement, String> {
    if let Some(binary) = crate::commands::system::resolve_openclaw_binary_async().await {
        match crate::commands::system::required_node_requirement_for_openclaw_binary(&binary) {
            Ok(requirement) => return Ok(requirement),
            Err(local_error) => {
                return target_openclaw_node_requirement().await.map_err(|target_error| {
                    format!(
                        "The installed OpenClaw runtime contract is damaged ({local_error}); the repair target could not be resolved: {target_error}"
                    )
                });
            }
        }
    }
    target_openclaw_node_requirement().await
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupNodeStatus {
    pub node: crate::commands::system::NodeStatus,
    pub npm: crate::commands::system::NpmStatus,
    pub requirement: Option<String>,
    pub requirement_error: Option<String>,
}

impl SetupNodeStatus {
    fn verified(
        runtime: crate::commands::system::NodeRuntimeContract,
        requirement: &NodeRuntimeRequirement,
    ) -> Self {
        let (node, npm) = runtime.into_statuses();
        Self {
            node,
            npm,
            requirement: Some(requirement.expression().to_string()),
            requirement_error: None,
        }
    }
}

/// Resolve the executable Node.js+npm pair required for package installation.
/// The system resolver already preserves an explicit user-selected Node.js
/// runtime as an exclusive candidate and otherwise chooses the first complete
/// system pair. Keeping the validation here as one contract prevents setup
/// from declaring a Node-only distribution ready.
async fn resolve_complete_node_runtime_contract(
    requirement: &NodeRuntimeRequirement,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    let runtime = crate::commands::system::NodeRuntimeContract::resolve(requirement).await?;
    if !runtime.node().available {
        return Err(format!(
            "No compatible Node.js runtime satisfies OpenClaw requirement {} (detected: {})",
            requirement.expression(),
            runtime.node().version.as_deref().unwrap_or("not found")
        ));
    }
    if !runtime.npm().available {
        return Err(format!(
            "Compatible Node.js {} at {} does not provide an executable bundled npm CLI: {}",
            runtime.node().version.as_deref().unwrap_or("unknown"),
            runtime.node().path.as_deref().unwrap_or("unknown location"),
            runtime
                .npm()
                .reason
                .as_deref()
                .unwrap_or("npm was unavailable")
        ));
    }
    Ok(runtime)
}

fn ready_node_runtime_message(runtime: &crate::commands::system::NodeRuntimeContract) -> String {
    format!(
        "Node.js {} with npm {} ready at {}",
        runtime.node().version.as_deref().unwrap_or("unknown"),
        runtime.npm().version.as_deref().unwrap_or("unknown"),
        runtime.node().path.as_deref().unwrap_or("unknown location")
    )
}

/// Windows package managers can exit before the MSI has published its PATH
/// and registry changes. Give the selected runtime a short, bounded settle
/// window before deciding that the channel failed or starting another
/// installer. This keeps one install transaction serialized without hiding a
/// genuinely incompatible package for more than a few seconds.
#[cfg(windows)]
async fn wait_for_node_runtime_settle(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, WindowsInstallerFailure> {
    let remaining = budget.remaining().unwrap_or_default();
    let deadline = std::time::Instant::now() + remaining.min(WINDOWS_RUNTIME_SETTLE_TIMEOUT);
    let mut last_error = None;

    loop {
        operation
            .ensure_active()
            .map_err(WindowsInstallerFailure::cancelled)?;
        platform::refresh_process_path_from_registry();
        match resolve_complete_node_runtime_contract(requirement).await {
            Ok(runtime) => return Ok(runtime),
            Err(error) => last_error = Some(error),
        }
        let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
            break;
        };
        let elapsed = WINDOWS_RUNTIME_SETTLE_TIMEOUT
            .saturating_sub(remaining)
            .as_secs();
        emit_keyed_with_params(
            app,
            "node",
            "Waiting for Windows to publish the installed Node.js runtime…",
            "setup.node.runtimeSettling",
            &[("elapsed", &elapsed.to_string())],
            0.94,
        );
        tokio::select! {
            _ = tokio::time::sleep(remaining.min(PROCESS_HEARTBEAT_INTERVAL)) => {}
            _ = operation.cancelled() => {
                return Err(WindowsInstallerFailure::cancelled(
                    DEPENDENCY_INSTALL_CANCELLED_MESSAGE,
                ));
            }
        }
    }

    Err(WindowsInstallerFailure::runtime_unavailable(format!(
        "Node.js runtime did not become usable after the installer completed: {}",
        last_error.unwrap_or_else(|| "the installed runtime was not visible".into())
    )))
}

#[cfg(windows)]
async fn wait_for_git_runtime_settle(
    app: &tauri::AppHandle,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::GitStatus, WindowsInstallerFailure> {
    let remaining = budget.remaining().unwrap_or_default();
    let deadline = std::time::Instant::now() + remaining.min(WINDOWS_RUNTIME_SETTLE_TIMEOUT);
    let mut last_error = None;

    loop {
        operation
            .ensure_active()
            .map_err(WindowsInstallerFailure::cancelled)?;
        platform::refresh_process_path_from_registry();
        match crate::commands::system::check_git().await {
            Ok(status) if status.available => return Ok(status),
            Ok(status) => {
                last_error = Some("git.exe was not detected after the installer completed".into());
                if let Some(version) = status.version {
                    last_error = Some(format!(
                        "detected Git {version}, but its executable contract was incomplete"
                    ));
                }
            }
            Err(error) => last_error = Some(error),
        }
        let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
            break;
        };
        let elapsed = WINDOWS_RUNTIME_SETTLE_TIMEOUT
            .saturating_sub(remaining)
            .as_secs();
        emit_keyed_with_params(
            app,
            "git",
            "Waiting for Windows to publish the installed Git runtime…",
            "setup.git.runtimeSettling",
            &[("elapsed", &elapsed.to_string())],
            0.94,
        );
        tokio::select! {
            _ = tokio::time::sleep(remaining.min(PROCESS_HEARTBEAT_INTERVAL)) => {}
            _ = operation.cancelled() => {
                return Err(WindowsInstallerFailure::cancelled(
                    DEPENDENCY_INSTALL_CANCELLED_MESSAGE,
                ));
            }
        }
    }

    Err(WindowsInstallerFailure::runtime_unavailable(format!(
        "Git runtime did not become usable after the installer completed: {}",
        last_error.unwrap_or_else(|| "git.exe was not visible on the refreshed PATH".into())
    )))
}

/// Check the current Node.js runtime against the active setup contract: the
/// installed package when one exists, otherwise the exact target release.
#[tauri::command]
pub async fn check_setup_node() -> Result<SetupNodeStatus, String> {
    paths::validate_runtime_overrides()?;
    let (runtime, requirement, requirement_error) = match setup_node_requirement().await {
        Ok(requirement) => {
            let runtime =
                crate::commands::system::NodeRuntimeContract::resolve(&requirement).await?;
            (runtime, Some(requirement.expression().to_string()), None)
        }
        Err(error) => {
            // Before OpenClaw is installed, its engines.node contract lives in
            // registry metadata. A temporary registry outage must not turn a
            // local Node/npm inspection into a setup-wide failure. Report the
            // executable pair now; the exact requirement is resolved again at
            // the package-install boundary before anything is written.
            let fallback = NodeRuntimeRequirement::fallback();
            let runtime = crate::commands::system::NodeRuntimeContract::resolve(&fallback).await?;
            (runtime, None, Some(error))
        }
    };
    let (node, npm) = runtime.into_statuses();
    Ok(SetupNodeStatus {
        node,
        npm,
        requirement,
        requirement_error,
    })
}

/// Repair a Node.js distribution that is present but cannot execute its own
/// bundled npm. The normal installer remains responsible for ownership:
/// explicit portable directories must be JunQi-managed, while a user-requested
/// system repair installs an additional official system runtime instead of
/// mutating arbitrary PATH entries such as version-manager shims.
#[tauri::command]
pub async fn repair_setup_node_runtime(
    app: tauri::AppHandle,
    operation_id: Option<String>,
) -> Result<SetupNodeStatus, String> {
    let operation =
        DependencyInstallOperation::begin(&app, DependencyInstallTool::Node, operation_id)?;
    paths::validate_runtime_overrides()?;
    let requirement = setup_node_requirement_for_operation(&operation).await?;
    if let Ok(runtime) = resolve_complete_node_runtime_contract(&requirement).await {
        operation.ensure_active()?;
        return Ok(SetupNodeStatus::verified(runtime, &requirement));
    }
    let repaired =
        install_node_for_requirement_with_operation(app, requirement.clone(), false, &operation)
            .await?;
    operation.ensure_active()?;
    Ok(SetupNodeStatus::verified(repaired, &requirement))
}

#[tauri::command]
pub async fn install_node(
    app: tauri::AppHandle,
    force: Option<bool>,
    operation_id: Option<String>,
) -> Result<SetupNodeStatus, String> {
    let operation =
        DependencyInstallOperation::begin(&app, DependencyInstallTool::Node, operation_id)?;
    paths::validate_runtime_overrides()?;
    let requirement = setup_node_requirement_for_operation(&operation).await?;
    let runtime = install_node_for_requirement_with_operation(
        app,
        requirement.clone(),
        force.unwrap_or(false),
        &operation,
    )
    .await?;
    Ok(SetupNodeStatus::verified(runtime, &requirement))
}

pub(crate) async fn update_managed_node_runtime(app: tauri::AppHandle) -> Result<String, String> {
    paths::validate_runtime_overrides()?;
    let requirement = crate::commands::system::installed_openclaw_node_requirement().await?;
    #[cfg(windows)]
    let result = install_node_for_requirement(app, requirement, true, None).await;

    #[cfg(target_os = "macos")]
    let result = install_node_for_requirement(app, requirement, true, None).await;

    #[cfg(all(not(windows), not(target_os = "macos")))]
    let result = {
        if paths::configured_node_runtime_dir().is_some() {
            return install_node_for_requirement(app, requirement, true, None)
                .await
                .map(|runtime| ready_node_runtime_message(&runtime));
        }
        Err(
            "The active Node.js installation is managed by the operating system; update it with the system package manager"
                .into(),
        )
    };
    result.map(|runtime| ready_node_runtime_message(&runtime))
}

async fn install_node_for_requirement(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation_id: Option<String>,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    let operation =
        DependencyInstallOperation::begin(&app, DependencyInstallTool::Node, operation_id)?;
    install_node_for_requirement_with_operation(app, requirement, force, &operation).await
}

async fn setup_node_requirement_for_operation(
    operation: &DependencyInstallOperation,
) -> Result<NodeRuntimeRequirement, String> {
    operation.ensure_active()?;
    tokio::select! {
        result = setup_node_requirement() => {
            operation.ensure_active()?;
            result
        }
        _ = operation.cancelled() => Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into()),
    }
}

async fn install_node_for_requirement_with_operation(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    operation.ensure_active()?;
    // Windows system installers own elevated child processes. Their explicit
    // budget is enforced inside the controlled installer runner so an outer
    // future timeout cannot detach a still-running MSI/winget process.
    #[cfg(windows)]
    {
        if paths::configured_node_runtime_dir().is_some() {
            return tokio::time::timeout(
                DEPENDENCY_INSTALL_DEADLINE,
                install_node_for_requirement_inner(app, requirement, force, operation),
            )
            .await
            .map_err(|_| "Node.js 安装超过 30 分钟总时限，已停止本次安装".to_string())?;
        }
        return install_node_for_requirement_inner(app, requirement, force, operation).await;
    }

    #[cfg(not(windows))]
    {
        tokio::time::timeout(
            DEPENDENCY_INSTALL_DEADLINE,
            install_node_for_requirement_inner(app, requirement, force, operation),
        )
        .await
        .map_err(|_| "Node.js 安装超过 30 分钟总时限，已停止本次安装".to_string())?
    }
}

async fn install_node_for_requirement_inner(
    #[cfg_attr(all(not(windows), not(target_os = "macos")), allow(unused_variables))]
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    let _guard = wait_for_dependency_install_lock(
        NODE_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(())),
        operation,
    )
    .await?;
    operation.ensure_active()?;
    // Reset only after acquiring the per-tool lock so a queued retry cannot
    // erase the timeline of an installer that is still running.
    reset_timeline_log(&app, "node");

    #[cfg(windows)]
    let result = {
        match paths::configured_node_runtime_dir() {
            Some(target) => {
                install_portable_node_runtime(app, requirement, force, target, operation).await
            }
            None => install_windows_system_node(app, requirement, force, operation).await,
        }
    };

    #[cfg(target_os = "macos")]
    let result = {
        if let Some(target) = paths::configured_node_runtime_dir() {
            return install_portable_node_runtime(app, requirement, force, target, operation).await;
        }
        install_macos_system_node(app, requirement, force, operation).await
    };

    #[cfg(all(not(windows), not(target_os = "macos")))]
    let result = {
        if !force {
            if let Ok(detected) = resolve_complete_node_runtime_contract(&requirement).await {
                return Ok(detected);
            }
        }
        Err(format!(
            "Node.js {} is required. Install or update Node.js in its standard system location, then retry.",
            requirement.expression()
        ))
    };
    result
}

#[cfg(any(windows, target_os = "macos"))]
async fn install_portable_node_runtime(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    target: PathBuf,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    operation.ensure_active()?;
    let target_node = runtime_binary(&target, "node");
    if !force {
        if validate_node_runtime_pair(&target_node, &requirement)
            .await
            .is_ok()
        {
            operation.ensure_active()?;
            return resolve_complete_node_runtime_contract(&requirement).await;
        }
    }
    validate_runtime_target_for_activation(&target, "Node.js")?;

    let platform = ManagedNodePlatform::current()?;
    let version = resolve_managed_node_version(&requirement, platform).await?;
    operation.ensure_active()?;
    emit_keyed(
        &app,
        "node",
        &format!("Preparing to download Node.js v{version}, China mirror first..."),
        "setup.node.prepareDownload",
        0.05,
    );
    let sha256 = resolve_node_sha256(&version, platform).await?;
    operation.ensure_active()?;
    let temp_dir =
        std::env::temp_dir().join(format!("junqi-node-download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create Node.js temporary directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let archive = temp_dir.join(platform.archive_filename(&version));
    let sources = node_archive_sources(platform, &version);
    download_with_fallback(
        DownloadRequest {
            app: &app,
            step: "node",
            sources: &sources,
            destination: &archive,
            expected_sha256: &sha256,
            progress: 0.08..0.60,
        },
        operation,
    )
    .await?;

    let parent = target
        .parent()
        .ok_or("Selected Node.js runtime directory has no parent")?;
    let stage_container = parent.join(format!(".junqi-node-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&stage_container)
        .map_err(|error| format!("Failed to prepare Node.js staging directory: {error}"))?;
    let _staging_cleanup = TemporaryDirectory(stage_container.clone());
    operation.ensure_active()?;
    let staging = extract_node_archive(
        &app,
        &archive,
        &stage_container,
        &version,
        platform,
        operation,
    )
    .await?;
    let staged_node = runtime_binary(&staging, "node");
    let (detected, _) = validate_node_runtime_pair(&staged_node, &requirement).await?;
    operation.ensure_active()?;
    write_runtime_marker(&staging, "node")?;
    let mut activation = activate_staged_runtime(&staging, &target, "node")?;
    if let Err(error) = validate_node_runtime_pair(&target_node, &requirement).await {
        let failure =
            format!("Activated Node.js runtime failed its post-install contract check: {error}");
        return match activation.rollback() {
            Ok(recovery) => Err(recovery.map_or(failure.clone(), |path| {
                format!(
                    "{failure}; the unverified runtime was preserved for recovery at {}",
                    path.display()
                )
            })),
            Err(rollback_error) => Err(format!(
                "{failure}; runtime rollback also failed: {rollback_error}"
            )),
        };
    }
    if operation.cancellation_requested() {
        return Err(rollback_cancelled_runtime_activation(&mut activation));
    }
    if let ManagedRuntimeCommit::BackupCleanupDeferred(warning) = activation.commit() {
        emit(&app, "node", &warning, 0.98);
    }
    emit_keyed(
        &app,
        "node",
        &format!("Node.js {detected} installed in the selected directory"),
        "setup.node.done",
        1.0,
    );
    operation.ensure_active()?;
    resolve_complete_node_runtime_contract(&requirement).await
}

#[cfg(windows)]
async fn install_windows_system_node(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    operation.ensure_active()?;
    if !force {
        if let Ok(current) = resolve_complete_node_runtime_contract(&requirement).await {
            operation.ensure_active()?;
            return Ok(current);
        }
    }

    let budget = DependencyInstallBudget::new();
    let mirror_error =
        match install_windows_system_node_from_mirrors(&app, &requirement, budget, operation).await
        {
            Ok(installed) => return Ok(installed),
            Err(error) if error.permits_package_manager_fallback() => error.into_message(),
            Err(error) => return Err(error.into_message()),
        };
    emit(
        &app,
        "node",
        &format!(
            "Verified Node.js installer was not started; package-manager fallback is allowed: {mirror_error}"
        ),
        0.60,
    );
    emit_keyed(
        &app,
        "node",
        "The mainland mirror installer could not finish; trying Windows Package Manager...",
        "setup.node.systemPackageFallback",
        0.60,
    );
    operation.ensure_active()?;
    match install_windows_system_node_with_winget(&app, &requirement, budget, operation).await {
        Ok(installed) => Ok(installed),
        Err(error) if error.is_interrupted() => Err(error.into_message()),
        Err(error) => Err(format!(
            "Node.js installer from configured distribution sources failed: {mirror_error}\nWindows Package Manager fallback failed: {}",
            error.into_message()
        )),
    }
}

#[cfg(target_os = "macos")]
async fn install_macos_system_node(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    operation.ensure_active()?;
    if !force {
        if let Ok(current) = resolve_complete_node_runtime_contract(&requirement).await {
            operation.ensure_active()?;
            return Ok(current);
        }
    }

    let platform = ManagedNodePlatform::current()?;
    let version = resolve_managed_node_version(&requirement, platform).await?;
    operation.ensure_active()?;
    let filename = node_macos_installer_filename(&version);
    let sha256 = resolve_node_sha256_for_filename(&version, &filename).await?;
    operation.ensure_active()?;
    let sources = node_macos_installer_sources(&version);
    emit_keyed(
        &app,
        "node",
        &format!("Preparing the official Node.js v{version} macOS installer..."),
        "setup.node.systemInstall",
        0.08,
    );

    let temp_dir = std::env::temp_dir().join(format!(
        "junqi-node-macos-installer-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to prepare Node.js installer directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let installer = temp_dir.join(filename);
    download_with_fallback(
        DownloadRequest {
            app: &app,
            step: "node",
            sources: &sources,
            destination: &installer,
            expected_sha256: &sha256,
            progress: 0.10..0.68,
        },
        operation,
    )
    .await?;

    emit_keyed(
        &app,
        "node",
        "Opening the macOS Node.js installer. Complete the system dialog to continue...",
        "setup.node.macosInstaller",
        0.70,
    );
    let mut command = tokio::process::Command::new("/usr/bin/open");
    command.arg("-W").arg(&installer).kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to open the macOS Node.js installer: {error}"))?;

    let started = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(20 * 60);
    loop {
        if operation.cancellation_requested() {
            let _ = child.kill().await;
            return Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into());
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Failed to monitor the macOS installer: {error}"))?
        {
            if !status.success() {
                return Err(format!("The macOS Node.js installer closed with {status}"));
            }
            let installed = resolve_complete_node_runtime_contract(&requirement).await.map_err(
                |error| {
                    format!(
                        "The macOS Node.js installer completed, but Node.js/npm did not pass validation: {error}"
                    )
                },
            )?;
            operation.ensure_active()?;
            emit_keyed(
                &app,
                "node",
                "The macOS system Node.js runtime and npm are ready",
                "setup.node.systemReady",
                1.0,
            );
            return Ok(installed);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill().await;
            return Err("The macOS Node.js installer did not complete within 20 minutes".into());
        }

        let elapsed = format!(
            "{:02}:{:02}",
            started.elapsed().as_secs() / 60,
            started.elapsed().as_secs() % 60
        );
        emit_keyed(
            &app,
            "node",
            &format!("Waiting for the macOS installer (elapsed {elapsed})"),
            "setup.node.macPolling",
            0.74 + (started.elapsed().as_secs_f64() / timeout.as_secs_f64()).min(1.0) * 0.20,
        );
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(2)) => {}
            _ = operation.cancelled() => {
                let _ = child.kill().await;
                return Err(DEPENDENCY_INSTALL_CANCELLED_MESSAGE.into());
            }
        }
    }
}

#[cfg(windows)]
async fn install_windows_system_node_from_mirrors(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let platform = ManagedNodePlatform::current()?;
    let artifact = platform.installer_distribution_artifact().ok_or_else(|| {
        WindowsInstallerFailure::source_unavailable(
            "The current platform does not publish a Node.js MSI installer",
        )
    })?;
    let version = resolve_managed_node_version_for_artifact(requirement, &artifact).await?;
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let filename = platform.installer_filename(&version).ok_or_else(|| {
        WindowsInstallerFailure::source_unavailable(
            "The current platform does not publish a Node.js MSI installer",
        )
    })?;
    let sha256 = resolve_node_sha256_for_filename(&version, &filename).await?;
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let sources = node_installer_sources(platform, &version);
    if sources.is_empty() {
        return Err(WindowsInstallerFailure::source_unavailable(
            "No domestic Node.js MSI source is available for this platform",
        ));
    }

    emit_keyed(
        app,
        "node",
        "Installing Node.js to the official Windows default location...",
        "setup.node.systemInstall",
        0.10,
    );
    let temp_dir = std::env::temp_dir().join(format!(
        "junqi-node-system-installer-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to prepare Node.js installer directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let installer = temp_dir.join(&filename);
    download_with_fallback_with_budget(
        DownloadRequest {
            app,
            step: "node",
            sources: &sources,
            destination: &installer,
            expected_sha256: &sha256,
            progress: 0.12..0.62,
        },
        budget,
        operation,
    )
    .await
    .map_err(dependency_install_windows_failure)?;

    let msiexec = platform_path("msiexec.exe", "msiexec").ok_or_else(|| {
        WindowsInstallerFailure::source_unavailable("Windows Installer (msiexec) is unavailable")
    })?;
    let installer_log = temp_dir.join("node-msi.log");
    let args = WindowsMsiInvocation::quiet_install(&installer, &installer_log).arguments();
    let installer_result = run_windows_installer(
        &msiexec,
        &args,
        budget.process_policy("Node.js MSI installer")?,
        WindowsInstallProgress::new(app, "node", "Node.js", 0.64, 0.92),
        operation,
    )
    .await;
    // Preserve the verbose MSI log regardless of outcome: a slow-but-successful
    // install still needs its ACTION timestamps to find the real bottleneck.
    let preserved_log = match preserve_windows_installer_log(app, &installer_log, "node") {
        Ok(path) => path,
        Err(error) => {
            emit_diagnostic(app, "node", &error, 0.92);
            None
        }
    };
    if let Some(path) = &preserved_log {
        record_timeline_note(
            app,
            "node",
            &format!("msiexec verbose log preserved at {}", path.display()),
        );
    } else {
        emit_diagnostic(
            app,
            "node",
            "The Node.js MSI did not create a verbose log before it exited; the exact elevated invocation is recorded in this timeline.",
            0.92,
        );
    }
    let installer_result = installer_result.map_err(|error| match preserved_log {
        Some(path) => error.with_context(format!("installer log: {}", path.display())),
        None => error,
    });
    let installed =
        reconcile_windows_installer_runtime(app, "node", "Node.js", installer_result, || {
            wait_for_node_runtime_settle(app, requirement, budget, operation)
        })
        .await?;
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    emit_keyed(
        app,
        "node",
        "A compatible system Node.js runtime is ready",
        "setup.node.systemReady",
        1.0,
    );
    Ok(installed)
}

#[cfg(windows)]
async fn install_windows_system_node_with_winget(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, WindowsInstallerFailure> {
    ensure_winget_package(
        app,
        "node",
        "Node.js",
        WINGET_NODE_LTS_PACKAGE,
        budget,
        operation,
    )
    .await?;
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    platform::refresh_process_path_from_registry();
    let installed = match wait_for_node_runtime_settle(app, requirement, budget, operation).await {
        Ok(runtime) => runtime,
        Err(error) if error.permits_runtime_channel_fallback() => {
            emit_keyed(
                &app,
                "node",
                "The LTS channel does not satisfy OpenClaw; trying the current Node.js channel...",
                "setup.node.systemCurrentInstall",
                0.55,
            );
            ensure_winget_package(
                app,
                "node",
                "Node.js",
                WINGET_NODE_CURRENT_PACKAGE,
                budget,
                operation,
            )
            .await?;
            operation
                .ensure_active()
                .map_err(WindowsInstallerFailure::cancelled)?;
            platform::refresh_process_path_from_registry();
            wait_for_node_runtime_settle(app, requirement, budget, operation).await?
        }
        Err(error) => return Err(error),
    };
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    emit_keyed(
        &app,
        "node",
        "A compatible system Node.js runtime is ready",
        "setup.node.systemReady",
        1.0,
    );
    Ok(installed)
}

#[cfg(windows)]
fn platform_path(primary: &str, fallback: &str) -> Option<PathBuf> {
    let primary = platform::detect_path(primary);
    let path = if primary.is_empty() {
        platform::detect_path(fallback)
    } else {
        primary
    };
    (!path.is_empty()).then(|| PathBuf::from(path))
}

/// Structured MSI invocation keeps option tokens and path values separate
/// until the final ShellExecuteExW boundary. ShellExecuteExW accepts one
/// parameter string, so quoting every argument is tempting but makes the
/// native invocation diverge from Microsoft's documented `msiexec` form.
/// This type owns the canonical ordering and leaves switches unquoted.
#[cfg(any(windows, test))]
struct WindowsMsiInvocation {
    package: PathBuf,
    verbose_log: PathBuf,
}

#[cfg(any(windows, test))]
impl WindowsMsiInvocation {
    fn quiet_install(package: &Path, verbose_log: &Path) -> Self {
        Self {
            package: package.to_path_buf(),
            verbose_log: verbose_log.to_path_buf(),
        }
    }

    fn arguments(&self) -> Vec<std::ffi::OsString> {
        vec![
            std::ffi::OsString::from("/i"),
            self.package.clone().into_os_string(),
            std::ffi::OsString::from("/qn"),
            std::ffi::OsString::from("/norestart"),
            std::ffi::OsString::from("/L*V"),
            self.verbose_log.clone().into_os_string(),
        ]
    }
}

/// Quote a single Windows command-line value only when its contents require
/// it. This is the standard backslash-before-quote encoding used by Windows
/// process creation APIs and preserves path boundaries without quoting option
/// switches such as `/i` and `/qn`.
#[cfg(any(windows, test))]
fn quote_windows_command_line_value(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return value.to_string();
    }

    let mut quoted = String::with_capacity(value.len() + 2);
    quoted.push('"');
    let mut backslashes = 0_usize;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.extend(std::iter::repeat_n('\\', backslashes * 2 + 1));
        } else {
            quoted.extend(std::iter::repeat_n('\\', backslashes));
        }
        quoted.push(character);
        backslashes = 0;
    }
    quoted.extend(std::iter::repeat_n('\\', backslashes * 2));
    quoted.push('"');
    quoted
}

#[cfg(windows)]
fn windows_installer_command_line(args: &[std::ffi::OsString]) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;

    let values = args
        .iter()
        .map(|arg| {
            let units = arg.as_os_str().encode_wide().collect::<Vec<_>>();
            if units.contains(&0) {
                return Err("Windows installer argument contains a NUL character".to_string());
            }
            String::from_utf16(&units)
                .map_err(|_| "Windows installer argument is not valid UTF-16".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let command_line = values
        .iter()
        .map(|value| quote_windows_command_line_value(value))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(command_line
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect())
}

#[cfg(windows)]
fn windows_installer_display_command(
    executable: &Path,
    args: &[std::ffi::OsString],
) -> Result<String, WindowsInstallerFailure> {
    let parameters = windows_installer_command_line(args)
        .map_err(WindowsInstallerFailure::source_unavailable)?;
    let parameters = String::from_utf16(&parameters[..parameters.len().saturating_sub(1)])
        .map_err(|_| {
            WindowsInstallerFailure::source_unavailable(
                "Windows installer command line is not valid UTF-16",
            )
        })?;
    Ok(format!(
        "{} {}",
        quote_windows_command_line_value(&executable.display().to_string()),
        parameters
    ))
}

#[cfg(any(windows, test))]
#[derive(Debug)]
enum WindowsInstallerFailure {
    SourceUnavailable(String),
    RuntimeUnavailable(String),
    InstallerFailed(String),
    Cancelled(String),
    CleanupIncomplete(String),
}

#[cfg(any(windows, test))]
impl WindowsInstallerFailure {
    fn source_unavailable(message: impl Into<String>) -> Self {
        Self::SourceUnavailable(message.into())
    }

    fn runtime_unavailable(message: impl Into<String>) -> Self {
        Self::RuntimeUnavailable(message.into())
    }

    fn installer_failed(message: impl Into<String>) -> Self {
        Self::InstallerFailed(message.into())
    }

    fn cancelled(message: impl Into<String>) -> Self {
        Self::Cancelled(message.into())
    }

    fn cleanup_incomplete(message: impl Into<String>) -> Self {
        Self::CleanupIncomplete(message.into())
    }

    #[cfg(windows)]
    fn with_context(self, context: impl Into<String>) -> Self {
        let context = context.into();
        match self {
            Self::SourceUnavailable(message) => {
                Self::SourceUnavailable(format!("{message}; {context}"))
            }
            Self::RuntimeUnavailable(message) => {
                Self::RuntimeUnavailable(format!("{message}; {context}"))
            }
            Self::InstallerFailed(message) => {
                Self::InstallerFailed(format!("{message}; {context}"))
            }
            Self::Cancelled(message) => Self::Cancelled(format!("{message}; {context}")),
            Self::CleanupIncomplete(message) => {
                Self::CleanupIncomplete(format!("{message}; {context}"))
            }
        }
    }

    fn permits_package_manager_fallback(&self) -> bool {
        matches!(self, Self::SourceUnavailable(_))
    }

    fn permits_runtime_channel_fallback(&self) -> bool {
        matches!(self, Self::RuntimeUnavailable(_))
    }

    fn requires_runtime_recheck(&self) -> bool {
        matches!(self, Self::InstallerFailed(_))
    }

    #[cfg(windows)]
    fn is_interrupted(&self) -> bool {
        matches!(self, Self::Cancelled(_) | Self::CleanupIncomplete(_))
    }

    fn message(&self) -> &str {
        match self {
            Self::SourceUnavailable(message)
            | Self::RuntimeUnavailable(message)
            | Self::InstallerFailed(message)
            | Self::Cancelled(message)
            | Self::CleanupIncomplete(message) => message,
        }
    }

    #[cfg(windows)]
    fn into_message(self) -> String {
        match self {
            Self::SourceUnavailable(message)
            | Self::RuntimeUnavailable(message)
            | Self::InstallerFailed(message)
            | Self::Cancelled(message)
            | Self::CleanupIncomplete(message) => message,
        }
    }

    #[cfg(windows)]
    fn from_wait_error(operation: &str, error: ControlledProcessWaitError) -> Self {
        match error {
            ControlledProcessWaitError::Monitoring(message) => Self::installer_failed(message),
            ControlledProcessWaitError::Cancelled => Self::cancelled(format!(
                "{operation} was cancelled after JunQi stopped its process tree"
            )),
            ControlledProcessWaitError::TimedOut => {
                Self::installer_failed(format!("{operation} timed out after its allotted wait"))
            }
            ControlledProcessWaitError::CleanupIncomplete(message) => Self::cleanup_incomplete(
                format!(
                    "{operation} timed out and JunQi could not confirm that its process tree stopped: {message}. A fallback installer will not be started."
                ),
            ),
        }
    }

    #[cfg(windows)]
    fn from_output_failure(error: ProcessOutputFailure) -> Self {
        match error {
            ProcessOutputFailure::Read(message) => Self::installer_failed(message),
            ProcessOutputFailure::DidNotClose(message) => Self::cleanup_incomplete(format!(
                "{message}. A fallback installer will not be started because a descendant process may still be running."
            )),
        }
    }
}

#[cfg(any(windows, test))]
fn windows_installer_exit_succeeded(exit_code: u32) -> bool {
    // ERROR_SUCCESS_REBOOT_INITIATED (1641) and
    // ERROR_SUCCESS_REBOOT_REQUIRED (3010) are successful MSI outcomes.
    matches!(exit_code, 0 | 1641 | 3010)
}

#[cfg(any(windows, test))]
fn windows_installer_exit_failure(tool: &str, exit_code: u32) -> WindowsInstallerFailure {
    let detail = match exit_code {
        1603 => "Windows Installer reported a fatal installation error",
        1618 => "another Windows Installer transaction is already running",
        1639 => "Windows Installer rejected an invalid command line; review the recorded elevated installer command",
        1638 => "another version of this product is already installed",
        _ => "the elevated installer reported a non-success result",
    };
    WindowsInstallerFailure::installer_failed(format!(
        "{tool} installer exited with code {exit_code}: {detail}"
    ))
}

/// Reconcile a completed elevated installer with the runtime contract it was
/// supposed to provide. Once an installer process has started, its failure is
/// never treated like a transport failure: Windows may publish PATH/registry
/// state after the parent exits, and starting winget immediately can race the
/// same MSI or display a second UAC prompt.
#[cfg(windows)]
async fn reconcile_windows_installer_runtime<T, Verify, VerifyFuture>(
    app: &tauri::AppHandle,
    step: &str,
    tool: &str,
    installer_result: Result<(), WindowsInstallerFailure>,
    verify: Verify,
) -> Result<T, WindowsInstallerFailure>
where
    Verify: FnOnce() -> VerifyFuture,
    VerifyFuture: std::future::Future<Output = Result<T, WindowsInstallerFailure>>,
{
    match installer_result {
        Ok(()) => verify().await,
        Err(error) if error.requires_runtime_recheck() => {
            emit(
                app,
                step,
                &format!(
                    "{tool} installer result requires runtime verification before any fallback: {}",
                    error.message()
                ),
                0.93,
            );
            match verify().await {
                Ok(runtime) => {
                    emit(
                        app,
                        step,
                        &format!(
                            "{tool} runtime is ready despite the installer result; package-manager fallback was skipped"
                        ),
                        0.96,
                    );
                    Ok(runtime)
                }
                Err(verification_error) if verification_error.is_interrupted() => {
                    Err(verification_error)
                }
                Err(verification_error) => Err(error.with_context(format!(
                    "runtime verification failed: {}. JunQi did not start a second installer",
                    verification_error.into_message()
                ))),
            }
        }
        Err(error) => Err(error),
    }
}

#[cfg(windows)]
fn preserve_windows_installer_log(
    app: &tauri::AppHandle,
    path: &Path,
    tool: &str,
) -> Result<Option<PathBuf>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let destination = diagnostic_artifact_path(
        app,
        tool,
        &format!("{}-{}.log", tool.to_ascii_lowercase(), uuid::Uuid::new_v4()),
    )?;
    std::fs::copy(path, &destination).map_err(|error| {
        format!(
            "Failed to preserve the {tool} native installer log at {}: {error}",
            destination.display()
        )
    })?;
    Ok(Some(destination))
}

#[cfg(windows)]
fn dependency_install_windows_failure(error: String) -> WindowsInstallerFailure {
    if error == DEPENDENCY_INSTALL_CANCELLED_MESSAGE {
        WindowsInstallerFailure::cancelled(error)
    } else {
        WindowsInstallerFailure::source_unavailable(error)
    }
}

#[cfg(any(windows, test))]
impl From<String> for WindowsInstallerFailure {
    fn from(message: String) -> Self {
        Self::source_unavailable(message)
    }
}

#[cfg(windows)]
struct ElevatedWindowsProcess {
    handle: isize,
    pid: u32,
    completed: bool,
    exit_code: Option<u32>,
}

#[cfg(windows)]
impl ElevatedWindowsProcess {
    fn raw_handle(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.handle as windows_sys::Win32::Foundation::HANDLE
    }

    fn poll_exit_code(&mut self) -> Result<Option<u32>, String> {
        use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

        match unsafe { WaitForSingleObject(self.raw_handle(), 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut exit_code = 0_u32;
                if unsafe { GetExitCodeProcess(self.raw_handle(), &mut exit_code) } == 0 {
                    Err(format!(
                        "Could not read the elevated installer exit code: {}",
                        std::io::Error::last_os_error()
                    ))
                } else {
                    self.completed = true;
                    self.exit_code = Some(exit_code);
                    Ok(Some(exit_code))
                }
            }
            _ => Err(format!(
                "Failed while waiting for the elevated installer: {}",
                std::io::Error::last_os_error()
            )),
        }
    }

    async fn terminate_and_reap(&mut self) -> Result<(), String> {
        let tree_termination = if self.pid == 0 {
            Err("The elevated installer did not expose a process ID for tree cleanup".into())
        } else {
            terminate_windows_process_tree(self.pid).await
        };
        let handle = self.handle;
        let root_reaped = tokio::task::spawn_blocking(move || {
            use windows_sys::Win32::Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT};
            use windows_sys::Win32::System::Threading::{TerminateProcess, WaitForSingleObject};

            let handle = handle as windows_sys::Win32::Foundation::HANDLE;
            if unsafe { WaitForSingleObject(handle, 0) } == WAIT_TIMEOUT
                && unsafe { TerminateProcess(handle, 1) } == 0
            {
                return Err(format!(
                    "Failed to terminate the elevated installer process: {}",
                    std::io::Error::last_os_error()
                ));
            }
            match unsafe {
                WaitForSingleObject(handle, PROCESS_REAP_TIMEOUT.as_millis() as u32)
            } {
                WAIT_OBJECT_0 => Ok(()),
                WAIT_TIMEOUT => Err(format!(
                    "The elevated installer process did not exit within {} seconds after termination",
                    PROCESS_REAP_TIMEOUT.as_secs()
                )),
                _ => Err(format!(
                    "Failed while reaping the elevated installer process: {}",
                    std::io::Error::last_os_error()
                )),
            }
        })
        .await
        .map_err(|error| format!("Installer cleanup task failed: {error}"))?;

        match (tree_termination, root_reaped) {
            (Ok(()), Ok(())) => {
                self.completed = true;
                Ok(())
            }
            (Err(tree_error), Ok(())) if process_tree_was_already_gone(&tree_error) => {
                self.completed = true;
                Ok(())
            }
            (Err(tree_error), Ok(())) => Err(format!(
                "The elevated installer process exited, but its process-tree cleanup was not confirmed: {tree_error}"
            )),
            (Ok(()), Err(root_error)) => Err(root_error),
            (Err(tree_error), Err(root_error)) => Err(format!("{tree_error}; {root_error}")),
        }
    }
}

#[cfg(windows)]
impl Drop for ElevatedWindowsProcess {
    fn drop(&mut self) {
        if !self.completed {
            if self.pid != 0 {
                request_windows_process_tree_termination(self.pid);
            }
            if self.handle != 0 {
                unsafe {
                    let _ = windows_sys::Win32::System::Threading::TerminateProcess(
                        self.raw_handle(),
                        1,
                    );
                }
            }
        }
        if self.handle != 0 {
            unsafe {
                let _ = windows_sys::Win32::Foundation::CloseHandle(self.raw_handle());
            }
        }
    }
}

#[cfg(windows)]
async fn launch_elevated_windows_process(
    executable: &Path,
    args: &[std::ffi::OsString],
    label: &str,
) -> Result<ElevatedWindowsProcess, WindowsInstallerFailure> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::System::Threading::GetProcessId;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let executable = executable.to_path_buf();
    let args = args.to_vec();
    let task_label = label.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut executable_wide = executable.as_os_str().encode_wide().collect::<Vec<_>>();
        if executable_wide.contains(&0) {
            return Err(WindowsInstallerFailure::source_unavailable(format!(
                "Invalid {task_label} installer path"
            )));
        }
        executable_wide.push(0);
        let parameters = windows_installer_command_line(&args)
            .map_err(WindowsInstallerFailure::source_unavailable)?;
        let verb = "runas\0".encode_utf16().collect::<Vec<_>>();
        let mut info: SHELLEXECUTEINFOW = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask = SEE_MASK_NOCLOSEPROCESS;
        info.lpVerb = verb.as_ptr();
        info.lpFile = executable_wide.as_ptr();
        info.lpParameters = parameters.as_ptr();
        info.nShow = SW_SHOWNORMAL;

        if unsafe { ShellExecuteExW(&mut info) } == 0 {
            let error = std::io::Error::last_os_error();
            return Err(if error.raw_os_error() == Some(1223) {
                WindowsInstallerFailure::cancelled(format!(
                    "{task_label} installation was cancelled at the Windows administrator prompt"
                ))
            } else {
                WindowsInstallerFailure::source_unavailable(format!(
                    "Failed to start elevated {task_label} installer: {error}"
                ))
            });
        }
        if info.hProcess.is_null() {
            return Err(WindowsInstallerFailure::source_unavailable(format!(
                "The elevated {task_label} installer did not return a process handle"
            )));
        }

        Ok(ElevatedWindowsProcess {
            handle: info.hProcess as isize,
            pid: unsafe { GetProcessId(info.hProcess) },
            completed: false,
            exit_code: None,
        })
    })
    .await
    .map_err(|error| {
        WindowsInstallerFailure::source_unavailable(format!(
            "{label} installer task failed: {error}"
        ))
    })?
}

#[cfg(windows)]
async fn wait_for_elevated_windows_process(
    process: &mut ElevatedWindowsProcess,
    policy: ControlledProcessPolicy,
    progress: &WindowsInstallProgress<'_>,
    operation: &DependencyInstallOperation,
) -> Result<(), WindowsInstallerFailure> {
    let deadline = std::time::Instant::now() + policy.timeout;
    progress.report_installer_wait();
    loop {
        if operation.cancellation_requested() {
            let cleanup = process.terminate_and_reap().await;
            return match cleanup {
                Ok(()) => Err(WindowsInstallerFailure::cancelled(format!(
                    "{} installer was cancelled after JunQi stopped its process tree",
                    progress.tool
                ))),
                Err(error) => Err(WindowsInstallerFailure::cleanup_incomplete(format!(
                    "{} installer cancellation could not confirm process-tree cleanup: {error}",
                    progress.tool
                ))),
            };
        }
        match process.poll_exit_code() {
            Ok(Some(exit_code)) if windows_installer_exit_succeeded(exit_code) => return Ok(()),
            Ok(Some(exit_code)) => {
                return Err(windows_installer_exit_failure(progress.tool, exit_code));
            }
            Ok(None) => {}
            Err(error) => {
                let cleanup = process.terminate_and_reap().await;
                return match cleanup {
                    Ok(()) => Err(WindowsInstallerFailure::installer_failed(error)),
                    Err(cleanup_error) => Err(WindowsInstallerFailure::cleanup_incomplete(
                        format!("{error}; {cleanup_error}"),
                    )),
                };
            }
        }

        let Some(remaining) = deadline.checked_duration_since(std::time::Instant::now()) else {
            let cleanup = process.terminate_and_reap().await;
            return match cleanup {
                Ok(()) => Err(WindowsInstallerFailure::installer_failed(format!(
                    "{} installer timed out after {} seconds",
                    progress.tool,
                    policy.timeout.as_secs()
                ))),
                Err(error) => Err(WindowsInstallerFailure::cleanup_incomplete(format!(
                    "{} installer timed out after {} seconds; {error}",
                    progress.tool,
                    policy.timeout.as_secs()
                ))),
            };
        };

        let sleep_for = remaining.min(policy.heartbeat_interval);
        tokio::select! {
            _ = tokio::time::sleep(sleep_for) => {}
            _ = operation.cancelled() => {}
        }
        if sleep_for == policy.heartbeat_interval {
            progress.report_installer_wait();
        }
    }
}

#[cfg(windows)]
async fn run_windows_installer(
    executable: &Path,
    args: &[std::ffi::OsString],
    policy: ControlledProcessPolicy,
    progress: WindowsInstallProgress<'_>,
    operation: &DependencyInstallOperation,
) -> Result<(), WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let invocation = windows_installer_display_command(executable, args)?;
    emit_diagnostic(
        progress.app,
        progress.step,
        &format!(
            "Launching elevated {} installer: {invocation}",
            progress.tool
        ),
        progress.progress(),
    );
    record_timeline_note(
        progress.app,
        progress.step,
        &format!("elevated installer command: {invocation}"),
    );
    progress.report_admin_prompt();
    let started = std::time::Instant::now();
    let mut process = launch_elevated_windows_process(executable, args, progress.tool).await?;
    record_process_started(
        progress.app,
        progress.step,
        progress.tool,
        Some(process.pid),
        "elevated Windows installer",
    );
    // ShellExecuteExW may be blocked by the Windows UAC dialog. A cancel
    // request is retained by the coordinator while that OS call is pending;
    // once it yields a process handle, this wait immediately terminates and
    // reaps the installer tree instead of allowing setup to continue.
    let result =
        wait_for_elevated_windows_process(&mut process, policy, &progress, operation).await;
    record_process_finished(
        progress.app,
        progress.step,
        progress.tool,
        Some(process.pid),
        process.exit_code.map(i64::from),
        started.elapsed(),
    );
    result.map_err(|error| error.with_context(format!("installer command: {invocation}")))
}

#[cfg(windows)]
fn collect_process_output<R>(
    reader: R,
    app: tauri::AppHandle,
    step: String,
    process: String,
    stream: &'static str,
    progress: f64,
) -> tokio::task::JoinHandle<Result<Vec<u8>, std::io::Error>>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};

        const CAPTURE_LIMIT: usize = 1024 * 1024;
        let mut bytes = Vec::new();
        let mut reader = BufReader::new(reader);
        let mut line = Vec::new();
        loop {
            line.clear();
            let read = reader.read_until(b'\n', &mut line).await?;
            if read == 0 {
                break;
            }
            let remaining = CAPTURE_LIMIT.saturating_sub(bytes.len());
            bytes.extend_from_slice(&line[..line.len().min(remaining)]);
            let output = String::from_utf8_lossy(&line);
            record_process_output(&app, &step, &process, stream, &output);
            let display = crate::commands::diagnostic_output::sanitize_diagnostic_line(&output);
            if !display.is_empty() {
                emit_diagnostic(
                    &app,
                    &step,
                    &format!("winget {stream} › {display}"),
                    progress,
                );
            }
        }
        Ok(bytes)
    })
}

#[cfg(windows)]
async fn finish_process_output(
    stream: &str,
    task: Option<tokio::task::JoinHandle<Result<Vec<u8>, std::io::Error>>>,
) -> Result<Vec<u8>, ProcessOutputFailure> {
    let Some(mut task) = task else {
        return Ok(Vec::new());
    };
    match tokio::time::timeout(PROCESS_REAP_TIMEOUT, &mut task).await {
        Ok(Ok(Ok(bytes))) => Ok(bytes),
        Ok(Ok(Err(error))) => Err(ProcessOutputFailure::Read(format!(
            "Failed to read installer {stream}: {error}"
        ))),
        Ok(Err(error)) => Err(ProcessOutputFailure::Read(format!(
            "Installer {stream} reader task failed: {error}"
        ))),
        Err(_) => {
            task.abort();
            Err(ProcessOutputFailure::DidNotClose(format!(
                "Installer {stream} did not close within {} seconds after the process exited",
                PROCESS_REAP_TIMEOUT.as_secs()
            )))
        }
    }
}

#[cfg(windows)]
#[derive(Debug)]
enum ProcessOutputFailure {
    Read(String),
    DidNotClose(String),
}

/// `Child::kill_on_drop` only reaches the winget launcher. Keep a separate
/// cancellation guard for its installer descendants so an IPC task cancelled
/// during app shutdown cannot leave a package operation behind.
#[cfg(windows)]
struct WindowsChildTreeCancellationGuard {
    pid: Option<u32>,
    armed: bool,
}

#[cfg(windows)]
impl WindowsChildTreeCancellationGuard {
    fn new(pid: Option<u32>) -> Self {
        Self { pid, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

#[cfg(windows)]
impl Drop for WindowsChildTreeCancellationGuard {
    fn drop(&mut self) {
        if self.armed {
            if let Some(pid) = self.pid {
                request_windows_process_tree_termination(pid);
            }
        }
    }
}

#[cfg(windows)]
async fn ensure_winget_package(
    app: &tauri::AppHandle,
    step: &str,
    tool: &str,
    package_id: &str,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<(), WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let winget = platform::detect_path("winget");
    if winget.is_empty() {
        return Err(WindowsInstallerFailure::source_unavailable(
            "Windows Package Manager (winget) is unavailable. Install the dependency with its standard system installer or select an explicit portable runtime directory in JunQi.",
        ));
    }
    // `winget upgrade` is not an installation contract: it exits successfully
    // when the package is absent, already current, or owned by another source.
    // That was the reason a machine could remain on Node.js 20 after JunQi had
    // reported a successful LTS operation. Use one idempotent, forced install
    // and let the caller validate the resulting executable contract before any
    // channel fallback is considered.
    let progress = WindowsInstallProgress::new(app, step, tool, 0.62, 0.92);
    let install = run_winget_package_command(
        &winget,
        package_id,
        budget.process_policy(&format!("winget install for {package_id}"))?,
        &progress,
        operation,
    )
    .await?;
    // Persist winget's own output regardless of outcome: a successful-but-slow
    // install still needs its "Downloading"/"Installing" lines to see where
    // the time went, and they would otherwise only surface on failure.
    let diagnostic = windows_package_manager_output(&install);
    if !diagnostic.is_empty() {
        record_timeline_note(
            app,
            step,
            &format!("winget install {package_id} output: {diagnostic}"),
        );
    }
    if install.status.success() {
        return Ok(());
    }
    Err(WindowsInstallerFailure::source_unavailable(
        if diagnostic.is_empty() {
            format!("winget could not install {package_id}")
        } else {
            format!("winget could not install {package_id}: {diagnostic}")
        },
    ))
}

#[cfg(windows)]
fn windows_package_manager_output(output: &std::process::Output) -> String {
    let raw = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout).trim(),
        String::from_utf8_lossy(&output.stderr).trim()
    );
    crate::commands::diagnostic_output::sanitize_diagnostic_text(raw.trim(), 1_200)
}

#[cfg(windows)]
async fn run_winget_package_command(
    winget: &str,
    package_id: &str,
    policy: ControlledProcessPolicy,
    progress: &WindowsInstallProgress<'_>,
    operation: &DependencyInstallOperation,
) -> Result<std::process::Output, WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let mut command = tokio::process::Command::new(winget);
    command.args([
        "install",
        "-e",
        "--id",
        package_id,
        "--force",
        "--source",
        "winget",
        "--silent",
        "--disable-interactivity",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let mut child = command.spawn().map_err(|error| {
        WindowsInstallerFailure::source_unavailable(format!(
            "Failed to run winget install for {package_id}: {error}"
        ))
    })?;
    let pid = child.id();
    let started = std::time::Instant::now();
    let process_label = format!("winget-{package_id}");
    record_process_started(
        progress.app,
        progress.step,
        &process_label,
        pid,
        &format!("winget install {package_id}"),
    );
    let mut cancellation_guard = WindowsChildTreeCancellationGuard::new(pid);
    let stdout_task = child.stdout.take().map(|stdout| {
        collect_process_output(
            stdout,
            progress.app.clone(),
            progress.step.to_owned(),
            process_label.clone(),
            "stdout",
            progress.progress(),
        )
    });
    let stderr_task = child.stderr.take().map(|stderr| {
        collect_process_output(
            stderr,
            progress.app.clone(),
            progress.step.to_owned(),
            process_label.clone(),
            "stderr",
            progress.progress(),
        )
    });
    let status = wait_for_controlled_child(&mut child, policy, Some(operation), || {
        progress.report_package_manager_wait();
    })
    .await;
    let stdout = finish_process_output("stdout", stdout_task).await;
    let stderr = finish_process_output("stderr", stderr_task).await;
    record_process_finished(
        progress.app,
        progress.step,
        &process_label,
        pid,
        status
            .as_ref()
            .ok()
            .and_then(|status| status.code())
            .map(i64::from),
        started.elapsed(),
    );

    // A root winget process can exit while an installer descendant still owns
    // one of its inherited pipes. Treat that as incomplete cleanup before
    // looking at the root status; otherwise a timeout would be downgraded to a
    // retryable failure and `winget install` could race the live descendant.
    if let Err(ProcessOutputFailure::DidNotClose(message)) = &stdout {
        return Err(WindowsInstallerFailure::from_output_failure(
            ProcessOutputFailure::DidNotClose(message.clone()),
        ));
    }
    if let Err(ProcessOutputFailure::DidNotClose(message)) = &stderr {
        return Err(WindowsInstallerFailure::from_output_failure(
            ProcessOutputFailure::DidNotClose(message.clone()),
        ));
    }
    let status = status.map_err(|error| {
        WindowsInstallerFailure::from_wait_error(&format!("winget install for {package_id}"), error)
    })?;
    let stdout = stdout.map_err(WindowsInstallerFailure::from_output_failure)?;
    let stderr = stderr.map_err(WindowsInstallerFailure::from_output_failure)?;
    if status.success() {
        cancellation_guard.disarm();
    }
    Ok(std::process::Output {
        status,
        stdout,
        stderr,
    })
}

#[derive(Clone, Copy)]
enum NodeRuntimePurpose {
    ExecuteOpenClaw,
    InstallOpenClawPackage,
}

impl NodeRuntimePurpose {
    fn requires_npm(self) -> bool {
        matches!(self, Self::InstallOpenClawPackage)
    }
}

/// Resolve one complete runtime contract for an OpenClaw operation. The
/// requirement is read from package metadata, so version evolution does not
/// require a JunQi release with another hard-coded range.
async fn ensure_node_runtime(
    app: &tauri::AppHandle,
    context_step: &str,
    requirement: &NodeRuntimeRequirement,
    purpose: NodeRuntimePurpose,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    let mut runtime = crate::commands::system::NodeRuntimeContract::resolve(requirement).await?;
    if !runtime.node().available {
        emit_keyed(
            app,
            context_step,
            &format!(
                "Node.js is outside OpenClaw's supported range ({} from {}); preparing a compatible runtime...",
                requirement.expression(),
                requirement.source().label()
            ),
            "setup.node.autoRepair",
            0.1,
        );
        runtime = install_node_for_requirement(app.clone(), requirement.clone(), false, None)
            .await
            .map_err(|error| {
                format!(
                    "Unable to install a compatible Node.js runtime (required: {}): {error}",
                    requirement.expression()
                )
            })?;
    }

    if !runtime.node().available {
        return Err(format!(
            "OpenClaw requires Node.js {}; a compatible runtime was not detected",
            requirement.expression()
        ));
    }
    if purpose.requires_npm() && !runtime.npm().available {
        return Err(runtime.npm().reason.clone().unwrap_or_else(|| {
            "The selected Node.js runtime does not provide a usable bundled npm CLI".into()
        }));
    }

    emit_keyed(
        app,
        context_step,
        &format!(
            "Node.js {} ready: {}",
            runtime.node().version.as_deref().unwrap_or("unknown"),
            crate::commands::system::display_path_text(
                runtime.node().path.as_deref().unwrap_or("node")
            )
        ),
        "setup.node.runtimeReady",
        0.25,
    );
    Ok(runtime)
}

/// Ensure a Node.js executable is suitable for Gateway/CLI execution.
pub(crate) async fn ensure_compatible_node_runtime(
    app: &tauri::AppHandle,
    context_step: &str,
    requirement: &NodeRuntimeRequirement,
) -> Result<crate::commands::system::NodeStatus, String> {
    let (node, _) = ensure_node_runtime(
        app,
        context_step,
        requirement,
        NodeRuntimePurpose::ExecuteOpenClaw,
    )
    .await?
    .into_statuses();
    Ok(node)
}

/// Ensure the same Node.js runtime can also execute its bundled npm CLI before
/// a package install writes any OpenClaw files.
async fn ensure_installable_node_runtime(
    app: &tauri::AppHandle,
    context_step: &str,
    requirement: &NodeRuntimeRequirement,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    ensure_node_runtime(
        app,
        context_step,
        requirement,
        NodeRuntimePurpose::InstallOpenClawPackage,
    )
    .await
}

#[tauri::command]
pub async fn install_git(
    app: tauri::AppHandle,
    operation_id: Option<String>,
) -> Result<String, String> {
    install_git_impl(app, false, operation_id).await
}

pub(crate) async fn update_managed_git_runtime(
    #[cfg_attr(not(windows), allow(unused_variables))] app: tauri::AppHandle,
) -> Result<String, String> {
    paths::validate_runtime_overrides()?;
    #[cfg(windows)]
    {
        return install_git_impl(app, true, None).await;
    }

    #[cfg(not(windows))]
    {
        Err(
            "The active Git installation is managed by the operating system; update it with the system package manager"
                .into(),
        )
    }
}

async fn install_git_impl(
    app: tauri::AppHandle,
    force: bool,
    operation_id: Option<String>,
) -> Result<String, String> {
    paths::validate_runtime_overrides()?;
    let operation =
        DependencyInstallOperation::begin(&app, DependencyInstallTool::Git, operation_id)?;
    operation.ensure_active()?;
    // See install_node_for_requirement: the Windows path must await managed
    // installer cleanup rather than cancel its owner future externally.
    #[cfg(windows)]
    {
        if paths::configured_git_runtime_dir().is_some() {
            return tokio::time::timeout(
                DEPENDENCY_INSTALL_DEADLINE,
                install_git_impl_inner(app, force, &operation),
            )
            .await
            .map_err(|_| "Git 安装超过 30 分钟总时限，已停止本次安装".to_string())?;
        }
        return install_git_impl_inner(app, force, &operation).await;
    }

    #[cfg(not(windows))]
    {
        tokio::time::timeout(
            DEPENDENCY_INSTALL_DEADLINE,
            install_git_impl_inner(app, force, &operation),
        )
        .await
        .map_err(|_| "Git 安装超过 30 分钟总时限，已停止本次安装".to_string())?
    }
}

async fn install_git_impl_inner(
    app: tauri::AppHandle,
    force: bool,
    operation: &DependencyInstallOperation,
) -> Result<String, String> {
    let _guard = wait_for_dependency_install_lock(
        GIT_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(())),
        operation,
    )
    .await?;
    operation.ensure_active()?;
    let step = "git";
    // The lock is held before this reset, so concurrent setup attempts retain
    // the active installer timeline until its transaction has finished.
    reset_timeline_log(&app, step);

    // ① Detect
    emit_keyed(
        &app,
        step,
        "Checking Git installation...",
        "setup.git.check",
        0.02,
    );
    #[cfg(windows)]
    if let Some(target) = paths::configured_git_runtime_dir() {
        return install_windows_portable_git(app, force, target, operation).await;
    }

    let existing_git = crate::commands::system::check_git().await?;
    operation.ensure_active()?;
    if existing_git.available && !force {
        let version = existing_git
            .version
            .unwrap_or_else(|| "unknown version".into());
        emit_keyed(
            &app,
            step,
            &format!("Git {} already installed, skipping", version),
            "setup.git.skip",
            1.0,
        );
        return Ok(format!("Git {} already installed", version));
    }

    #[cfg(windows)]
    {
        return install_windows_system_git(app, operation).await;
    }

    #[cfg(target_os = "macos")]
    {
        emit_keyed(
            &app,
            step,
            "Opening the Apple Command Line Tools installer...",
            "setup.git.macosInstaller",
            0.25,
        );
        let mut command = tokio::process::Command::new("/usr/bin/xcode-select");
        command.arg("--install");
        platform::configure_background_command(&mut command);
        let output = command.output().await.map_err(|error| {
            format!("Failed to open Apple Command Line Tools installer: {error}")
        })?;
        operation.ensure_active()?;
        let diagnostic = format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        if !output.status.success()
            && diagnostic
                .to_ascii_lowercase()
                .contains("already installed")
        {
            return Err(
                "Apple Command Line Tools reports that it is installed, but Git is still unavailable"
                    .into(),
            );
        }
        emit_keyed(
            &app,
            step,
            "Apple Command Line Tools installer opened; complete it, then retry detection.",
            "setup.git.macPolling",
            1.0,
        );
        Ok("Apple Command Line Tools installer opened".into())
    }

    #[cfg(all(not(windows), not(target_os = "macos")))]
    {
        emit_keyed(
            &app,
            step,
            "Git is not available. Install it with the operating-system package manager, then retry.",
            "setup.git.manualRequired",
            1.0,
        );
        Err("Git is required. Install Git with the operating-system package manager, then retry JunQi.".into())
    }
}

#[cfg(windows)]
async fn install_windows_system_git(
    app: tauri::AppHandle,
    operation: &DependencyInstallOperation,
) -> Result<String, String> {
    operation.ensure_active()?;
    let budget = DependencyInstallBudget::new();
    let mirror_error = match install_windows_system_git_from_mirrors(&app, budget, operation).await
    {
        Ok(installed) => return Ok(installed),
        Err(error) if error.permits_package_manager_fallback() => error.into_message(),
        Err(error) => return Err(error.into_message()),
    };
    emit(
        &app,
        "git",
        &format!(
            "Verified Git installer was not started; package-manager fallback is allowed: {mirror_error}"
        ),
        0.60,
    );
    emit_keyed(
        &app,
        "git",
        "The mainland mirror installer could not finish; trying Windows Package Manager...",
        "setup.git.systemPackageFallback",
        0.60,
    );
    operation.ensure_active()?;
    match ensure_winget_package(&app, "git", "Git", WINGET_GIT_PACKAGE, budget, operation).await {
        Ok(()) => {}
        Err(error) if error.is_interrupted() => {
            return Err(error.into_message());
        }
        Err(error) => {
            return Err(format!(
                "Git installer from mainland mirrors failed: {mirror_error}\nWindows Package Manager fallback failed: {}",
                error.into_message()
            ));
        }
    }
    operation.ensure_active()?;
    let installed = wait_for_git_runtime_settle(&app, budget, operation)
        .await
        .map_err(WindowsInstallerFailure::into_message)?;
    operation.ensure_active()?;
    if !installed.available {
        return Err(
            "Git installation completed but git.exe was not detected on the system PATH".into(),
        );
    }
    emit_keyed(
        &app,
        "git",
        "System Git is ready",
        "setup.git.systemReady",
        1.0,
    );
    Ok(format!(
        "Git {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
async fn install_windows_system_git_from_mirrors(
    app: &tauri::AppHandle,
    budget: DependencyInstallBudget,
    operation: &DependencyInstallOperation,
) -> Result<String, WindowsInstallerFailure> {
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    let artifact = verified_system_git_installer_artifact(std::env::consts::ARCH)?;
    emit_keyed(
        app,
        "git",
        "Installing Git to the official Windows default location...",
        "setup.git.systemInstall",
        0.10,
    );
    let temp_dir = std::env::temp_dir().join(format!(
        "junqi-git-system-installer-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to prepare Git installer directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let installer = temp_dir.join(&artifact.filename);
    let sources = artifact.sources();
    download_with_fallback_with_budget(
        DownloadRequest {
            app,
            step: "git",
            sources: &sources,
            destination: &installer,
            expected_sha256: &artifact.sha256,
            progress: 0.12..0.62,
        },
        budget,
        operation,
    )
    .await
    .map_err(dependency_install_windows_failure)?;

    let installer_log = temp_dir.join("git-installer.log");
    let args = vec![
        std::ffi::OsString::from("/VERYSILENT"),
        std::ffi::OsString::from("/NORESTART"),
        std::ffi::OsString::from("/SUPPRESSMSGBOXES"),
        std::ffi::OsString::from("/SP-"),
        std::ffi::OsString::from(format!("/LOG={}", installer_log.display())),
    ];
    let installer_result = run_windows_installer(
        &installer,
        &args,
        budget.process_policy("Git installer")?,
        WindowsInstallProgress::new(app, "git", "Git", 0.64, 0.92),
        operation,
    )
    .await;
    // Preserve the Inno Setup log regardless of outcome: a slow-but-successful
    // install still needs its timestamps to find the real bottleneck.
    let preserved_log = match preserve_windows_installer_log(&app, &installer_log, "git") {
        Ok(path) => path,
        Err(error) => {
            emit_diagnostic(&app, "git", &error, 0.92);
            None
        }
    };
    if let Some(path) = &preserved_log {
        record_timeline_note(
            &app,
            "git",
            &format!("Inno Setup log preserved at {}", path.display()),
        );
    }
    let installer_result = installer_result.map_err(|error| match preserved_log {
        Some(path) => error.with_context(format!("installer log: {}", path.display())),
        None => error,
    });
    let installed =
        reconcile_windows_installer_runtime(app, "git", "Git", installer_result, || {
            wait_for_git_runtime_settle(app, budget, operation)
        })
        .await?;
    operation
        .ensure_active()
        .map_err(WindowsInstallerFailure::cancelled)?;
    if !installed.available {
        return Err(WindowsInstallerFailure::runtime_unavailable(
            "The Git installer completed but git.exe was not detected on the system PATH",
        ));
    }
    emit_keyed(
        app,
        "git",
        "System Git is ready",
        "setup.git.systemReady",
        1.0,
    );
    Ok(format!(
        "Git {} installed at {}",
        installed.version.unwrap_or_default(),
        installed.path.unwrap_or_default()
    ))
}

#[cfg(windows)]
async fn install_windows_portable_git(
    app: tauri::AppHandle,
    force: bool,
    target: PathBuf,
    operation: &DependencyInstallOperation,
) -> Result<String, String> {
    operation.ensure_active()?;
    let target_git = runtime_binary(&target, "git");
    if target_git.is_file() && !force {
        if let Some(version) = read_runtime_version(&target_git).await {
            operation.ensure_active()?;
            return Ok(format!(
                "Git {version} already installed at {}",
                target_git.display()
            ));
        }
    }
    validate_runtime_target_for_activation(&target, "Git")?;

    let artifact = verified_managed_git_artifact(std::env::consts::ARCH)?;
    emit(
        &app,
        "git",
        &format!(
            "Preparing JunQi-verified Git v{} from domestic mirrors...",
            artifact.version
        ),
        0.04,
    );
    let temp_dir =
        std::env::temp_dir().join(format!("junqi-git-download-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Failed to create Git temporary directory: {error}"))?;
    let _temp_cleanup = TemporaryDirectory(temp_dir.clone());
    let archive = temp_dir.join(&artifact.filename);
    let sources = artifact.sources();
    download_with_fallback(
        DownloadRequest {
            app: &app,
            step: "git",
            sources: &sources,
            destination: &archive,
            expected_sha256: &artifact.sha256,
            progress: 0.05..0.55,
        },
        operation,
    )
    .await?;

    let parent = target
        .parent()
        .ok_or("Selected Git runtime directory has no parent")?;
    let staging = parent.join(format!(".junqi-git-stage-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)
        .map_err(|error| format!("Failed to prepare Git staging directory: {error}"))?;
    let _staging_cleanup = TemporaryDirectory(staging.clone());
    operation.ensure_active()?;
    tokio::task::block_in_place(|| {
        extract_zip(&app, "git", &archive, &staging, false, 0.62, operation)
    })?;
    let staged_git = runtime_binary(&staging, "git");
    let version = read_runtime_version(&staged_git)
        .await
        .ok_or("Portable Git extraction finished, but git.exe could not be verified")?;
    operation.ensure_active()?;
    write_runtime_marker(&staging, "git")?;
    let mut activation = activate_staged_runtime(&staging, &target, "git")?;
    if read_runtime_version(&target_git).await.is_none() {
        let failure = "Activated Git runtime failed its post-install version check".to_string();
        return match activation.rollback() {
            Ok(recovery) => Err(recovery.map_or(failure.clone(), |path| {
                format!(
                    "{failure}; the unverified runtime was preserved for recovery at {}",
                    path.display()
                )
            })),
            Err(rollback_error) => Err(format!(
                "{failure}; runtime rollback also failed: {rollback_error}"
            )),
        };
    }
    if operation.cancellation_requested() {
        return Err(rollback_cancelled_runtime_activation(&mut activation));
    }
    if let ManagedRuntimeCommit::BackupCleanupDeferred(warning) = activation.commit() {
        emit(&app, "git", &warning, 0.98);
    }
    emit_keyed(
        &app,
        "git",
        &format!("Git {version} installed in the selected directory"),
        "setup.git.done",
        1.0,
    );
    Ok(format!("Git {version} installed at {}", target.display()))
}

/// Pick the directory we hand to `npm install -g` for the openclaw install.
///
/// Order of preference:
/// 1. An explicit custom prefix from the persisted install layout.
/// 2. The user's `npm config get prefix` from the npm bundled with the Node.js
///    runtime selected for this installation. This matches the npm process
///    that will perform `npm i -g openclaw`, including its own `.npmrc`.
///
/// There is intentionally no hidden user-home or JunQi-owned fallback. If
/// npm's effective prefix is not writable, the installation guide asks for an
/// explicit choice instead of creating a second global OpenClaw installation.
async fn selected_node_npm_prefix(node: &crate::commands::system::NodeStatus) -> Option<PathBuf> {
    crate::commands::system::npm_global_prefix_for_node(node).await
}

fn prefix_bin_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    }
}

fn prefix_bin_is_on_login_path(prefix: &std::path::Path) -> bool {
    let expected = prefix_bin_dir(prefix);
    let expected = std::fs::canonicalize(&expected).unwrap_or(expected);
    let search_path = platform::current_search_path();
    std::env::split_paths(&search_path).any(|entry| {
        let entry = std::fs::canonicalize(&entry).unwrap_or(entry);
        if cfg!(windows) {
            entry
                .to_string_lossy()
                .eq_ignore_ascii_case(&expected.to_string_lossy())
        } else {
            entry == expected
        }
    })
}

async fn pick_install_target(
    app: &tauri::AppHandle,
    step: &str,
    node: &crate::commands::system::NodeStatus,
) -> Result<PathBuf, String> {
    if let Some(prefix) = paths::configured_npm_prefix() {
        if !try_use_prefix(&prefix) {
            return Err(format!(
                "The selected npm global prefix is not writable: {}",
                prefix.display()
            ));
        }
        emit_keyed(
            app,
            step,
            &format!("Using custom npm prefix {}", prefix.display()),
            "setup.openclaw.customNpmPrefix",
            0.075,
        );
        return Ok(prefix);
    }

    let user_prefix = selected_node_npm_prefix(node).await;
    if let Some(prefix) = user_prefix {
        if try_use_prefix(&prefix) {
            let terminal_ready = prefix_bin_is_on_login_path(&prefix);
            emit_keyed(
                app,
                step,
                &format!(
                    "Detected npm prefix {} (matches your `npm i -g`); installing openclaw there",
                    prefix.display()
                ),
                if terminal_ready {
                    "setup.openclaw.userNpmPrefix"
                } else {
                    "setup.openclaw.userNpmPrefixMissingPath"
                },
                0.075,
            );
            return Ok(prefix);
        }
        return Err(format!(
            "npm reports global prefix {}, but it is not writable. Choose a custom OpenClaw npm directory in the installation guide or update npm's own prefix.",
            prefix.display()
        ));
    }

    Err(
        "npm did not report an absolute global prefix. Install Node.js/npm normally, or choose a custom OpenClaw npm directory in the installation guide."
            .into(),
    )
}

/// Decide whether `path` is a usable install target. Returns true when
/// the directory exists (or can be created) AND we can write a probe
/// file into it. `false` means the caller should fall through to the
/// next fallback tier.
fn try_use_prefix(path: &std::path::Path) -> bool {
    if !path.exists() && std::fs::create_dir_all(path).is_err() {
        return false;
    }
    // Probe-write into the dir itself. Use a per-process unique name
    // so concurrent installs can't collide on the probe file.
    let probe = path.join(format!(
        ".junqi-write-probe-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

fn openclaw_node_modules_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.join("node_modules")
    } else {
        prefix.join("lib").join("node_modules")
    }
}

fn windows_openclaw_package_dir(prefix: &std::path::Path) -> PathBuf {
    prefix.join("node_modules").join("openclaw")
}

fn validate_staged_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let package_dir = windows_openclaw_package_dir(prefix);
    let package_json = package_dir.join("package.json");
    let launcher = prefix.join("openclaw.cmd");
    let entry = package_dir.join("openclaw.mjs");
    let package_contract = crate::commands::system::has_openclaw_package_contract(&launcher);
    if package_json.is_file() && entry.is_file() && launcher.is_file() && package_contract {
        return Ok(());
    }
    Err(format!(
        "npm finished but the isolated OpenClaw install is incomplete at {} (package.json, engines.node, openclaw.mjs, and openclaw.cmd are required)",
        prefix.display()
    ))
}

async fn validate_staged_openclaw_package(
    prefix: &Path,
    expected_version: &str,
    expected_requirement: &NodeRuntimeRequirement,
    node_path: &Path,
) -> Result<(), String> {
    let launcher = if cfg!(windows) {
        prefix.join("openclaw.cmd")
    } else {
        unix_openclaw_launcher(prefix)
    };
    let version = crate::commands::system::openclaw_package_version_for_binary(&launcher)?;
    if version != expected_version {
        return Err(format!(
            "Staged OpenClaw version mismatch: expected {expected_version}, found {version}"
        ));
    }
    let requirement =
        crate::commands::system::required_node_requirement_for_openclaw_binary(&launcher)?;
    if requirement.expression() != expected_requirement.expression() {
        return Err(format!(
            "Staged OpenClaw {version} changed its Node.js requirement: expected {}, found {}",
            expected_requirement.expression(),
            requirement.expression()
        ));
    }
    crate::commands::system::validate_openclaw_runtime_payload(&launcher, node_path).await?;
    Ok(())
}

const OPENCLAW_PROMOTION_MARKER: &str = ".junqi-openclaw-promotion.json";
const OPENCLAW_PROMOTION_BACKUP: &str = ".junqi-openclaw-promotion-backup";
const OPENCLAW_PROMOTION_STAGED_SHIMS: &str = ".junqi-openclaw-promotion-shims";
const OPENCLAW_SHIMS: [&str; 3] = ["openclaw", "openclaw.cmd", "openclaw.ps1"];

#[derive(Debug)]
enum PromotionFinalization {
    Complete,
    CleanupDeferred(String),
}

fn finalize_verified_openclaw_promotion(
    marker: &Path,
    cleanup_paths: &[&Path],
) -> PromotionFinalization {
    let mut errors = Vec::new();
    for path in cleanup_paths {
        if !path.exists() {
            continue;
        }
        let result = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        if let Err(error) = result {
            errors.push(format!("{}: {}", path.display(), error));
        }
    }
    if marker.exists() {
        if let Err(error) = std::fs::remove_file(marker) {
            errors.push(format!("{}: {}", marker.display(), error));
        }
    }
    if errors.is_empty() {
        PromotionFinalization::Complete
    } else {
        PromotionFinalization::CleanupDeferred(format!(
            "OpenClaw activation is verified, but promotion cleanup is deferred: {}",
            errors.join("; ")
        ))
    }
}

fn verified_promotion_cleanup_result(finalization: PromotionFinalization) -> Result<(), String> {
    match finalization {
        PromotionFinalization::Complete => Ok(()),
        PromotionFinalization::CleanupDeferred(error) => Err(error),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct OpenClawPromotionState {
    had_existing_package: bool,
    existing_shims: Vec<String>,
}

fn recover_interrupted_openclaw_promotion(target_prefix: &Path) -> Result<(), String> {
    let marker = target_prefix.join(OPENCLAW_PROMOTION_MARKER);
    if !marker.is_file() {
        return Ok(());
    }
    let state: OpenClawPromotionState = serde_json::from_str(
        &std::fs::read_to_string(&marker)
            .map_err(|error| format!("Cannot read OpenClaw promotion marker: {error}"))?,
    )
    .map_err(|error| format!("Cannot parse OpenClaw promotion marker: {error}"))?;
    let target_package = windows_openclaw_package_dir(target_prefix);
    let backup_root = target_prefix.join(OPENCLAW_PROMOTION_BACKUP);
    let backup_package = backup_root.join("package");
    let backup_shims = backup_root.join("shims");

    // If activation and validation succeeded but marker cleanup was blocked by
    // an antivirus scanner or filesystem filter, the marker must never cause a
    // later launch to restore the old package. A backup identifies a replaced
    // install; fresh installs have no previous package by definition.
    let activation_verified = (!state.had_existing_package || backup_package.exists())
        && validate_staged_openclaw_install(target_prefix).is_ok();
    if activation_verified {
        return verified_promotion_cleanup_result(finalize_verified_openclaw_promotion(
            &marker,
            &[
                &backup_root,
                &target_prefix.join(OPENCLAW_PROMOTION_STAGED_SHIMS),
            ],
        ));
    }

    if backup_package.exists() {
        if target_package.exists() {
            std::fs::remove_dir_all(&target_package)
                .map_err(|error| format!("Cannot remove partial OpenClaw package: {error}"))?;
        }
        std::fs::rename(&backup_package, &target_package)
            .map_err(|error| format!("Cannot restore previous OpenClaw package: {error}"))?;
    } else if !state.had_existing_package && target_package.exists() {
        std::fs::remove_dir_all(&target_package)
            .map_err(|error| format!("Cannot remove interrupted OpenClaw package: {error}"))?;
    }

    for shim in OPENCLAW_SHIMS {
        let target = target_prefix.join(shim);
        let backup = backup_shims.join(shim);
        if backup.is_file() {
            if target.exists() {
                std::fs::remove_file(&target)
                    .map_err(|error| format!("Cannot remove partial launcher {shim}: {error}"))?;
            }
            std::fs::rename(&backup, &target)
                .map_err(|error| format!("Cannot restore launcher {shim}: {error}"))?;
        } else if !state.existing_shims.iter().any(|name| name == shim) && target.exists() {
            std::fs::remove_file(&target)
                .map_err(|error| format!("Cannot remove interrupted launcher {shim}: {error}"))?;
        }
    }

    verified_promotion_cleanup_result(finalize_verified_openclaw_promotion(
        &marker,
        &[
            &backup_root,
            &target_prefix.join(OPENCLAW_PROMOTION_STAGED_SHIMS),
        ],
    ))
}

async fn promote_staged_openclaw_install(
    staging_prefix: &std::path::Path,
    target_prefix: &std::path::Path,
) -> Result<PromotionFinalization, String> {
    std::fs::create_dir_all(target_prefix)
        .map_err(|error| format!("Cannot prepare OpenClaw target: {error}"))?;
    recover_interrupted_openclaw_promotion(target_prefix)?;

    let staged_package = windows_openclaw_package_dir(staging_prefix);
    let target_node_modules = target_prefix.join("node_modules");
    let target_package = target_node_modules.join("openclaw");
    let backup_root = target_prefix.join(OPENCLAW_PROMOTION_BACKUP);
    let backup_package = backup_root.join("package");
    let backup_shims = backup_root.join("shims");
    let staged_shims = target_prefix.join(OPENCLAW_PROMOTION_STAGED_SHIMS);
    let marker = target_prefix.join(OPENCLAW_PROMOTION_MARKER);
    let mut last_error = String::new();

    for attempt in 0..6 {
        std::fs::create_dir_all(&target_node_modules).map_err(|error| {
            format!(
                "Cannot prepare the OpenClaw package directory {}: {}",
                target_node_modules.display(),
                error
            )
        })?;
        let _ = std::fs::remove_dir_all(&backup_root);
        let _ = std::fs::remove_dir_all(&staged_shims);
        std::fs::create_dir_all(&staged_shims)
            .map_err(|error| format!("Cannot stage OpenClaw launchers: {error}"))?;
        for shim in OPENCLAW_SHIMS {
            let source = staging_prefix.join(shim);
            if source.is_file() {
                std::fs::copy(&source, staged_shims.join(shim))
                    .map_err(|error| format!("Cannot stage OpenClaw launcher {shim}: {error}"))?;
            }
        }
        if !staged_shims.join("openclaw.cmd").is_file() {
            return Err("The staged OpenClaw installation has no Windows command launcher".into());
        }

        let state = OpenClawPromotionState {
            had_existing_package: target_package.exists(),
            existing_shims: OPENCLAW_SHIMS
                .iter()
                .filter(|shim| target_prefix.join(shim).is_file())
                .map(|shim| (*shim).to_string())
                .collect(),
        };
        paths::atomic_write_text(
            &marker,
            &serde_json::to_string(&state)
                .map_err(|error| format!("Cannot serialize OpenClaw promotion state: {error}"))?,
        )?;

        let activation = (|| -> Result<(), String> {
            std::fs::create_dir_all(&backup_shims)
                .map_err(|error| format!("Cannot prepare OpenClaw backup: {error}"))?;
            if state.had_existing_package {
                std::fs::rename(&target_package, &backup_package).map_err(|error| {
                    format!("Cannot move the current OpenClaw installation because it is in use: {error}")
                })?;
            }
            for shim in &state.existing_shims {
                std::fs::rename(target_prefix.join(shim), backup_shims.join(shim))
                    .map_err(|error| format!("Cannot back up launcher {shim}: {error}"))?;
            }

            std::fs::rename(&staged_package, &target_package)
                .map_err(|error| format!("Cannot activate the staged OpenClaw package: {error}"))?;
            for shim in OPENCLAW_SHIMS {
                let source = staged_shims.join(shim);
                if source.is_file() {
                    std::fs::rename(&source, target_prefix.join(shim))
                        .map_err(|error| format!("Cannot activate launcher {shim}: {error}"))?;
                }
            }
            validate_staged_openclaw_install(target_prefix)
        })();

        match activation {
            Ok(()) => {
                return Ok(finalize_verified_openclaw_promotion(
                    &marker,
                    &[&backup_root, &staged_shims],
                ));
            }
            Err(error) => {
                last_error = error;
                if let Err(rollback_error) = recover_interrupted_openclaw_promotion(target_prefix) {
                    return Err(format!(
                        "OpenClaw activation failed: {last_error}; rollback also failed: {rollback_error}"
                    ));
                }
                if !staged_package.exists() {
                    return Err(format!(
                        "OpenClaw activation failed and was rolled back: {last_error}"
                    ));
                }
            }
        }

        if attempt < 5 {
            tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1))).await;
        }
    }

    Err(format!(
        "OpenClaw was downloaded safely, but its current installation is locked. Close OpenClaw, Gateway, and any antivirus scan using {}, then retry. Last error: {}",
        target_prefix.display(),
        last_error
    ))
}

fn unix_openclaw_package_dir(prefix: &Path) -> PathBuf {
    prefix.join("lib").join("node_modules").join("openclaw")
}

fn unix_openclaw_launcher(prefix: &Path) -> PathBuf {
    prefix.join("bin").join("openclaw")
}

fn validate_staged_unix_openclaw_install(prefix: &Path) -> Result<(), String> {
    let package_json = unix_openclaw_package_dir(prefix).join("package.json");
    let launcher = unix_openclaw_launcher(prefix);
    let entry = unix_openclaw_package_dir(prefix).join("openclaw.mjs");
    let package_contract = crate::commands::system::has_openclaw_package_contract(&launcher);
    if package_json.is_file() && entry.is_file() && launcher.is_file() && package_contract {
        return Ok(());
    }
    Err(format!(
        "npm finished but the isolated OpenClaw install is incomplete at {} (package.json, engines.node, openclaw.mjs, and launcher are required)",
        prefix.display()
    ))
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct UnixOpenClawPromotionState {
    had_existing_package: bool,
    had_existing_launcher: bool,
}

fn recover_interrupted_unix_openclaw_promotion(target_prefix: &Path) -> Result<(), String> {
    let marker = target_prefix.join(OPENCLAW_PROMOTION_MARKER);
    if !marker.is_file() {
        return Ok(());
    }
    let state: UnixOpenClawPromotionState = serde_json::from_str(
        &std::fs::read_to_string(&marker)
            .map_err(|error| format!("Cannot read OpenClaw promotion marker: {error}"))?,
    )
    .map_err(|error| format!("Cannot parse OpenClaw promotion marker: {error}"))?;
    let target_package = unix_openclaw_package_dir(target_prefix);
    let target_launcher = unix_openclaw_launcher(target_prefix);
    let backup_root = target_prefix.join(OPENCLAW_PROMOTION_BACKUP);
    let backup_package = backup_root.join("package");
    let backup_launcher = backup_root.join("openclaw");

    let activation_verified = (!state.had_existing_package || backup_package.exists())
        && validate_staged_unix_openclaw_install(target_prefix).is_ok();
    if activation_verified {
        return verified_promotion_cleanup_result(finalize_verified_openclaw_promotion(
            &marker,
            &[&backup_root],
        ));
    }

    if backup_package.exists() {
        if target_package.exists() {
            std::fs::remove_dir_all(&target_package)
                .map_err(|error| format!("Cannot remove partial OpenClaw package: {error}"))?;
        }
        std::fs::rename(&backup_package, &target_package)
            .map_err(|error| format!("Cannot restore previous OpenClaw package: {error}"))?;
    } else if !state.had_existing_package && target_package.exists() {
        std::fs::remove_dir_all(&target_package)
            .map_err(|error| format!("Cannot remove interrupted OpenClaw package: {error}"))?;
    }

    if backup_launcher.exists() {
        if target_launcher.exists() {
            std::fs::remove_file(&target_launcher)
                .map_err(|error| format!("Cannot remove partial OpenClaw launcher: {error}"))?;
        }
        std::fs::rename(&backup_launcher, &target_launcher)
            .map_err(|error| format!("Cannot restore previous OpenClaw launcher: {error}"))?;
    } else if !state.had_existing_launcher && target_launcher.exists() {
        std::fs::remove_file(&target_launcher)
            .map_err(|error| format!("Cannot remove interrupted OpenClaw launcher: {error}"))?;
    }

    verified_promotion_cleanup_result(finalize_verified_openclaw_promotion(
        &marker,
        &[&backup_root],
    ))
}

fn promote_staged_unix_openclaw_install(
    staging_prefix: &Path,
    target_prefix: &Path,
) -> Result<PromotionFinalization, String> {
    validate_staged_unix_openclaw_install(staging_prefix)?;
    std::fs::create_dir_all(target_prefix)
        .map_err(|error| format!("Cannot prepare OpenClaw target: {error}"))?;
    recover_interrupted_unix_openclaw_promotion(target_prefix)?;

    let staged_package = unix_openclaw_package_dir(staging_prefix);
    let staged_launcher = unix_openclaw_launcher(staging_prefix);
    let target_package = unix_openclaw_package_dir(target_prefix);
    let target_launcher = unix_openclaw_launcher(target_prefix);
    let backup_root = target_prefix.join(OPENCLAW_PROMOTION_BACKUP);
    let backup_package = backup_root.join("package");
    let backup_launcher = backup_root.join("openclaw");
    let marker = target_prefix.join(OPENCLAW_PROMOTION_MARKER);
    let state = UnixOpenClawPromotionState {
        had_existing_package: target_package.exists(),
        had_existing_launcher: target_launcher.exists(),
    };

    if let Some(parent) = target_package.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot prepare OpenClaw package directory: {error}"))?;
    }
    if let Some(parent) = target_launcher.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot prepare OpenClaw launcher directory: {error}"))?;
    }
    let _ = std::fs::remove_dir_all(&backup_root);
    std::fs::create_dir_all(&backup_root)
        .map_err(|error| format!("Cannot prepare OpenClaw backup: {error}"))?;
    paths::atomic_write_text(
        &marker,
        &serde_json::to_string(&state)
            .map_err(|error| format!("Cannot serialize OpenClaw promotion state: {error}"))?,
    )?;

    let activation = (|| -> Result<(), String> {
        if state.had_existing_package {
            std::fs::rename(&target_package, &backup_package).map_err(|error| {
                format!("Cannot move the current OpenClaw installation: {error}")
            })?;
        }
        if state.had_existing_launcher {
            std::fs::rename(&target_launcher, &backup_launcher)
                .map_err(|error| format!("Cannot back up the OpenClaw launcher: {error}"))?;
        }
        std::fs::rename(&staged_package, &target_package)
            .map_err(|error| format!("Cannot activate the staged OpenClaw package: {error}"))?;
        std::fs::rename(&staged_launcher, &target_launcher)
            .map_err(|error| format!("Cannot activate the staged OpenClaw launcher: {error}"))?;
        validate_staged_unix_openclaw_install(target_prefix)
    })();

    if let Err(error) = activation {
        return match recover_interrupted_unix_openclaw_promotion(target_prefix) {
            Ok(()) => Err(format!(
                "OpenClaw activation failed and was rolled back: {error}"
            )),
            Err(rollback_error) => Err(format!(
                "OpenClaw activation failed: {error}; rollback also failed: {rollback_error}"
            )),
        };
    }

    Ok(finalize_verified_openclaw_promotion(
        &marker,
        &[&backup_root],
    ))
}

/// Remove only a broken npm package payload before reinstalling it. User data
/// lives under `~/.openclaw`, outside every npm prefix selected above.
fn remove_broken_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
    let node_modules = openclaw_node_modules_dir(prefix);
    let package_dir = node_modules.join("openclaw");
    if package_dir.exists() {
        std::fs::remove_dir_all(&package_dir).map_err(|error| {
            format!(
                "Cannot remove the incomplete OpenClaw package at {}: {}. Close running OpenClaw processes and retry.",
                package_dir.display(),
                error
            )
        })?;
    }

    if let Ok(entries) = std::fs::read_dir(&node_modules) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with(".openclaw-") {
                let path = entry.path();
                let result = if path.is_dir() {
                    std::fs::remove_dir_all(&path)
                } else {
                    std::fs::remove_file(&path)
                };
                result.map_err(|error| {
                    format!(
                        "Cannot remove the incomplete npm staging path {}: {}. Close running OpenClaw processes and retry.",
                        path.display(),
                        error
                    )
                })?;
            }
        }
    }

    let shim_dir = if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    };
    for shim in ["openclaw", "openclaw.cmd", "openclaw.ps1"] {
        let path = shim_dir.join(shim);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|error| {
                format!(
                    "Cannot remove the stale OpenClaw launcher at {}: {}. Close running OpenClaw processes and retry.",
                    path.display(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn install_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<String, String> {
    install_openclaw_impl(app, state, OpenclawInstallMode::Normal).await
}

/// Reinstall the selected OpenClaw package even when a binary is still
/// detectable. This is deliberately separate from normal first-install
/// detection so a user-visible "reinstall" action has real repair semantics.
#[tauri::command]
pub async fn reinstall_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<String, String> {
    install_openclaw_impl(app, state, OpenclawInstallMode::ReinstallExisting).await
}

#[tauri::command]
pub async fn relocate_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
) -> Result<String, String> {
    if !paths::openclaw_relocation_required() {
        return Err("OpenClaw relocation was not requested by storage migration".into());
    }
    install_openclaw_impl(app, state, OpenclawInstallMode::Relocate).await
}

fn existing_npm_prefix_for_reinstall(binary: &Path, windows: bool) -> Option<PathBuf> {
    let prefix = crate::commands::system::npm_prefix_for_openclaw_binary(binary, windows)?;
    // A project-local `node_modules/.bin/openclaw` has the same package shape
    // as a global install. Require npm's documented global shim at the prefix
    // root/bin before allowing an in-place `npm install -g`, otherwise a Git
    // checkout or application workspace could be overwritten.
    let global_launcher = if windows {
        prefix.join("openclaw.cmd")
    } else {
        prefix.join("bin").join("openclaw")
    };
    crate::commands::system::has_openclaw_package_contract(&global_launcher).then_some(prefix)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OpenclawInstallMode {
    Normal,
    ReinstallExisting,
    Relocate,
}

impl OpenclawInstallMode {
    /// Every install entry point honors a persisted relocation request. This
    /// keeps future callers from reusing the old npm prefix while a storage
    /// migration is unfinished.
    fn for_current_storage(self) -> Self {
        if paths::openclaw_relocation_required() {
            Self::Relocate
        } else {
            self
        }
    }

    fn forces_npm_install(self) -> bool {
        !matches!(self, Self::Normal)
    }
}

fn verify_relocated_openclaw_prefix(binary: &Path, expected_prefix: &Path) -> Result<(), String> {
    let installed_prefix =
        crate::commands::system::npm_prefix_for_openclaw_binary(binary, cfg!(windows)).ok_or_else(
            || {
                format!(
                    "OpenClaw was installed but its npm prefix could not be verified: {}",
                    binary.display()
                )
            },
        )?;
    if paths::paths_refer_to_same_location(&installed_prefix, expected_prefix) {
        return Ok(());
    }
    Err(format!(
        "OpenClaw was installed at {}, but the selected npm directory is {}",
        installed_prefix.display(),
        expected_prefix.display()
    ))
}

#[derive(Debug, Clone)]
struct OpenclawRelocationRequest {
    expected_npm_prefix: Option<PathBuf>,
    effective_target: Option<PathBuf>,
    package_contract: Option<paths::OpenclawRelocationContract>,
}

impl OpenclawRelocationRequest {
    fn capture() -> Result<Self, String> {
        let layout = paths::load_storage_bootstrap()
            .ok_or("Storage setup must be completed before relocating OpenClaw")?;
        if !layout.openclaw_relocation_required {
            return Err("OpenClaw relocation is no longer pending".into());
        }
        Ok(Self {
            expected_npm_prefix: layout.npm_prefix,
            effective_target: None,
            package_contract: layout.openclaw_relocation_contract,
        })
    }

    fn package_contract(&self) -> Option<&paths::OpenclawRelocationContract> {
        self.package_contract.as_ref()
    }

    fn freeze_target(&mut self, target: &Path) -> Result<(), String> {
        if let Some(expected) = self.expected_npm_prefix.as_deref() {
            if !paths::paths_refer_to_same_location(expected, target) {
                return Err(format!(
                    "The persisted npm relocation target ({}) conflicts with the effective npm prefix ({}). Clear the JUNQI_NPM_PREFIX override or update the storage selection before retrying.",
                    expected.display(),
                    target.display(),
                ));
            }
        }
        self.effective_target = Some(target.to_path_buf());
        Ok(())
    }

    async fn commit(
        &self,
        binary: &Path,
        runtime: &crate::commands::system::NativeOpenclawRuntime,
        installed_prefix: &Path,
    ) -> Result<(), String> {
        let target = self
            .effective_target
            .as_deref()
            .ok_or("OpenClaw relocation target was not frozen before installation")?;
        if !paths::paths_refer_to_same_location(installed_prefix, target) {
            return Err(format!(
                "OpenClaw installation target changed during relocation: expected {}, used {}",
                target.display(),
                installed_prefix.display(),
            ));
        }
        verify_relocated_openclaw_prefix(binary, target)?;
        crate::commands::system::persist_selected_openclaw_binary(binary)?;
        if paths::terminal_integration_requested() {
            crate::commands::terminal_integration::sync_terminal_integration_with_native_runtime(
                runtime,
            )?;
        }
        // The relocation marker is the durable commit point. Until the
        // launcher is rebuilt for the verified runtime, keep it pending so a
        // restart cannot treat a partially switched terminal contract as
        // ready; the resolver will force this transaction to resume.
        paths::complete_openclaw_relocation(self.expected_npm_prefix.as_deref())
    }
}

async fn install_openclaw_impl(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    mode: OpenclawInstallMode,
) -> Result<String, String> {
    // npm owns the OpenClaw installation deadline and performs explicit
    // process-tree cleanup before retrying a registry. An outer timeout would
    // cancel that cleanup future and could detach npm lifecycle children.
    install_openclaw_impl_inner(app, state, mode).await
}

async fn install_openclaw_impl_inner(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    mode: OpenclawInstallMode,
) -> Result<String, String> {
    paths::validate_runtime_overrides()?;
    crate::commands::system::validate_openclaw_binary_override()?;
    let step = "openclaw";
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let install_lock = OPENCLAW_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = install_lock.lock().await;
    reset_timeline_log(&app, step);
    let mode = mode.for_current_storage();
    let mut relocation = matches!(mode, OpenclawInstallMode::Relocate)
        .then(OpenclawRelocationRequest::capture)
        .transpose()?;

    emit_keyed(
        &app,
        step,
        "Checking for existing local OpenClaw...",
        "setup.openclaw.checkExisting",
        0.02,
    );
    let existing = crate::commands::system::detect_openclaw().await;
    if existing.installed && matches!(mode, OpenclawInstallMode::Normal) {
        let existing_binary = existing
            .path
            .as_deref()
            .map(PathBuf::from)
            .ok_or_else(|| {
                "OpenClaw was detected without a stable executable path; reinstall it from the setup guide"
                    .to_string()
            })?;
        // Reusing an installed package is still a runtime transition. A newly
        // selected portable Node.js must satisfy the package's own
        // engines.node contract, and its npm shim/entry must remain resolvable.
        // This keeps the existing-install fast path from bypassing custom
        // Node.js selection during storage migration or recovery.
        let existing_requirement =
            crate::commands::system::required_node_requirement_for_openclaw_binary(
                &existing_binary,
            )?;
        let selected_node =
            ensure_compatible_node_runtime(&app, step, &existing_requirement).await?;
        let runtime =
            crate::commands::system::native_openclaw_runtime(existing_binary, &selected_node)?;
        let detail = match (&existing.version, &existing.path) {
            (Some(version), Some(path)) => {
                format!("Using existing OpenClaw {} at {}", version, path)
            }
            (_, Some(path)) => format!("Using existing OpenClaw at {}", path),
            _ => "Using existing local OpenClaw".to_string(),
        };
        if paths::terminal_integration_requested() {
            crate::commands::terminal_integration::sync_terminal_integration_with_native_runtime(
                &runtime,
            )?;
        }
        emit_keyed(&app, step, &detail, "setup.openclaw.useExisting", 1.0);
        return Ok(detail);
    }

    if matches!(mode, OpenclawInstallMode::ReinstallExisting) && existing.installed {
        emit_keyed(
            &app,
            step,
            "Reinstalling the detected OpenClaw package...",
            "setup.openclaw.reinstall",
            0.03,
        );
    }

    if matches!(mode, OpenclawInstallMode::Relocate) {
        emit_keyed(
            &app,
            step,
            "Moving OpenClaw to the newly selected npm directory...",
            "setup.openclaw.relocate",
            0.03,
        );
    } else if matches!(mode, OpenclawInstallMode::Normal) {
        emit_keyed(
            &app,
            step,
            "No existing OpenClaw was found; installing a managed local OpenClaw for this computer...",
            "setup.openclaw.firstInstall",
            0.03,
        );
    }

    // A selected npm runtime owns registry discovery, including user/global
    // npmrc locations and private credentials. Bootstrap a broadly supported
    // Node/npm pair first, then resolve the target package contract through
    // that exact npm configuration before choosing the final Node runtime.
    let bootstrap_runtime =
        ensure_installable_node_runtime(&app, step, &NodeRuntimeRequirement::fallback()).await?;
    let bootstrap_node = bootstrap_runtime
        .node()
        .path
        .as_deref()
        .map(Path::new)
        .ok_or("The bootstrap Node.js runtime did not report an executable path")?;
    let target_resolution = OpenclawInstallTargetResolution::for_install(mode, relocation.as_ref());
    let target = target_openclaw_install_target(bootstrap_node, target_resolution).await?;
    let (compatible_node, _npm) =
        ensure_installable_node_runtime(&app, step, &target.node_requirement)
            .await?
            .into_statuses();

    // ① 定位 Node.js 二进制
    emit_keyed(
        &app,
        step,
        "Locating Node.js executable...",
        "setup.openclaw.locateNode",
        0.05,
    );
    let node_path = if let Some(path) = compatible_node
        .path
        .as_deref()
        .filter(|_| compatible_node.available)
    {
        emit_keyed(
            &app,
            step,
            &format!("Using detected Node.js: {}", path),
            "setup.openclaw.useLocalNode",
            0.05,
        );
        PathBuf::from(path)
    } else {
        return Err("A compatible Node.js runtime was not detected".into());
    };

    // npm is carried out of the same resolved runtime contract as Node.js.
    // Do not re-probe PATH here: a different npm would install OpenClaw under
    // a different Node version or global prefix than the one just validated.
    let npm_context = crate::commands::system::NpmExecutionContext::for_node(&node_path)?;
    emit_keyed(
        &app,
        step,
        &format!(
            "Using npm bundled with selected Node.js: {}",
            npm_context.npm_cli().display()
        ),
        "setup.openclaw.useNodeNpm",
        0.07,
    );

    // ② Resolve the install prefix dynamically. An explicit setup choice
    // wins; otherwise use the login terminal's actual npm prefix. No
    // user-specific path is hard-coded here and no hidden prefix is created.
    let openclaw_prefix = match mode {
        OpenclawInstallMode::ReinstallExisting => existing
            .path
            .as_deref()
            .and_then(|path| existing_npm_prefix_for_reinstall(Path::new(path), cfg!(windows)))
            .ok_or_else(|| {
                "The detected OpenClaw is not an npm installation JunQi can safely replace in place. Update or reinstall it with its original package manager, then retry."
                    .to_string()
            })?,
        OpenclawInstallMode::Relocate => {
            let target = pick_install_target(&app, step, &compatible_node).await?;
            relocation
                .as_mut()
                .ok_or("OpenClaw relocation request is unavailable")?
                .freeze_target(&target)?;
            target
        }
        OpenclawInstallMode::Normal => pick_install_target(&app, step, &compatible_node).await?,
    };
    let openclaw_prefix_text = openclaw_prefix.to_string_lossy().into_owned();
    emit_keyed_with_params(
        &app,
        step,
        &format!("Preparing install directory {openclaw_prefix_text}..."),
        "setup.openclaw.prepareDir",
        &[("path", openclaw_prefix_text.as_str())],
        0.08,
    );
    std::fs::create_dir_all(&openclaw_prefix).ok();
    if !cfg!(windows) && !existing.installed {
        remove_broken_openclaw_install(&openclaw_prefix)?;
    }

    // ③ npm install（有效 npm 配置源优先，公共源可验证回退，全程输出实时日志）
    emit(
        &app,
        step,
        "Resolving the selected npm package source...",
        0.10,
    );

    npm_install_with_fallback(NpmInstallRequest {
        app: &app,
        step,
        npm: &npm_context,
        global_prefix: &openclaw_prefix,
        target: &target.release,
        force: mode.forces_npm_install(),
        progress: 0.10..0.90,
    })
    .await?;

    // ④ 验证
    emit_keyed(
        &app,
        step,
        "Verifying openclaw installation...",
        "setup.openclaw.verify",
        0.92,
    );
    // `npm i -g <prefix>` 写出来的 bin 在 `<prefix>/bin/<name>`，部分
    // 环境下也可能落在 `<prefix>/node_modules/.bin/<name>`，优先前者
    // 后者兜底。`openclaw_prefix` 已经是 `pick_install_target` 选出来的
    // 真实落点（用户 npm prefix 或显式选择的前缀），不要再回退到任何
    // 隐藏的全局目录。
    let mut openclaw_bin = if cfg!(windows) {
        openclaw_prefix.join("openclaw.cmd")
    } else {
        openclaw_prefix
            .join("bin")
            .join(platform::bin_name("openclaw"))
    };
    if !openclaw_bin.exists() {
        let alt_bin = openclaw_prefix
            .join("node_modules")
            .join(".bin")
            .join(platform::bin_name("openclaw"));
        if !alt_bin.exists() {
            return Err("No executable found in openclaw install directory, please retry".into());
        }
        openclaw_bin = alt_bin;
    }

    let search_path = crate::commands::system::openclaw_search_path();
    let verified =
        crate::commands::system::validate_openclaw_binary(&openclaw_bin, &search_path).await;
    if !verified.installed {
        return Err(format!(
            "OpenClaw was installed but failed validation: {}",
            verified
                .error
                .unwrap_or_else(|| "unknown validation error".into())
        ));
    }
    let installed_package_version =
        crate::commands::system::openclaw_package_version_for_binary(&openclaw_bin)?;
    if installed_package_version != target.release.version() {
        return Err(format!(
            "OpenClaw package version mismatch after installation: expected {}, found {}",
            target.release.version(),
            installed_package_version
        ));
    }
    let installed_requirement =
        crate::commands::system::required_node_requirement_for_openclaw_binary(&openclaw_bin)?;
    if installed_requirement.expression() != target.node_requirement.expression() {
        return Err(format!(
            "OpenClaw {} changed its Node.js requirement during installation: expected {}, found {}",
            installed_package_version,
            target.node_requirement.expression(),
            installed_requirement.expression()
        ));
    }
    let post_install_node =
        crate::commands::system::check_node_for_requirement(&installed_requirement).await?;
    if !post_install_node.available {
        return Err(format!(
            "OpenClaw {} requires Node.js {}, but the selected runtime is no longer compatible after installation",
            installed_package_version,
            installed_requirement.expression()
        ));
    }
    let installed_runtime =
        crate::commands::system::native_openclaw_runtime(openclaw_bin.clone(), &post_install_node)?;
    if let Some(relocation) = relocation {
        relocation
            .commit(&openclaw_bin, &installed_runtime, &openclaw_prefix)
            .await?;
    } else {
        crate::commands::system::persist_selected_openclaw_binary(&openclaw_bin)?;
        if paths::terminal_integration_requested() {
            crate::commands::terminal_integration::sync_terminal_integration_with_native_runtime(
                &installed_runtime,
            )?;
        }
    }

    let installed_version = verified.version.unwrap_or_else(|| "unknown version".into());
    emit(
        &app,
        step,
        &format!("OpenClaw {} installed successfully ✓", installed_version),
        1.0,
    );
    Ok(format!(
        "OpenClaw {} installed successfully",
        installed_version
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "junqi-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    fn write_windows_openclaw(prefix: &Path, version: &str) {
        let package = windows_openclaw_package_dir(prefix);
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(
            package.join("package.json"),
            format!(r#"{{"name":"openclaw","version":"{version}","engines":{{"node":">=18"}}}}"#),
        )
        .unwrap();
        std::fs::write(package.join("openclaw.mjs"), "").unwrap();
        std::fs::write(prefix.join("openclaw.cmd"), format!("@echo {version}\r\n")).unwrap();
    }

    fn write_unix_openclaw(prefix: &Path, version: &str) {
        let package = unix_openclaw_package_dir(prefix);
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(
            package.join("package.json"),
            format!(r#"{{"name":"openclaw","version":"{version}","engines":{{"node":">=18"}}}}"#),
        )
        .unwrap();
        std::fs::write(package.join("openclaw.mjs"), "").unwrap();
        let launcher = unix_openclaw_launcher(prefix);
        std::fs::create_dir_all(launcher.parent().unwrap()).unwrap();
        std::fs::write(launcher, format!("#!/bin/sh\necho {version}\n")).unwrap();
    }

    #[test]
    fn node_checksum_parser_requires_the_exact_archive_name() {
        let digest = "a".repeat(64);
        let checksums = format!(
            "{digest}  node-v24.18.1-win-x64.zip\n{}  node-v24.18.1-win-arm64.zip\n",
            "b".repeat(64)
        );
        assert_eq!(
            parse_shasums(&checksums, "node-v24.18.1-win-x64.zip"),
            Some(digest)
        );
        assert_eq!(parse_shasums(&checksums, "node-v24.18.1-win-x86.zip"), None);
    }

    #[test]
    fn npm_log_filter_hides_internal_and_per_request_network_noise() {
        assert_eq!(
            npm_log_line_for_display("npm verbose cli /usr/bin/node /usr/bin/npm"),
            None
        );
        assert_eq!(
            npm_log_line_for_display("npm http fetch GET 200 https://registry.npmjs.org/openclaw"),
            None
        );
        assert_eq!(
            npm_log_line_for_display("npm warn deprecated package@1.0.0"),
            Some("npm warn deprecated package@1.0.0".into())
        );
    }

    #[test]
    fn npm_log_line_redacted_keeps_noisy_lines_for_the_raw_diagnostic_console() {
        // The raw console must show verbose/sill/timing lines that the
        // primary progress stream drops, but never at the cost of leaking
        // credentials embedded in a registry URL.
        assert_eq!(
            npm_log_line_redacted("npm verbose cli /usr/bin/node /usr/bin/npm"),
            Some("npm verbose cli /usr/bin/node /usr/bin/npm".into())
        );
        assert_eq!(
            npm_log_line_redacted("npm timing reifyNode:node_modules/openclaw Completed in 45ms"),
            Some("npm timing reifyNode:node_modules/openclaw Completed in 45ms".into())
        );
        assert_eq!(
            npm_log_line_redacted("npm sill fetch https://user:secret@example.com/pkg"),
            Some("npm sill fetch [registry URL redacted]".into())
        );
        assert_eq!(
            npm_log_line_redacted("npm verbose authorization: Bearer secret-value"),
            Some("[authentication details redacted]".into())
        );
        assert!(npm_log_line_is_noisy("npm verbose cli ..."));
        assert!(npm_log_line_is_noisy("npm http fetch GET 200 ..."));
        assert!(npm_log_line_is_http_fetch("npm http fetch GET 200 ..."));
    }

    #[test]
    fn npm_fetch_duration_parser_reads_only_http_fetch_timings() {
        assert_eq!(
            npm_fetch_duration_ms(
                "npm http fetch GET 200 https://cdn.example.test/package.tgz 156841ms (cache miss)"
            ),
            Some(156_841)
        );
        assert_eq!(
            npm_fetch_duration_ms("npm warn deprecated package@1.0.0"),
            None
        );
    }

    #[test]
    fn npm_stream_progress_uses_monotonic_observed_milestones() {
        let progress = NpmStreamProgress::default();
        let resolving = progress.observe("npm sill idealTree buildDeps");
        let first_fetch = progress.observe("npm http fetch GET 200 https://example.test/a 20ms");
        let later_fetch = (0..30)
            .map(|index| progress.observe(&format!("npm http fetch GET 200 package-{index} 20ms")))
            .last()
            .unwrap();
        let lifecycle = progress.observe("> openclaw@2026.7.1-2 postinstall");
        let summary = progress.observe("added 309 packages in 5m");

        assert!(resolving < first_fetch);
        assert!(first_fetch < later_fetch);
        assert!(later_fetch < lifecycle);
        assert!(lifecycle < summary);
        assert_eq!(progress.observe("unrelated output"), summary);
    }

    #[test]
    fn slow_npm_fetch_signal_is_emitted_once_without_leaking_urls() {
        let (tx, rx) = tokio::sync::watch::channel(None::<String>);
        let triggered = AtomicBool::new(false);
        let metrics = Arc::new(Mutex::new(NpmFetchMetrics::default()));
        let line = "npm http fetch GET 200 https://user:secret@example.test/package.tgz 91000ms (cache miss)";

        observe_npm_fetch(
            line,
            "npmmirror.com (China mirror)",
            &tx,
            &triggered,
            &metrics,
        );
        observe_npm_fetch(
            line,
            "npmmirror.com (China mirror)",
            &tx,
            &triggered,
            &metrics,
        );

        let reason = rx.borrow().clone().expect("slow source signal");
        assert!(reason.contains("91000ms"));
        assert!(!reason.contains("example.test"));
        assert!(triggered.load(Ordering::Acquire));
        let summary = npm_fetch_summary("npmmirror.com (China mirror)", &metrics).unwrap();
        assert!(summary.contains("requests=2"));
        assert!(summary.contains("cache misses=2"));
        assert!(summary.contains("slowest=91000ms"));
        assert!(!summary.contains("example.test"));
    }

    #[test]
    fn npm_log_filter_redacts_credentials() {
        assert_eq!(
            npm_log_line_for_display("npm error authorization: Bearer secret-value"),
            Some("[authentication details redacted]".into())
        );
        assert_eq!(
            npm_log_line_for_display("request https://user:secret@example.com/package failed"),
            Some("request [registry URL redacted] failed".into())
        );
    }

    #[test]
    fn npm_log_filter_bounds_untrusted_output() {
        let output = npm_log_line_for_display(&"x".repeat(1_500)).expect("line remains visible");
        assert_eq!(output.chars().count(), 1_001);
        assert!(output.ends_with('…'));
    }

    #[test]
    fn npm_failure_diagnostics_are_bounded_and_already_redacted() {
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        for index in 0..(NPM_DIAGNOSTIC_LINE_LIMIT + 3) {
            let line =
                npm_log_line_for_display(&format!("npm error spawn git ENOENT {index}")).unwrap();
            record_npm_diagnostic(&diagnostics, &line);
        }
        let text = npm_diagnostic_text(&diagnostics);
        assert_eq!(text.split(" | ").count(), NPM_DIAGNOSTIC_LINE_LIMIT);
        assert!(text.contains("spawn git ENOENT"));
        assert!(!text.contains("secret"));

        let secret = npm_log_line_for_display("npm error authorization: Bearer secret").unwrap();
        record_npm_diagnostic(&diagnostics, &secret);
        assert!(!npm_diagnostic_text(&diagnostics).contains("secret"));
    }

    #[tokio::test]
    async fn openclaw_promotion_replaces_package_and_clears_transaction() {
        let root = test_dir("openclaw-promote");
        let staging = root.join("staging");
        let target = root.join("target");
        write_windows_openclaw(&staging, "2.0.0");
        write_windows_openclaw(&target, "1.0.0");

        promote_staged_openclaw_install(&staging, &target)
            .await
            .unwrap();

        let package =
            std::fs::read_to_string(windows_openclaw_package_dir(&target).join("package.json"))
                .unwrap();
        assert!(package.contains("2.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        assert!(!target.join(OPENCLAW_PROMOTION_BACKUP).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn unix_openclaw_promotion_replaces_package_atomically() {
        let root = test_dir("openclaw-unix-promote");
        let staging = root.join("staging");
        let target = root.join("target");
        write_unix_openclaw(&staging, "2.0.0");
        write_unix_openclaw(&target, "1.0.0");

        promote_staged_unix_openclaw_install(&staging, &target).unwrap();

        let package =
            std::fs::read_to_string(unix_openclaw_package_dir(&target).join("package.json"))
                .unwrap();
        assert!(package.contains("2.0.0"));
        assert!(std::fs::read_to_string(unix_openclaw_launcher(&target))
            .unwrap()
            .contains("2.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        assert!(!target.join(OPENCLAW_PROMOTION_BACKUP).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_unix_openclaw_promotion_restores_previous_runtime() {
        let root = test_dir("openclaw-unix-rollback");
        let target = root.join("target");
        let backup = target.join(OPENCLAW_PROMOTION_BACKUP);
        write_unix_openclaw(&target, "2.0.0");
        write_unix_openclaw(&backup, "1.0.0");
        std::fs::rename(unix_openclaw_package_dir(&backup), backup.join("package")).unwrap();
        std::fs::rename(unix_openclaw_launcher(&backup), backup.join("openclaw")).unwrap();
        std::fs::remove_file(unix_openclaw_package_dir(&target).join("openclaw.mjs")).unwrap();
        paths::atomic_write_text(
            &target.join(OPENCLAW_PROMOTION_MARKER),
            &serde_json::to_string(&UnixOpenClawPromotionState {
                had_existing_package: true,
                had_existing_launcher: true,
            })
            .unwrap(),
        )
        .unwrap();

        recover_interrupted_unix_openclaw_promotion(&target).unwrap();

        let package =
            std::fs::read_to_string(unix_openclaw_package_dir(&target).join("package.json"))
                .unwrap();
        assert!(package.contains("1.0.0"));
        assert!(std::fs::read_to_string(unix_openclaw_launcher(&target))
            .unwrap()
            .contains("1.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn verified_unix_promotion_cleanup_preserves_the_new_runtime() {
        let root = test_dir("openclaw-unix-verified-recovery");
        let target = root.join("target");
        let backup = target.join(OPENCLAW_PROMOTION_BACKUP);
        write_unix_openclaw(&target, "2.0.0");
        write_unix_openclaw(&backup, "1.0.0");
        std::fs::rename(unix_openclaw_package_dir(&backup), backup.join("package")).unwrap();
        std::fs::rename(unix_openclaw_launcher(&backup), backup.join("openclaw")).unwrap();
        paths::atomic_write_text(
            &target.join(OPENCLAW_PROMOTION_MARKER),
            &serde_json::to_string(&UnixOpenClawPromotionState {
                had_existing_package: true,
                had_existing_launcher: true,
            })
            .unwrap(),
        )
        .unwrap();

        recover_interrupted_unix_openclaw_promotion(&target).unwrap();

        assert!(
            std::fs::read_to_string(unix_openclaw_package_dir(&target).join("package.json"))
                .unwrap()
                .contains("2.0.0")
        );
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        assert!(!target.join(OPENCLAW_PROMOTION_BACKUP).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn interrupted_openclaw_promotion_restores_package_and_launcher() {
        let root = test_dir("openclaw-rollback");
        let target = root.join("target");
        let backup = target.join(OPENCLAW_PROMOTION_BACKUP);
        write_windows_openclaw(&target, "2.0.0");
        write_windows_openclaw(&backup, "1.0.0");
        std::fs::create_dir_all(backup.join("shims")).unwrap();
        std::fs::rename(
            windows_openclaw_package_dir(&backup),
            backup.join("package"),
        )
        .unwrap();
        std::fs::rename(
            backup.join("openclaw.cmd"),
            backup.join("shims").join("openclaw.cmd"),
        )
        .unwrap();
        std::fs::remove_file(windows_openclaw_package_dir(&target).join("openclaw.mjs")).unwrap();
        paths::atomic_write_text(
            &target.join(OPENCLAW_PROMOTION_MARKER),
            &serde_json::to_string(&OpenClawPromotionState {
                had_existing_package: true,
                existing_shims: vec!["openclaw.cmd".into()],
            })
            .unwrap(),
        )
        .unwrap();

        recover_interrupted_openclaw_promotion(&target).unwrap();

        let package =
            std::fs::read_to_string(windows_openclaw_package_dir(&target).join("package.json"))
                .unwrap();
        assert!(package.contains("1.0.0"));
        assert!(std::fs::read_to_string(target.join("openclaw.cmd"))
            .unwrap()
            .contains("1.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn verified_windows_promotion_cleanup_preserves_the_new_runtime() {
        let root = test_dir("openclaw-windows-verified-recovery");
        let target = root.join("target");
        let backup = target.join(OPENCLAW_PROMOTION_BACKUP);
        write_windows_openclaw(&target, "2.0.0");
        write_windows_openclaw(&backup, "1.0.0");
        std::fs::create_dir_all(backup.join("shims")).unwrap();
        std::fs::rename(
            windows_openclaw_package_dir(&backup),
            backup.join("package"),
        )
        .unwrap();
        std::fs::rename(
            backup.join("openclaw.cmd"),
            backup.join("shims").join("openclaw.cmd"),
        )
        .unwrap();
        paths::atomic_write_text(
            &target.join(OPENCLAW_PROMOTION_MARKER),
            &serde_json::to_string(&OpenClawPromotionState {
                had_existing_package: true,
                existing_shims: vec!["openclaw.cmd".into()],
            })
            .unwrap(),
        )
        .unwrap();

        recover_interrupted_openclaw_promotion(&target).unwrap();

        assert!(std::fs::read_to_string(
            windows_openclaw_package_dir(&target).join("package.json")
        )
        .unwrap()
        .contains("2.0.0"));
        assert!(!target.join(OPENCLAW_PROMOTION_MARKER).exists());
        assert!(!target.join(OPENCLAW_PROMOTION_BACKUP).exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn reinstall_resolves_the_detected_npm_prefix_in_place() {
        let root = test_dir("openclaw-reinstall-prefix");
        write_windows_openclaw(&root, "1.0.0");
        let dot_bin = root.join("node_modules").join(".bin").join("openclaw.cmd");
        std::fs::create_dir_all(dot_bin.parent().unwrap()).unwrap();
        std::fs::write(&dot_bin, "@echo off\r\n").unwrap();

        assert_eq!(
            existing_npm_prefix_for_reinstall(&root.join("openclaw.cmd"), true),
            Some(root.clone())
        );
        assert_eq!(
            existing_npm_prefix_for_reinstall(&dot_bin, true),
            Some(root.clone())
        );
        assert_eq!(
            existing_npm_prefix_for_reinstall(&root.join("elsewhere").join("openclaw.cmd"), true),
            None
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn relocation_uses_the_persisted_package_contract_instead_of_latest() {
        let contract = paths::OpenclawRelocationContract::new(
            "2026.7.1-2".to_string(),
            ">=24.15.0 <25".to_string(),
        )
        .unwrap();
        let relocation = OpenclawRelocationRequest {
            expected_npm_prefix: None,
            effective_target: None,
            package_contract: Some(contract.clone()),
        };

        assert_eq!(
            OpenclawInstallTargetResolution::for_install(
                OpenclawInstallMode::Relocate,
                Some(&relocation),
            ),
            OpenclawInstallTargetResolution::PinnedRelocation(contract)
        );
        assert_eq!(
            OpenclawInstallTargetResolution::for_install(
                OpenclawInstallMode::Normal,
                Some(&relocation),
            ),
            OpenclawInstallTargetResolution::Latest
        );
    }

    #[tokio::test]
    async fn process_activity_wait_returns_exit_status() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "process.exit(0)"])
            .spawn()
            .expect("Node.js is required by the desktop build");
        let (_activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);

        // Hosted CI runners can take more than a second to schedule a freshly
        // spawned Node process. Keep the inactivity budget representative of
        // process startup while retaining a separate hard test deadline.
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            wait_for_process_activity(
                &mut child,
                &mut activity_rx,
                std::time::Duration::from_secs(10),
                std::time::Instant::now() + std::time::Duration::from_secs(10),
            ),
        )
        .await
        .expect("process activity wait must finish within the test deadline");

        assert!(matches!(result, NpmWaitResult::Exited(Ok(status)) if status.success()));
    }

    #[tokio::test]
    async fn process_activity_wait_detects_inactivity() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => {}, 10000)"])
            .spawn()
            .expect("Node.js is required by the desktop build");
        let (_activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);

        let result = wait_for_process_activity(
            &mut child,
            &mut activity_rx,
            std::time::Duration::from_millis(25),
            std::time::Instant::now() + std::time::Duration::from_secs(10),
        )
        .await;

        assert!(matches!(result, NpmWaitResult::Inactive));
        let pid = child.id();
        terminate_process_tree(&mut child, pid).await;
    }

    #[tokio::test]
    async fn process_activity_wait_enforces_its_absolute_deadline_despite_activity() {
        let mut child = tokio::process::Command::new(platform::bin_name("node"))
            .args(["-e", "setTimeout(() => {}, 10000)"])
            .spawn()
            .expect("Node.js is required by the desktop build");
        let (activity_tx, mut activity_rx) = tokio::sync::watch::channel(0_u64);
        let notifier = tokio::spawn(async move {
            loop {
                activity_tx.send_modify(|sequence| *sequence += 1);
                tokio::time::sleep(std::time::Duration::from_millis(2)).await;
            }
        });

        let result = wait_for_process_activity(
            &mut child,
            &mut activity_rx,
            std::time::Duration::from_secs(1),
            std::time::Instant::now() + std::time::Duration::from_millis(30),
        )
        .await;

        notifier.abort();
        let _ = notifier.await;
        assert!(matches!(result, NpmWaitResult::DeadlineExceeded));
        let pid = child.id();
        terminate_process_tree(&mut child, pid).await;
    }

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

    #[test]
    fn only_prelaunch_source_failures_allow_package_manager_fallback() {
        let source_unavailable =
            WindowsInstallerFailure::source_unavailable("download source unavailable");
        assert!(source_unavailable.permits_package_manager_fallback());

        let installer_failed = windows_installer_exit_failure("Node.js", 1603);
        assert!(!installer_failed.permits_package_manager_fallback());
        assert!(installer_failed.requires_runtime_recheck());

        let runtime_unavailable =
            WindowsInstallerFailure::runtime_unavailable("runtime not visible");
        assert!(!runtime_unavailable.permits_package_manager_fallback());
        assert!(runtime_unavailable.permits_runtime_channel_fallback());

        let cleanup_incomplete =
            WindowsInstallerFailure::cleanup_incomplete("tree termination was not confirmed");
        assert!(!cleanup_incomplete.permits_package_manager_fallback());
        assert!(matches!(
            cleanup_incomplete,
            WindowsInstallerFailure::CleanupIncomplete(message)
                if message == "tree termination was not confirmed"
        ));

        let cancelled = WindowsInstallerFailure::cancelled("administrator prompt declined");
        assert!(!cancelled.permits_package_manager_fallback());
        assert!(matches!(
            cancelled,
            WindowsInstallerFailure::Cancelled(message)
                if message == "administrator prompt declined"
        ));
    }

    #[test]
    fn windows_installer_success_codes_include_reboot_outcomes() {
        assert!(windows_installer_exit_succeeded(0));
        assert!(windows_installer_exit_succeeded(1641));
        assert!(windows_installer_exit_succeeded(3010));
        assert!(!windows_installer_exit_succeeded(1603));
        assert!(!windows_installer_exit_succeeded(1618));
    }

    #[test]
    fn windows_msi_command_line_keeps_switches_canonical_and_quotes_paths() {
        let invocation = WindowsMsiInvocation::quiet_install(
            Path::new(r"C:\Users\Jun Qi\AppData\Local\Temp\node-v24.18.0-x64.msi"),
            Path::new(r"C:\Users\Jun Qi\AppData\Local\Temp\node-msi.log"),
        );
        let command_line = invocation
            .arguments()
            .iter()
            .map(|argument| quote_windows_command_line_value(&argument.to_string_lossy()))
            .collect::<Vec<_>>()
            .join(" ");

        assert_eq!(
            command_line,
            r#"/i "C:\Users\Jun Qi\AppData\Local\Temp\node-v24.18.0-x64.msi" /qn /norestart /L*V "C:\Users\Jun Qi\AppData\Local\Temp\node-msi.log""#,
        );
    }

    #[test]
    fn windows_command_line_quote_escapes_embedded_quotes_and_trailing_slashes() {
        assert_eq!(quote_windows_command_line_value(""), "\"\"");
        let value = "C:\\path with space\\\"quoted\"\\";
        assert_eq!(
            quote_windows_command_line_value(value),
            "\"C:\\path with space\\\\\\\"quoted\\\"\\\\\"",
        );
    }

    #[test]
    fn windows_installer_invalid_command_line_is_actionable() {
        let error = windows_installer_exit_failure("Node.js", 1639);
        assert!(error.message().contains("1639"));
        assert!(error.message().contains("invalid command line"));
        assert!(error.requires_runtime_recheck());
    }

    #[test]
    fn windows_installer_busy_error_retains_actionable_exit_code() {
        let error = windows_installer_exit_failure("Node.js", 1618);
        assert!(error.message().contains("1618"));
        assert!(error.message().contains("already running"));
        assert!(error.requires_runtime_recheck());
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

    #[tokio::test]
    async fn dependency_install_cancellation_wakes_waiters_without_reusing_the_signal() {
        let first = DependencyInstallCancellation::new();
        let second = DependencyInstallCancellation::new();
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
}
