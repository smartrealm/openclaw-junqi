//! Managed-runtime staging: ownership markers, activation transactions,
//! and post-install settle checks for JunQi-owned Node.js/Git runtimes.

use super::*;

pub(super) const MANAGED_RUNTIME_MARKER: &str = ".junqi-managed-runtime.json";
pub(super) const MANAGED_RUNTIME_SCHEMA: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct ManagedRuntimeMarker {
    pub(super) schema: u32,
    pub(super) owner: String,
    pub(super) tool: String,
}

pub(super) fn runtime_path_is_reparse_point(path: &Path) -> bool {
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

pub(super) fn runtime_path_has_reparse_ancestor(path: &Path) -> bool {
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

pub(super) fn runtime_marker_path(root: &Path) -> PathBuf {
    root.join(MANAGED_RUNTIME_MARKER)
}

pub(super) fn runtime_marker_matches(root: &Path, tool: &str) -> bool {
    let Ok(raw) = std::fs::read_to_string(runtime_marker_path(root)) else {
        return false;
    };
    serde_json::from_str::<ManagedRuntimeMarker>(&raw).is_ok_and(|marker| {
        marker.schema == MANAGED_RUNTIME_SCHEMA
            && marker.owner == "junqi-desktop"
            && marker.tool == tool
    })
}

pub(super) fn write_runtime_marker(root: &Path, tool: &str) -> Result<(), String> {
    let marker = ManagedRuntimeMarker {
        schema: MANAGED_RUNTIME_SCHEMA,
        owner: "junqi-desktop".into(),
        tool: tool.into(),
    };
    let raw = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("Failed to serialize {tool} runtime marker: {error}"))?;
    crate::paths::atomic_write_text(&runtime_marker_path(root), &raw)
}

pub(super) fn runtime_target_is_empty(path: &Path) -> Result<bool, String> {
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

pub(super) fn validate_runtime_target_for_activation(
    target: &Path,
    tool: &str,
) -> Result<(), String> {
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

pub(super) struct ManagedRuntimeActivation {
    pub(super) target: PathBuf,
    pub(super) backup: Option<PathBuf>,
    pub(super) committed: bool,
}

pub(super) enum ManagedRuntimeCommit {
    Finalized,
    BackupCleanupDeferred(String),
}

impl ManagedRuntimeActivation {
    /// Finalize a validated activation without recursively deleting the old
    /// user-selected directory. A backup can receive external files while an
    /// installer runs, so only an empty backup is removed automatically.
    pub(super) fn commit(mut self) -> ManagedRuntimeCommit {
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

    pub(super) fn rollback(&mut self) -> Result<Option<PathBuf>, String> {
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

pub(super) fn rollback_cancelled_runtime_activation(
    activation: &mut ManagedRuntimeActivation,
) -> String {
    match activation.rollback() {
        Ok(Some(recovery)) => format!(
            "{SETUP_OPERATION_CANCELLED_MESSAGE}; the partially activated runtime was preserved for recovery at {}",
            recovery.display()
        ),
        Ok(None) => SETUP_OPERATION_CANCELLED_MESSAGE.into(),
        Err(rollback_error) => format!(
            "{SETUP_OPERATION_CANCELLED_MESSAGE}; runtime rollback also failed: {rollback_error}"
        ),
    }
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) fn runtime_binary(root: &Path, tool: &str) -> PathBuf {
    match (tool, cfg!(windows)) {
        ("node", true) => root.join("node.exe"),
        ("node", false) => root.join("bin").join("node"),
        ("git", true) => root.join("cmd").join("git.exe"),
        ("git", false) => root.join("bin").join("git"),
        _ => root.join(tool),
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) async fn read_runtime_version(path: &Path) -> Option<String> {
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
pub(super) async fn validate_node_runtime_pair(
    node_path: &Path,
    requirement: &NodeRuntimeRequirement,
) -> Result<(String, String), String> {
    let (_, version) = crate::commands::system::probe_selected_node_runtime(node_path)
        .await
        .map_err(|error| {
            format!(
                "Node.js executable could not be verified at {}: {error}",
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
pub(super) fn activate_staged_runtime(
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
