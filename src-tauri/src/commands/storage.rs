use crate::paths::{self, OpenClawRuntimeMode, StorageBootstrap};
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode, GatewayRuntimeState};
use crate::state::GatewayProcess;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSetupStatus {
    configured: bool,
    configuration_error: Option<String>,
    runtime_reconfiguration_recovery_error: Option<String>,
    state_dir: String,
    config_path: String,
    workspace_dir: String,
    runtime_dir: String,
    npm_cache_dir: Option<String>,
    npm_prefix: Option<String>,
    node_runtime_dir: Option<String>,
    git_runtime_dir: Option<String>,
    custom_node_runtime_supported: bool,
    custom_git_runtime_supported: bool,
    openclaw_relocation_required: bool,
    terminal_integration: bool,
    terminal_launcher_dir: String,
    legacy_dir: String,
    legacy_exists: bool,
    legacy_size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfigureResult {
    state_dir: String,
    config_path: String,
    workspace_dir: String,
    runtime_dir: String,
    npm_cache_dir: Option<String>,
    npm_prefix: Option<String>,
    node_runtime_dir: Option<String>,
    git_runtime_dir: Option<String>,
    runtime_reconfiguration_required: bool,
    openclaw_relocation_required: bool,
    terminal_integration: bool,
    created_fresh: bool,
    migrated: bool,
    files_copied: u64,
    bytes_copied: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLocationSelection {
    workspace_dir: String,
    runtime_dir: String,
    npm_cache_dir: Option<String>,
    npm_prefix: Option<String>,
    node_runtime_dir: Option<String>,
    git_runtime_dir: Option<String>,
    terminal_integration: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct DirectoryStats {
    files: u64,
    bytes: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct RuntimeLocationChanges {
    node: bool,
    git: bool,
    npm_prefix: bool,
}

impl RuntimeLocationChanges {
    fn between(current: &StorageBootstrap, next: &StorageBootstrap) -> Self {
        Self {
            node: optional_locations_differ(
                current.node_runtime_dir.as_deref(),
                next.node_runtime_dir.as_deref(),
            ),
            git: optional_locations_differ(
                current.git_runtime_dir.as_deref(),
                next.git_runtime_dir.as_deref(),
            ),
            npm_prefix: optional_locations_differ(
                current.npm_prefix.as_deref(),
                next.npm_prefix.as_deref(),
            ),
        }
    }

    fn requires_setup(self) -> bool {
        self.node || self.git || self.npm_prefix
    }
}

fn apply_runtime_location_transition(
    current: &StorageBootstrap,
    next: &mut StorageBootstrap,
) -> bool {
    let changes = RuntimeLocationChanges::between(current, next);
    let native = matches!(next.runtime_mode, OpenClawRuntimeMode::Native);
    next.openclaw_relocation_required = current.openclaw_relocation_required || changes.npm_prefix;
    native && (changes.requires_setup() || current.openclaw_relocation_required)
}

fn relocation_contract_for_binary(
    binary: Option<&Path>,
) -> Result<Option<paths::OpenclawRelocationContract>, String> {
    let Some(binary) = binary else {
        return Ok(None);
    };
    let version = crate::commands::system::openclaw_package_version_for_binary(binary)?;
    let node_requirement =
        crate::commands::system::required_node_requirement_for_openclaw_binary(binary)?;
    paths::OpenclawRelocationContract::new(version, node_requirement.expression().to_string())
        .map(Some)
        .map_err(|error| {
            format!("Could not freeze the installed OpenClaw relocation contract: {error}")
        })
}

fn emit_progress(app: &AppHandle, key: &'static str, message: &'static str, progress: f64) {
    let _ = app.emit(
        "storage-migration-progress",
        serde_json::json!({ "key": key, "message": message, "progress": progress.clamp(0.0, 1.0) }),
    );
}

fn collect_stats(path: &Path) -> Result<DirectoryStats, String> {
    if !path.exists() {
        return Ok(DirectoryStats::default());
    }
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Failed to inspect {}: {}", path.display(), e))?;
    if crate::commands::fs_neu::is_filesystem_link(&metadata) || metadata.is_file() {
        return Ok(DirectoryStats {
            files: 1,
            bytes: metadata.len(),
        });
    }

    let mut stats = DirectoryStats::default();
    for entry in
        std::fs::read_dir(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let child = collect_stats(&entry.path())?;
        stats.files = stats.files.saturating_add(child.files);
        stats.bytes = stats.bytes.saturating_add(child.bytes);
    }
    Ok(stats)
}

fn copy_symlink(source: &Path, target: &Path) -> Result<(), String> {
    let link = std::fs::read_link(source)
        .map_err(|e| format!("Failed to read symlink {}: {}", source.display(), e))?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&link, target)
            .map_err(|e| format!("Failed to copy symlink {}: {}", source.display(), e))
    }
    #[cfg(windows)]
    {
        let points_to_dir = source.is_dir();
        if points_to_dir {
            std::os::windows::fs::symlink_dir(&link, target)
        } else {
            std::os::windows::fs::symlink_file(&link, target)
        }
        .map_err(|e| format!("Failed to copy symlink {}: {}", source.display(), e))
    }
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|e| format!("Failed to inspect {}: {}", source.display(), e))?;
    if crate::commands::fs_neu::is_filesystem_link(&metadata) {
        return copy_symlink(source, target);
    }
    if metadata.is_file() {
        std::fs::copy(source, target).map_err(|e| {
            format!(
                "Failed to copy {} to {}: {}",
                source.display(),
                target.display(),
                e
            )
        })?;
        let _ = std::fs::set_permissions(target, metadata.permissions());
        return Ok(());
    }

    std::fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create {}: {}", target.display(), e))?;
    let _ = std::fs::set_permissions(target, metadata.permissions());
    for entry in std::fs::read_dir(source)
        .map_err(|e| format!("Failed to read {}: {}", source.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        copy_tree(&entry.path(), &target.join(entry.file_name()))?;
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<Vec<u8>, String> {
    let bytes =
        std::fs::read(path).map_err(|e| format!("Failed to verify {}: {}", path.display(), e))?;
    Ok(Sha256::digest(bytes).to_vec())
}

fn directory_is_empty(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(true);
    }
    if !path.is_dir() {
        return Ok(false);
    }
    Ok(std::fs::read_dir(path)
        .map_err(|e| format!("Failed to read target directory: {}", e))?
        .next()
        .is_none())
}

fn path_has_reparse_ancestor(path: &Path) -> bool {
    let mut cursor = path;
    loop {
        if std::fs::symlink_metadata(cursor)
            .ok()
            .is_some_and(|metadata| crate::commands::fs_neu::is_filesystem_link(&metadata))
        {
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

fn required_absolute_path(label: &str, raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() {
        return Err(format!("{} is required", label));
    }
    if !path.is_absolute() {
        return Err(format!("{} must be an absolute path", label));
    }
    if path.parent().is_none_or(|parent| parent == path) {
        return Err(format!("{} cannot be a filesystem root", label));
    }
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(format!(
            "{} cannot contain parent-directory traversal",
            label
        ));
    }
    Ok(path)
}

fn optional_absolute_path(label: &str, raw: Option<&str>) -> Result<Option<PathBuf>, String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| required_absolute_path(label, value))
        .transpose()
}

fn optional_locations_differ(left: Option<&Path>, right: Option<&Path>) -> bool {
    !paths::optional_paths_refer_to_same_location(left, right)
}

#[cfg(test)]
fn path_strings_overlap(left: &str, right: &str, separator: char) -> bool {
    if left == right {
        return true;
    }
    let left_prefix = format!("{}{}", left.trim_end_matches(separator), separator);
    let right_prefix = format!("{}{}", right.trim_end_matches(separator), separator);
    left.starts_with(&right_prefix) || right.starts_with(&left_prefix)
}

fn layout_locations(layout: &StorageBootstrap) -> Vec<(&'static str, &Path)> {
    let mut locations = vec![
        ("workspace", layout.workspace_dir.as_path()),
        ("OpenClaw internal runtime", layout.runtime_dir.as_path()),
    ];
    if let Some(cache) = &layout.npm_cache_dir {
        locations.push(("npm cache", cache.as_path()));
    }
    if let Some(prefix) = &layout.npm_prefix {
        locations.push(("npm global prefix", prefix.as_path()));
    }
    if let Some(node_runtime) = &layout.node_runtime_dir {
        locations.push(("custom Node.js runtime", node_runtime.as_path()));
    }
    if let Some(git_runtime) = &layout.git_runtime_dir {
        locations.push(("custom Git runtime", git_runtime.as_path()));
    }
    locations
}

fn validate_location_changes(
    layout: &StorageBootstrap,
    existing: Option<&StorageBootstrap>,
) -> Result<(), String> {
    let docker_config =
        paths::config_path_for_runtime(&layout.state_dir, OpenClawRuntimeMode::Docker);
    if paths::paths_refer_to_same_location(&layout.config_path, &docker_config) {
        return Err(
            "Native and Docker OpenClaw configurations must use separate files".to_string(),
        );
    }
    let dependency_locations = [
        ("npm global prefix", layout.npm_prefix.as_deref()),
        ("custom Node.js runtime", layout.node_runtime_dir.as_deref()),
        ("custom Git runtime", layout.git_runtime_dir.as_deref()),
    ];
    for (label, location) in dependency_locations {
        let Some(location) = location else { continue };
        if !paths::paths_overlap(location, &layout.state_dir) {
            continue;
        }
        return Err(format!(
            "{} must be outside the OpenClaw state directory so storage migration cannot move or partially copy an executable runtime",
            label
        ));
    }

    let locations = layout_locations(layout);
    let existing_locations = existing.map(layout_locations).unwrap_or_default();
    for (index, (left_label, left)) in locations.iter().enumerate() {
        for (right_label, right) in locations.iter().skip(index + 1) {
            if paths::paths_overlap(left, right) {
                let overlap_is_unchanged = existing.is_some()
                    && existing_locations
                        .iter()
                        .find(|(label, _)| label == left_label)
                        .is_some_and(|(_, path)| path == left)
                    && existing_locations
                        .iter()
                        .find(|(label, _)| label == right_label)
                        .is_some_and(|(_, path)| path == right)
                    && paths::paths_overlap(left, right);
                if overlap_is_unchanged {
                    continue;
                }
                return Err(format!(
                    "{} and {} directories must be separate and cannot contain one another",
                    left_label, right_label
                ));
            }
        }
    }
    Ok(())
}

fn validate_independent_locations(layout: &StorageBootstrap) -> Result<(), String> {
    validate_location_changes(layout, None)
}

fn selected_layout(
    state_dir: PathBuf,
    selection: InstallLocationSelection,
) -> Result<StorageBootstrap, String> {
    let workspace = required_absolute_path("Workspace directory", &selection.workspace_dir)?;
    let runtime = required_absolute_path(
        "OpenClaw internal runtime directory",
        &selection.runtime_dir,
    )?;
    let npm_cache =
        optional_absolute_path("npm cache directory", selection.npm_cache_dir.as_deref())?;
    let npm_prefix = optional_absolute_path("npm global prefix", selection.npm_prefix.as_deref())?;
    let node_runtime = optional_absolute_path(
        "custom Node.js runtime directory",
        selection.node_runtime_dir.as_deref(),
    )?;
    let git_runtime = optional_absolute_path(
        "custom Git runtime directory",
        selection.git_runtime_dir.as_deref(),
    )?;
    let capabilities = crate::commands::runtime_policy::ManagedRuntimeCapabilities::current();
    if node_runtime.is_some() && !capabilities.node {
        return Err("Custom portable Node.js is only supported on Windows and macOS".into());
    }
    if git_runtime.is_some() && !capabilities.git {
        return Err("Custom portable Git is only supported on Windows".into());
    }

    let mut layout = StorageBootstrap::with_locations(
        state_dir,
        workspace,
        runtime,
        npm_cache,
        npm_prefix,
        selection.terminal_integration,
    );
    layout.node_runtime_dir = node_runtime.map(paths::normalize_node_runtime_root);
    layout.git_runtime_dir = git_runtime.map(paths::normalize_git_runtime_root);
    Ok(layout)
}

fn preserve_migrated_media_roots(
    layout: &mut StorageBootstrap,
    existing_layout: &StorageBootstrap,
    source: &Path,
    migrate_existing: bool,
) {
    layout.historical_media_state_dirs = existing_layout.historical_media_state_dirs.clone();
    layout.drop_current_media_state_dir_from_history();
    if migrate_existing && !paths::paths_refer_to_same_location(source, &layout.state_dir) {
        layout.remember_historical_media_state_dir(source.to_path_buf());
    }
}

fn apply_process_runtime_overrides(
    layout: &mut StorageBootstrap,
    target: &Path,
) -> Result<(), String> {
    let overrides = paths::runtime_location_overrides()?;
    if let Some(state) = overrides.state_dir {
        if !paths::paths_refer_to_same_location(&state, target) {
            return Err(format!(
                "OPENCLAW_STATE_DIR ({}) conflicts with the selected storage target ({})",
                state.display(),
                target.display()
            ));
        }
        layout.state_dir = state.clone();
        if overrides.config_path.is_none() {
            layout.config_path =
                paths::config_path_for_runtime(&state, OpenClawRuntimeMode::Native);
        }
        layout.workspace_dir = state.join("workspace");
        layout.runtime_dir = state.clone();
    }
    if let Some(config) = overrides.config_path {
        layout.config_path = config;
    }
    for (label, value, slot) in [
        (
            "Node.js runtime",
            overrides.node_runtime_dir,
            &mut layout.node_runtime_dir,
        ),
        (
            "Git runtime",
            overrides.git_runtime_dir,
            &mut layout.git_runtime_dir,
        ),
        ("npm prefix", overrides.npm_prefix, &mut layout.npm_prefix),
    ] {
        if let Some(value) = value {
            if slot
                .as_ref()
                .is_some_and(|current| !paths::paths_refer_to_same_location(current, &value))
            {
                return Err(format!(
                    "{label} environment override ({}) conflicts with the selected storage layout",
                    value.display()
                ));
            }
            *slot = Some(value);
        }
    }
    if let Some(value) = overrides.npm_cache_dir {
        if layout
            .npm_cache_dir
            .as_ref()
            .is_some_and(|current| !paths::paths_refer_to_same_location(current, &value))
        {
            return Err(format!(
                "npm cache environment override ({}) conflicts with the selected storage layout",
                value.display()
            ));
        }
        layout.npm_cache_dir = Some(value);
    }
    Ok(())
}

fn layout_with_npm_cache(
    current: &StorageBootstrap,
    npm_cache_dir: Option<&str>,
) -> Result<StorageBootstrap, String> {
    let mut updated = current.clone();
    updated.npm_cache_dir = optional_absolute_path("npm cache directory", npm_cache_dir)?;
    validate_location_changes(&updated, Some(current))?;
    Ok(updated)
}

/// Test the filesystem operations a selected directory will actually need,
/// while leaving a newly chosen empty directory empty for the following
/// storage transaction. A successful `create_dir_all` alone is not enough on
/// virtual, network, FAT, and security-filtered Windows volumes.
fn verify_directory_capability(
    path: &Path,
    label: &str,
    probe: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let existed = path.exists();
    std::fs::create_dir_all(path).map_err(|error| {
        format!(
            "{label} directory cannot be created at {}: {error}",
            path.display()
        )
    })?;
    let probe_root = path.join(format!(".junqi-storage-probe-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        std::fs::create_dir(&probe_root).map_err(|error| {
            format!(
                "{label} directory cannot create a probe at {}: {error}",
                path.display()
            )
        })?;
        probe(&probe_root)
    })();
    let probe_cleanup = std::fs::remove_dir_all(&probe_root);
    let directory_cleanup = if existed {
        Ok(())
    } else {
        std::fs::remove_dir(path)
    };

    match (result, probe_cleanup, directory_cleanup) {
        (Ok(()), Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(()), Ok(())) => Err(error),
        (Ok(()), Err(error), Ok(())) => Err(format!(
            "{label} directory probe completed but could not be cleaned: {error}"
        )),
        (Ok(()), Ok(()), Err(error)) => Err(format!(
            "{label} directory probe completed but the newly created directory could not be removed: {error}"
        )),
        (Err(error), cleanup_error, directory_error) => Err(format!(
            "{error}; probe cleanup: {}; directory cleanup: {}",
            cleanup_error
                .map(|_| "ok".to_string())
                .unwrap_or_else(|cleanup| cleanup.to_string()),
            directory_error
                .map(|_| "ok".to_string())
                .unwrap_or_else(|cleanup| cleanup.to_string())
        )),
        (Ok(()), Err(probe_error), Err(directory_error)) => Err(format!(
            "{label} directory probe completed but cleanup failed: probe={probe_error}; directory={directory_error}"
        )),
    }
}

fn verify_directory_write_and_rename(path: &Path, label: &str) -> Result<(), String> {
    verify_directory_capability(path, label, |probe_root| {
        let source = probe_root.join("write-probe");
        let destination = probe_root.join("write-probe-renamed");
        std::fs::write(&source, b"junqi-storage-probe")
            .map_err(|error| format!("{label} directory is not writable: {error}"))?;
        std::fs::rename(&source, &destination).map_err(|error| {
            format!("{label} directory does not support the required atomic rename: {error}")
        })
    })
}

fn verify_npm_prefix_capability(prefix: &Path) -> Result<(), String> {
    verify_directory_capability(prefix, "npm prefix", |probe_root| {
        #[cfg(windows)]
        {
            let launcher = probe_root.join("openclaw.cmd");
            std::fs::write(&launcher, "@echo off\r\n")
                .map_err(|error| format!("npm prefix cannot create a Windows launcher: {error}"))?;
            std::fs::rename(&launcher, probe_root.join("openclaw-renamed.cmd")).map_err(|error| {
                format!("npm prefix cannot atomically replace a Windows launcher: {error}")
            })
        }
        #[cfg(not(windows))]
        {
            use std::os::unix::fs::symlink;

            let target = probe_root.join("openclaw-target");
            let launcher = probe_root.join("openclaw");
            std::fs::write(&target, b"junqi-npm-prefix-probe")
                .map_err(|error| format!("npm prefix is not writable: {error}"))?;
            symlink(&target, &launcher).map_err(|error| {
                format!("npm prefix does not support npm launcher symlinks: {error}")
            })?;
            std::fs::rename(&launcher, probe_root.join("openclaw-renamed")).map_err(|error| {
                format!("npm prefix cannot atomically replace an npm launcher: {error}")
            })
        }
    })
}

fn verify_directory_writable(path: &Path) -> Result<(), String> {
    verify_directory_write_and_rename(path, "npm cache")
}

async fn verify_state_directory_capability(
    state_dir: &Path,
    runtime_mode: OpenClawRuntimeMode,
    candidate_node: Option<&Path>,
) -> Result<(), String> {
    if matches!(runtime_mode, OpenClawRuntimeMode::Docker) {
        return crate::commands::openclaw_state_dir::verify_state_directory_basics(state_dir);
    }
    // A selected portable runtime is part of the pending layout, not the
    // active bootstrap yet. Probe it directly when it is already present; do
    // not accidentally prove the directory only against the old PATH Node.
    // If the user selected an empty target, installation is still pending and
    // `start_gateway_locked` repeats this exact probe after installation.
    if let Some(node) = candidate_node {
        return if node.is_file() {
            crate::commands::openclaw_state_dir::verify_node_state_directory(node, state_dir).await
        } else {
            crate::commands::openclaw_state_dir::verify_state_directory_basics(state_dir)
        };
    }
    match crate::commands::system::check_node().await {
        Ok(node) if node.available => match node.path {
            Some(path) => {
                crate::commands::openclaw_state_dir::verify_node_state_directory(
                    Path::new(&path),
                    state_dir,
                )
                .await
            }
            None => crate::commands::openclaw_state_dir::verify_state_directory_basics(state_dir),
        },
        _ => crate::commands::openclaw_state_dir::verify_state_directory_basics(state_dir),
    }
}

fn candidate_node_path(layout: &StorageBootstrap) -> Option<PathBuf> {
    layout
        .node_runtime_dir
        .as_deref()
        .map(paths::node_binary_for_runtime_dir)
}

async fn verify_layout_storage_capability(layout: &StorageBootstrap) -> Result<(), String> {
    let candidate_node = candidate_node_path(layout);
    verify_state_directory_capability(
        &layout.state_dir,
        layout.runtime_mode,
        candidate_node.as_deref(),
    )
    .await?;
    let Some(config_parent) = layout.config_path.parent() else {
        return Err("OpenClaw config path has no parent directory".into());
    };
    if !paths::paths_refer_to_same_location(config_parent, &layout.state_dir) {
        verify_state_directory_capability(
            config_parent,
            layout.runtime_mode,
            candidate_node.as_deref(),
        )
        .await?;
    }
    for (label, path) in [
        ("workspace", &layout.workspace_dir),
        ("OpenClaw internal runtime", &layout.runtime_dir),
    ] {
        if !paths::paths_refer_to_same_location(path, &layout.state_dir) {
            verify_directory_write_and_rename(path, label)?;
        }
    }
    if let Some(cache) = &layout.npm_cache_dir {
        verify_directory_write_and_rename(cache, "npm cache")?;
    }
    if let Some(prefix) = &layout.npm_prefix {
        verify_npm_prefix_capability(prefix)?;
    }
    for (label, runtime) in [
        ("custom Node.js runtime", layout.node_runtime_dir.as_ref()),
        ("custom Git runtime", layout.git_runtime_dir.as_ref()),
    ] {
        if let Some(runtime) = runtime {
            verify_directory_write_and_rename(runtime, label)?;
            let parent = runtime
                .parent()
                .ok_or_else(|| format!("{label} directory {} has no parent", runtime.display()))?;
            verify_directory_write_and_rename(parent, &format!("{label} parent"))?;
        }
    }
    Ok(())
}

fn ensure_layout_directories(layout: &StorageBootstrap) -> Result<(), String> {
    for (label, path) in [
        ("OpenClaw state", &layout.state_dir),
        ("workspace", &layout.workspace_dir),
        ("OpenClaw internal runtime", &layout.runtime_dir),
    ] {
        std::fs::create_dir_all(path).map_err(|error| {
            format!(
                "Failed to create {} directory {}: {}",
                label,
                path.display(),
                error
            )
        })?;
    }
    if let Some(cache) = &layout.npm_cache_dir {
        std::fs::create_dir_all(cache).map_err(|error| {
            format!(
                "Failed to create npm cache directory {}: {}",
                cache.display(),
                error
            )
        })?;
    }
    if let Some(prefix) = &layout.npm_prefix {
        std::fs::create_dir_all(prefix).map_err(|error| {
            format!(
                "Failed to create npm prefix {}: {}",
                prefix.display(),
                error
            )
        })?;
    }
    for (label, path) in [
        ("custom Node.js runtime", layout.node_runtime_dir.as_ref()),
        ("custom Git runtime", layout.git_runtime_dir.as_ref()),
    ] {
        let Some(path) = path else { continue };
        std::fs::create_dir_all(path).map_err(|error| {
            format!(
                "Failed to create {} directory {}: {}",
                label,
                path.display(),
                error
            )
        })?;
    }
    Ok(())
}

fn map_workspace_to_target(workspace: &Path, source: &Path, target: &Path) -> Option<PathBuf> {
    fn relative_components(path: &Path, base: &Path) -> Option<PathBuf> {
        let path_components = path.components().collect::<Vec<_>>();
        let base_components = base.components().collect::<Vec<_>>();
        if path_components.len() < base_components.len() {
            return None;
        }
        let matches = path_components
            .iter()
            .zip(base_components.iter())
            .all(|(path, base)| {
                #[cfg(windows)]
                {
                    path.as_os_str()
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&base.as_os_str().to_string_lossy())
                }
                #[cfg(not(windows))]
                {
                    path == base
                }
            });
        if !matches {
            return None;
        }
        let mut relative = PathBuf::new();
        for component in path_components.into_iter().skip(base_components.len()) {
            relative.push(component.as_os_str());
        }
        Some(relative)
    }

    relative_components(workspace, source)
        .or_else(|| {
            std::fs::canonicalize(source)
                .ok()
                .and_then(|canonical| relative_components(workspace, &canonical))
        })
        .map(|relative| target.join(relative))
}

fn config_path_for_storage_change(
    current_config: &Path,
    source: &Path,
    target: &Path,
    migrate_existing: bool,
) -> PathBuf {
    if paths::paths_refer_to_same_location(source, target) {
        return current_config.to_path_buf();
    }
    if migrate_existing {
        return map_workspace_to_target(current_config, source, target)
            .unwrap_or_else(|| current_config.to_path_buf());
    }
    // An explicit process-level override remains authoritative and cannot be
    // replaced by bootstrap.json. Preserve it instead of creating a second
    // config that the selected OpenClaw runtime would never read.
    if paths::explicit_config_path_override()
        .ok()
        .flatten()
        .is_some()
    {
        current_config.to_path_buf()
    } else {
        paths::config_path_for_runtime(target, OpenClawRuntimeMode::Native)
    }
}

fn runtime_config_path_for_layout(layout: &StorageBootstrap) -> PathBuf {
    match layout.runtime_mode {
        OpenClawRuntimeMode::Native => layout.config_path.clone(),
        OpenClawRuntimeMode::Docker => {
            paths::config_path_for_runtime(&layout.state_dir, OpenClawRuntimeMode::Docker)
        }
    }
}

fn configured_workspace(source: &Path, target: &Path, config_path: &Path) -> PathBuf {
    let source_default = source.join("workspace");
    let configured = paths::read_workspace_from_config_relative_to(config_path);
    match configured {
        // An external config remains authoritative during storage migration.
        // Do not rewrite its workspace implicitly; doing so would require a
        // separate transactional update outside the state-directory copy.
        Some(workspace) if !paths::paths_overlap(config_path, source) => workspace,
        Some(workspace) => map_workspace_to_target(&workspace, source, target).unwrap_or(workspace),
        None => target.join(
            source_default
                .strip_prefix(source)
                .unwrap_or_else(|_| Path::new("workspace")),
        ),
    }
}

fn patch_workspace_for_runtime(
    config_path: &Path,
    workspace_dir: &Path,
    runtime_mode: OpenClawRuntimeMode,
) -> Result<(), String> {
    if matches!(runtime_mode, OpenClawRuntimeMode::Docker) {
        return crate::commands::docker::normalize_docker_config_runtime_paths(config_path);
    }
    patch_configured_workspace(config_path, workspace_dir)
}

fn patch_configured_workspace(config_path: &Path, workspace_dir: &Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(config_path).map_err(|error| {
        format!(
            "Failed to read migrated config {}: {}",
            config_path.display(),
            error
        )
    })?;
    let mut config = crate::commands::config::parse_openclaw_config(&raw).map_err(|error| {
        format!(
            "Failed to parse migrated config {}: {}",
            config_path.display(),
            error
        )
    })?;
    let root = config
        .as_object_mut()
        .ok_or("OpenClaw configuration root must be an object")?;
    let agents = root
        .entry("agents")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("OpenClaw agents configuration must be an object")?;
    let defaults = agents
        .entry("defaults")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("OpenClaw agent defaults must be an object")?;
    defaults.insert(
        "workspace".into(),
        serde_json::Value::String(workspace_dir.to_string_lossy().to_string()),
    );
    crate::commands::config::write_openclaw_config_value(config_path, &config).map_err(|error| {
        format!(
            "Failed to update migrated workspace in {}: {}",
            config_path.display(),
            error
        )
    })
}

/// Whether this storage transaction must write the Native workspace setting.
/// External Native configs are never owned by the storage transaction, and a
/// workspace that already resolves to the candidate directory must not be
/// serialized again for a Node/Git/npm-only reconfiguration.
fn native_workspace_write_required(
    config_path: &Path,
    layout: &StorageBootstrap,
) -> Result<bool, String> {
    if !paths::paths_overlap(config_path, &layout.state_dir) || !config_path.exists() {
        return Ok(false);
    }
    let raw = std::fs::read_to_string(config_path).map_err(|error| {
        format!(
            "Failed to read OpenClaw config {} before reconfiguration: {error}",
            config_path.display()
        )
    })?;
    let config = crate::commands::config::parse_openclaw_config(&raw).map_err(|error| {
        format!(
            "Failed to parse OpenClaw config {} before reconfiguration: {error}",
            config_path.display()
        )
    })?;
    let current_workspace = config
        .get("agents")
        .and_then(|agents| agents.get("defaults"))
        .and_then(|defaults| defaults.get("workspace"))
        .and_then(serde_json::Value::as_str);
    Ok(!current_workspace
        .is_some_and(|workspace| configured_workspace_matches(workspace, &layout.workspace_dir)))
}

/// Compare a configured workspace with an absolute layout path using the same
/// path semantics as every JunQi-managed OpenClaw command. OpenClaw accepts
/// `~` and relative workspace values, so comparing `Path::new(value)` directly
/// would bind them to JunQi's incidental process cwd instead of the stable
/// OpenClaw cwd.
fn configured_workspace_matches(configured: &str, expected: &Path) -> bool {
    paths::resolve_openclaw_user_path(configured)
        .is_ok_and(|resolved| paths::paths_refer_to_same_location(&resolved, expected))
}

struct TextFileSnapshot {
    path: PathBuf,
    original: Option<String>,
    transaction_hash: Option<Vec<u8>>,
}

enum SnapshotRestore {
    Restored,
    Unchanged,
    PreservedExternalChange,
}

impl TextFileSnapshot {
    fn capture(path: &Path) -> Result<Self, String> {
        let original = match std::fs::read_to_string(path) {
            Ok(content) => Some(content),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!(
                    "Failed to snapshot {} before reconfiguration: {}",
                    path.display(),
                    error
                ))
            }
        };
        Ok(Self {
            path: path.to_path_buf(),
            original,
            transaction_hash: None,
        })
    }

    fn record_transaction_write(&mut self) -> Result<(), String> {
        self.transaction_hash = match std::fs::read(&self.path) {
            Ok(content) => Some(Sha256::digest(content).to_vec()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!(
                    "Failed to record transactional write to {}: {}",
                    self.path.display(),
                    error
                ))
            }
        };
        Ok(())
    }

    fn restore(&self) -> Result<SnapshotRestore, String> {
        let Some(transaction_hash) = self.transaction_hash.as_ref() else {
            return Ok(SnapshotRestore::Unchanged);
        };
        let current_hash = match std::fs::read(&self.path) {
            Ok(content) => Some(Sha256::digest(content).to_vec()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                return Err(format!(
                    "Failed to inspect {} during rollback: {}",
                    self.path.display(),
                    error
                ))
            }
        };
        if current_hash.as_ref() != Some(transaction_hash) {
            return Ok(SnapshotRestore::PreservedExternalChange);
        }
        match &self.original {
            Some(content) => {
                paths::atomic_write_text(&self.path, content).map(|_| SnapshotRestore::Restored)
            }
            None if self.path.exists() => std::fs::remove_file(&self.path)
                .map_err(|error| {
                    format!(
                        "Failed to remove {} during rollback: {}",
                        self.path.display(),
                        error
                    )
                })
                .map(|_| SnapshotRestore::Restored),
            None => Ok(SnapshotRestore::Restored),
        }
    }
}

struct StorageReconfiguration {
    old_bootstrap: Option<StorageBootstrap>,
    config_snapshots: Vec<RuntimeConfigSnapshot>,
    created_directories: Vec<PathBuf>,
}

/// Defines which durable state survives a storage-transaction failure. Normal
/// storage changes can restore the prior bootstrap immediately. A pending
/// Native runtime relocation must retain its memento until the Gateway/service
/// recovery coordinator has restored the prior contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StorageReconfigurationFailurePolicy {
    RestorePreviousBootstrap,
    PreservePendingRuntimeReconfiguration,
}

struct RuntimeConfigSnapshot {
    file: TextFileSnapshot,
    mode: OpenClawRuntimeMode,
    should_patch: bool,
}

trait ReconfigurationOperations {
    fn ensure_layout(layout: &StorageBootstrap) -> Result<(), String>;
    fn patch_workspace(
        config_path: &Path,
        workspace_dir: &Path,
        runtime_mode: OpenClawRuntimeMode,
    ) -> Result<(), String>;
    fn save_bootstrap(layout: &StorageBootstrap) -> Result<(), String>;
    fn restore_bootstrap(old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String>;
    async fn sync_terminal() -> Result<(), String>;
}

struct SystemReconfigurationOperations;

impl ReconfigurationOperations for SystemReconfigurationOperations {
    fn ensure_layout(layout: &StorageBootstrap) -> Result<(), String> {
        ensure_layout_directories(layout)
    }

    fn patch_workspace(
        config_path: &Path,
        workspace_dir: &Path,
        runtime_mode: OpenClawRuntimeMode,
    ) -> Result<(), String> {
        patch_workspace_for_runtime(config_path, workspace_dir, runtime_mode)
    }

    fn save_bootstrap(layout: &StorageBootstrap) -> Result<(), String> {
        paths::save_storage_bootstrap(layout)
    }

    fn restore_bootstrap(old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String> {
        restore_bootstrap(old_bootstrap)
    }

    async fn sync_terminal() -> Result<(), String> {
        crate::commands::terminal_integration::sync_terminal_integration()
            .await
            .map(|_| ())
    }
}

impl StorageReconfiguration {
    fn begin(
        old_bootstrap: Option<StorageBootstrap>,
        config_path: &Path,
        layout: &StorageBootstrap,
    ) -> Result<Self, String> {
        let mut created_directories = layout_directories(layout)
            .into_iter()
            .filter(|path| !path.exists())
            .collect::<Vec<_>>();
        created_directories.sort_by(|left, right| {
            right
                .components()
                .count()
                .cmp(&left.components().count())
                .then_with(|| left.cmp(right))
        });
        created_directories.dedup();
        let mut config_contracts = vec![(config_path.to_path_buf(), layout.runtime_mode)];
        if matches!(layout.runtime_mode, OpenClawRuntimeMode::Docker)
            && !paths::paths_refer_to_same_location(config_path, &layout.config_path)
        {
            // Docker's active file contains container paths, while the Native
            // file must retain the selected host workspace for a future mode
            // switch. Update and roll back both as one transaction.
            config_contracts.push((layout.config_path.clone(), OpenClawRuntimeMode::Native));
        }
        let config_snapshots = config_contracts
            .into_iter()
            .map(|(path, mode)| {
                let should_patch = match mode {
                    OpenClawRuntimeMode::Native => native_workspace_write_required(&path, layout)?,
                    OpenClawRuntimeMode::Docker => true,
                };
                TextFileSnapshot::capture(&path).map(|file| RuntimeConfigSnapshot {
                    file,
                    mode,
                    should_patch,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Self {
            old_bootstrap,
            config_snapshots,
            created_directories,
        })
    }

    async fn apply(self, layout: &StorageBootstrap, sync_terminal: bool) -> Result<(), String> {
        self.apply_with_policy::<SystemReconfigurationOperations>(
            layout,
            sync_terminal,
            StorageReconfigurationFailurePolicy::RestorePreviousBootstrap,
        )
        .await
    }

    /// Apply the candidate layout while preserving the durable relocation
    /// memento on failure. The caller must then use the runtime recovery
    /// coordinator, which owns process shutdown and previous-service restore.
    async fn apply_pending_runtime_reconfiguration(
        self,
        layout: &StorageBootstrap,
    ) -> Result<(), String> {
        self.apply_with_policy::<SystemReconfigurationOperations>(
            layout,
            false,
            StorageReconfigurationFailurePolicy::PreservePendingRuntimeReconfiguration,
        )
        .await
    }

    fn writes_native_workspace(&self) -> bool {
        self.config_snapshots.iter().any(|snapshot| {
            matches!(snapshot.mode, OpenClawRuntimeMode::Native) && snapshot.should_patch
        })
    }

    #[cfg(test)]
    async fn apply_with<O: ReconfigurationOperations>(
        self,
        layout: &StorageBootstrap,
        sync_terminal: bool,
    ) -> Result<(), String> {
        self.apply_with_policy::<O>(
            layout,
            sync_terminal,
            StorageReconfigurationFailurePolicy::RestorePreviousBootstrap,
        )
        .await
    }

    async fn apply_with_policy<O: ReconfigurationOperations>(
        mut self,
        layout: &StorageBootstrap,
        sync_terminal: bool,
        failure_policy: StorageReconfigurationFailurePolicy,
    ) -> Result<(), String> {
        let result = self.apply_changes::<O>(layout, sync_terminal).await;
        match result {
            Ok(()) => Ok(()),
            Err(error) => Err(self.rollback::<O>(error, failure_policy).await),
        }
    }

    async fn apply_changes<O: ReconfigurationOperations>(
        &mut self,
        layout: &StorageBootstrap,
        sync_terminal: bool,
    ) -> Result<(), String> {
        O::ensure_layout(layout)?;
        for snapshot in &mut self.config_snapshots {
            if !snapshot.should_patch {
                continue;
            }
            O::patch_workspace(&snapshot.file.path, &layout.workspace_dir, snapshot.mode)?;
            snapshot.file.record_transaction_write()?;
        }
        O::save_bootstrap(layout)?;
        if sync_terminal {
            O::sync_terminal().await?;
        }
        Ok(())
    }

    async fn rollback<O: ReconfigurationOperations>(
        &self,
        failure: String,
        failure_policy: StorageReconfigurationFailurePolicy,
    ) -> String {
        let mut errors = Vec::new();
        if matches!(
            failure_policy,
            StorageReconfigurationFailurePolicy::RestorePreviousBootstrap
        ) {
            if let Err(error) = O::restore_bootstrap(self.old_bootstrap.as_ref()) {
                errors.push(format!("restore bootstrap: {}", error));
            }
        }
        for snapshot in self.config_snapshots.iter().rev() {
            match snapshot.file.restore() {
                Ok(SnapshotRestore::Restored | SnapshotRestore::Unchanged) => {}
                Ok(SnapshotRestore::PreservedExternalChange) => errors.push(format!(
                    "preserve externally changed OpenClaw config {}",
                    snapshot.file.path.display()
                )),
                Err(error) => errors.push(format!("restore OpenClaw config: {}", error)),
            }
        }
        if let Err(error) = O::sync_terminal().await {
            errors.push(format!("restore terminal integration: {}", error));
        }
        for path in &self.created_directories {
            match std::fs::remove_dir(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => errors.push(format!(
                    "remove newly created directory {}: {}",
                    path.display(),
                    error
                )),
            }
        }
        if errors.is_empty() {
            failure
        } else {
            format!("{}; rollback issues: {}", failure, errors.join("; "))
        }
    }
}

fn layout_directories(layout: &StorageBootstrap) -> Vec<PathBuf> {
    let mut directories = vec![
        layout.state_dir.clone(),
        layout.workspace_dir.clone(),
        layout.runtime_dir.clone(),
    ];
    if let Some(cache) = &layout.npm_cache_dir {
        directories.push(cache.clone());
    }
    if let Some(prefix) = &layout.npm_prefix {
        directories.push(prefix.clone());
    }
    if let Some(node_runtime) = &layout.node_runtime_dir {
        directories.push(node_runtime.clone());
    }
    if let Some(git_runtime) = &layout.git_runtime_dir {
        directories.push(git_runtime.clone());
    }
    directories
}

struct StagedDirectory {
    path: PathBuf,
    activated: bool,
}

impl StagedDirectory {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            activated: false,
        }
    }

    fn activate(&mut self, target: &Path) -> Result<(), String> {
        if target.exists() {
            std::fs::remove_dir(target)
                .map_err(|error| format!("Failed to prepare target directory: {}", error))?;
        }
        std::fs::rename(&self.path, target)
            .map_err(|error| format!("Failed to activate migrated directory: {}", error))?;
        self.activated = true;
        Ok(())
    }
}

impl Drop for StagedDirectory {
    fn drop(&mut self) {
        if !self.activated && self.path.exists() {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

#[derive(Debug)]
struct PreparedStorage {
    layout: StorageBootstrap,
    copied: DirectoryStats,
}

fn verify_and_patch_migrated_config(
    copy_source: &Path,
    target: &Path,
    stage: &Path,
    config_path: &Path,
    workspace_dir: &Path,
    mode: OpenClawRuntimeMode,
) -> Result<(), String> {
    let relative_to_target = config_path.strip_prefix(target).ok();
    let source_config = relative_to_target
        .map(|relative| copy_source.join(relative))
        .unwrap_or_else(|| config_path.to_path_buf());
    let copied_config = relative_to_target
        .map(|relative| stage.join(relative))
        .unwrap_or_else(|| config_path.to_path_buf());
    if source_config.exists()
        && (!copied_config.exists() || hash_file(&source_config)? != hash_file(&copied_config)?)
    {
        return Err(format!(
            "Migration verification failed for {} OpenClaw config",
            match mode {
                OpenClawRuntimeMode::Native => "Native",
                OpenClawRuntimeMode::Docker => "Docker",
            }
        ));
    }
    if copied_config.starts_with(stage) {
        patch_workspace_for_runtime(&copied_config, workspace_dir, mode)?;
    }
    Ok(())
}

fn prepare_storage_target(
    source: &Path,
    target: &Path,
    migrate_existing: bool,
    layout: StorageBootstrap,
) -> Result<PreparedStorage, String> {
    // Bootstrap owns the Native config path. Docker's config is derived from
    // the selected state root below and is never persisted over that field.
    let copied = if migrate_existing {
        let stage_path = target.with_file_name(format!(
            ".{}-junqi-migrating-{}",
            target
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("openclaw"),
            uuid::Uuid::new_v4()
        ));
        let mut stage = StagedDirectory::new(stage_path);
        let copy_source = if std::fs::symlink_metadata(source)
            .map(|metadata| metadata.file_type().is_symlink())
            .unwrap_or(false)
        {
            std::fs::canonicalize(source).map_err(|error| {
                format!(
                    "Failed to resolve storage source {}: {}",
                    source.display(),
                    error
                )
            })?
        } else {
            source.to_path_buf()
        };
        copy_tree(&copy_source, &stage.path)?;

        let source_stats = collect_stats(&copy_source)?;
        let stage_stats = collect_stats(&stage.path)?;
        if source_stats != stage_stats {
            return Err(format!(
                "Migration verification failed: source={:?}, copied={:?}",
                source_stats, stage_stats
            ));
        }
        verify_and_patch_migrated_config(
            &copy_source,
            target,
            &stage.path,
            &layout.config_path,
            &layout.workspace_dir,
            OpenClawRuntimeMode::Native,
        )?;
        verify_and_patch_migrated_config(
            &copy_source,
            target,
            &stage.path,
            &paths::config_path_for_runtime(&layout.state_dir, OpenClawRuntimeMode::Docker),
            &layout.workspace_dir,
            OpenClawRuntimeMode::Docker,
        )?;
        stage.activate(target)?;
        source_stats
    } else {
        std::fs::create_dir_all(target)
            .map_err(|error| format!("Failed to create storage directory: {}", error))?;
        DirectoryStats::default()
    };
    ensure_layout_directories(&layout)?;
    Ok(PreparedStorage { layout, copied })
}

async fn stop_all_locked(
    state: &State<'_, GatewayProcess>,
    binary: Option<&Path>,
    state_dir: &Path,
    service_config_path: &Path,
    selected_service: bool,
) -> Result<(), String> {
    let service_runtime = if selected_service {
        let binary = binary.ok_or_else(|| {
            "OpenClaw binary is unavailable; cannot stop the selected Gateway service".to_string()
        })?;
        Some(
            crate::commands::system::compatible_native_openclaw_runtime(binary.to_path_buf())
                .await?,
        )
    } else {
        None
    };
    stop_all_locked_with_service_runtime(
        state,
        service_runtime.as_ref(),
        state_dir,
        service_config_path,
        selected_service,
    )
    .await
}

/// Stop managed processes and, when needed, a verified official service using
/// an explicit runtime contract. Recovery supplies the previous contract here
/// because a candidate Node/npm installation may not exist yet.
async fn stop_all_locked_with_service_runtime(
    state: &State<'_, GatewayProcess>,
    service_runtime: Option<&crate::commands::system::NativeOpenclawRuntime>,
    state_dir: &Path,
    service_config_path: &Path,
    selected_service: bool,
) -> Result<(), String> {
    let child = state.child.lock().ok().and_then(|mut child| child.take());
    if let Some(mut child) = child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
    }
    if matches!(paths::active_runtime_mode(), OpenClawRuntimeMode::Docker) {
        crate::commands::docker::stop_docker_gateway_locked().await?;
    }
    if selected_service {
        let runtime = service_runtime.ok_or_else(|| {
            "OpenClaw binary is unavailable; cannot stop the selected Gateway service".to_string()
        })?;
        if !crate::commands::gateway_service::stop_selected_gateway_service(
            runtime,
            state_dir,
            service_config_path,
            None,
        )
        .await?
        {
            return Err(
                "The selected Gateway service changed before it could be stopped; storage was not modified"
                    .to_string(),
            );
        }
    }
    state.transition(
        Some(GatewayLifecycle::Stopped),
        Some(GatewayRuntimeMode::None),
        None,
        "storage migration: all managed runtimes stopped",
    );
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct PreviousGateway {
    reachable: bool,
    runtime: GatewayRuntimeState,
    /// The persisted user selection survives a cold start, unlike the
    /// in-memory process snapshot. It is the authority for rollback when a
    /// Docker Gateway is already reachable before JunQi has observed it.
    selected_runtime: OpenClawRuntimeMode,
    port: u16,
    selected_service: SelectedGatewayService,
}

impl PreviousGateway {
    /// Restore the runtime selected by the user, not whichever native service
    /// happens to be registered on the machine. A native official service is
    /// preserved independently below because it can coexist with Docker.
    fn restore_mode(self) -> GatewayRuntimeMode {
        match self.selected_runtime {
            OpenClawRuntimeMode::Docker => GatewayRuntimeMode::Docker,
            OpenClawRuntimeMode::Native if self.selected_service.running => {
                GatewayRuntimeMode::SystemService
            }
            // An installed-but-stopped official service does not own the
            // endpoint that was observed before migration. Native recovery
            // restarts the foreground child instead of promoting that stopped
            // registration or an unrelated historical Docker observation.
            OpenClawRuntimeMode::Native => match self.runtime.mode {
                GatewayRuntimeMode::ManagedChild => GatewayRuntimeMode::ManagedChild,
                GatewayRuntimeMode::SystemService
                | GatewayRuntimeMode::Docker
                | GatewayRuntimeMode::External
                | GatewayRuntimeMode::None => GatewayRuntimeMode::ManagedChild,
            },
        }
    }

    fn selected_runtime_was_running(self) -> bool {
        match self.selected_runtime {
            // During a cold start GatewayProcess is still `None`, but a
            // health probe against Docker's active config is authoritative.
            OpenClawRuntimeMode::Docker => {
                self.reachable || matches!(self.runtime.mode, GatewayRuntimeMode::Docker)
            }
            OpenClawRuntimeMode::Native => {
                self.selected_service.running
                    || self.reachable
                    || matches!(
                        self.runtime.lifecycle,
                        GatewayLifecycle::Running
                            | GatewayLifecycle::Starting
                            | GatewayLifecycle::Reconnecting
                    )
            }
        }
    }
}

fn pending_gateway_recovery(
    previous: PreviousGateway,
    native_service_runtime: Option<&crate::commands::system::NativeOpenclawRuntime>,
) -> paths::PendingGatewayRecovery {
    paths::PendingGatewayRecovery {
        selected_runtime: previous.selected_runtime,
        port: previous.port,
        selected_runtime_was_running: previous.selected_runtime_was_running(),
        selected_service_installed: previous.selected_service.installed,
        selected_service_was_running: previous.selected_service.running,
        native_service_launch: native_service_runtime
            .map(crate::commands::system::NativeOpenclawRuntime::gateway_service_launch_contract),
    }
}

fn previous_gateway_from_pending(pending: paths::PendingGatewayRecovery) -> PreviousGateway {
    let runtime_mode = match pending.selected_runtime {
        OpenClawRuntimeMode::Docker => GatewayRuntimeMode::Docker,
        OpenClawRuntimeMode::Native if pending.selected_service_was_running => {
            GatewayRuntimeMode::SystemService
        }
        OpenClawRuntimeMode::Native => GatewayRuntimeMode::ManagedChild,
    };
    PreviousGateway {
        reachable: pending.selected_runtime_was_running,
        runtime: GatewayRuntimeState {
            lifecycle: if pending.selected_runtime_was_running {
                GatewayLifecycle::Running
            } else {
                GatewayLifecycle::Stopped
            },
            mode: runtime_mode,
            restarting: false,
        },
        selected_runtime: pending.selected_runtime,
        port: pending.port,
        selected_service: SelectedGatewayService {
            installed: pending.selected_service_installed,
            running: pending.selected_service_was_running,
        },
    }
}

fn selected_runtime_restored_by_service(
    previous: PreviousGateway,
    service_restore_succeeded: bool,
) -> bool {
    matches!(previous.selected_runtime, OpenClawRuntimeMode::Native)
        && previous.selected_service.running
        && service_restore_succeeded
}

/// The three paths a restored runtime needs have different responsibilities:
/// state owns OpenClaw data, active config owns health checks, and Native
/// config identifies an official platform service. Passing them together
/// prevents Docker recovery from accidentally using the service config as its
/// active health contract.
#[derive(Clone, Copy)]
struct GatewayRuntimePaths<'a> {
    state_dir: &'a Path,
    config_path: &'a Path,
    service_config_path: &'a Path,
}

/// A rollback can reuse a health-checked endpoint from the same immutable
/// layout. A migration cannot: copied Gateway credentials make an old state
/// directory look healthy, so the new layout must prove ownership by starting
/// its selected runtime rather than accepting a token-only probe.
#[derive(Clone, Copy)]
enum RuntimeStartPolicy {
    ReuseVerifiedEndpoint,
    RequireFreshOwner,
}

async fn restore_gateway_after_stop_failure(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    previous: PreviousGateway,
    binary: Option<&Path>,
    paths: GatewayRuntimePaths<'_>,
    failure: String,
) -> String {
    append_rollback_errors(
        failure,
        restore_previous_gateway(app, state, previous, binary, paths).await,
    )
}

async fn stop_all_locked_with_compensation(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    previous: PreviousGateway,
    binary: Option<&Path>,
    state_dir: &Path,
    config_path: &Path,
    native_config_path: &Path,
) -> Result<(), String> {
    match stop_all_locked(
        state,
        binary,
        state_dir,
        native_config_path,
        previous.selected_service.running,
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(error) => Err(restore_gateway_after_stop_failure(
            app,
            state,
            previous,
            binary,
            GatewayRuntimePaths {
                state_dir,
                config_path,
                service_config_path: native_config_path,
            },
            error,
        )
        .await),
    }
}

#[derive(Debug, Clone, Copy, Default)]
struct SelectedGatewayService {
    installed: bool,
    running: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RuntimeRestoreStrategy {
    Docker,
    ManagedChild,
    SystemService,
}

impl RuntimeRestoreStrategy {
    fn for_mode(mode: GatewayRuntimeMode) -> Self {
        match mode {
            GatewayRuntimeMode::Docker => Self::Docker,
            GatewayRuntimeMode::SystemService => Self::SystemService,
            GatewayRuntimeMode::ManagedChild
            | GatewayRuntimeMode::External
            | GatewayRuntimeMode::None => Self::ManagedChild,
        }
    }

    fn restored_mode(self) -> GatewayRuntimeMode {
        match self {
            Self::Docker => GatewayRuntimeMode::Docker,
            Self::ManagedChild => GatewayRuntimeMode::ManagedChild,
            Self::SystemService => GatewayRuntimeMode::SystemService,
        }
    }
}

async fn wait_for_gateway(port: u16, config_path: &Path, attempts: usize) -> Result<(), String> {
    for _ in 0..attempts {
        if crate::commands::gateway::gateway_matches_config(port, config_path).await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err(format!("Gateway did not become reachable on port {}", port))
}

async fn selected_gateway_service(
    binary: Option<&Path>,
    state_dir: &Path,
    native_config_path: &Path,
    runtime_mode: OpenClawRuntimeMode,
) -> Result<SelectedGatewayService, String> {
    let Some(binary) = binary else {
        if matches!(runtime_mode, OpenClawRuntimeMode::Docker) {
            // A Docker-only installation intentionally has no host OpenClaw
            // package. Native service ownership is deferred until a Native
            // runtime is selected; Docker startup will still fail closed if
            // an unknown process owns the configured port.
            return Ok(SelectedGatewayService::default());
        }
        return Err(
            "OpenClaw is not available to verify the selected official Gateway service; storage changes were not started"
                .to_string(),
        );
    };
    let runtime =
        crate::commands::system::compatible_native_openclaw_runtime(binary.to_path_buf()).await?;
    let identity = crate::commands::gateway_service::GatewayServiceIdentity::for_runtime(
        state_dir,
        native_config_path,
        &runtime,
    );
    let inspection =
        crate::commands::gateway_service::inspect_gateway_service_state(&runtime, &identity, None)
            .await?;
    let selected =
        crate::commands::gateway_service::belongs_to_selected_state(inspection.ownership);
    if inspection.installed && !selected {
        return Err(
            "An installed Gateway service belongs to another or unverifiable state/config; storage was not changed"
                .into(),
        );
    }
    let installed = selected && inspection.installed;
    let port = crate::commands::gateway::gateway_port_for_config(native_config_path);
    Ok(SelectedGatewayService {
        installed,
        running: installed
            && (inspection.running
                || crate::commands::gateway::gateway_matches_config(port, native_config_path)
                    .await),
    })
}

async fn start_runtime_locked(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    mode: GatewayRuntimeMode,
    port: u16,
    binary: Option<&Path>,
    paths: GatewayRuntimePaths<'_>,
    start_policy: RuntimeStartPolicy,
) -> Result<(), String> {
    let strategy = if matches!(mode, GatewayRuntimeMode::SystemService) {
        RuntimeRestoreStrategy::SystemService
    } else {
        RuntimeRestoreStrategy::for_mode(mode)
    };
    let health_config_path = if matches!(strategy, RuntimeRestoreStrategy::SystemService) {
        paths.service_config_path
    } else {
        paths.config_path
    };
    if matches!(start_policy, RuntimeStartPolicy::ReuseVerifiedEndpoint)
        && crate::commands::gateway::gateway_matches_config(port, health_config_path).await
    {
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(mode),
            None,
            "storage transaction: existing runtime is reachable",
        );
        return Ok(());
    }

    match strategy {
        RuntimeRestoreStrategy::Docker => {
            crate::commands::docker::start_docker_gateway_locked(app.clone(), Some(port), None)
                .await?;
            state.transition(
                Some(GatewayLifecycle::Running),
                Some(GatewayRuntimeMode::Docker),
                None,
                "storage transaction: Docker runtime restored",
            );
        }
        RuntimeRestoreStrategy::ManagedChild => {
            crate::commands::gateway::start_managed_gateway_locked(
                app.clone(),
                app.state::<GatewayProcess>(),
                Some(port),
            )
            .await?;
        }
        RuntimeRestoreStrategy::SystemService => {
            let binary = binary.ok_or_else(|| {
                "OpenClaw binary is unavailable; cannot restore the Gateway service".to_string()
            })?;
            let runtime =
                crate::commands::system::compatible_native_openclaw_runtime(binary.to_path_buf())
                    .await?;
            crate::commands::gateway_service::install_and_start_selected_gateway_service(
                &runtime,
                paths.state_dir,
                paths.service_config_path,
                port,
            )
            .await?;
            state.transition(
                Some(GatewayLifecycle::Starting),
                Some(GatewayRuntimeMode::SystemService),
                None,
                "storage transaction: Gateway service starting",
            );
        }
    }

    wait_for_gateway(
        port,
        health_config_path,
        crate::commands::gateway::native_gateway_readiness_timeout_secs() as usize,
    )
    .await?;
    let final_mode = strategy.restored_mode();
    state.transition(
        Some(GatewayLifecycle::Running),
        Some(final_mode),
        None,
        "storage transaction: Gateway runtime healthy",
    );
    Ok(())
}

/// Restore the platform service independently from the runtime selected by
/// the user. A Native service can remain registered while Docker is active;
/// restoring one must never substitute for restoring the other.
async fn restore_previous_gateway(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    previous: PreviousGateway,
    binary: Option<&Path>,
    paths: GatewayRuntimePaths<'_>,
) -> Vec<String> {
    let mut errors = Vec::new();
    let mut service_restore_succeeded = false;

    if previous.selected_service.installed {
        let service_restore = async {
            let binary = binary.ok_or_else(|| {
                "OpenClaw binary is unavailable; cannot restore the selected Gateway service"
                    .to_string()
            })?;
            let runtime =
                crate::commands::system::compatible_native_openclaw_runtime(binary.to_path_buf())
                    .await?;
            let search_path = crate::commands::system::openclaw_search_path();
            crate::commands::gateway_service::install_selected_gateway_service_with_path(
                &runtime,
                paths.state_dir,
                paths.service_config_path,
                previous.port,
                Some(&search_path),
            )
            .await?;
            if previous.selected_service.running {
                crate::commands::gateway_service::start_selected_gateway_service_with_path(
                    &runtime,
                    paths.state_dir,
                    paths.service_config_path,
                    Some(&search_path),
                )
                .await?;
                wait_for_gateway(
                    previous.port,
                    paths.service_config_path,
                    crate::commands::gateway::native_gateway_readiness_timeout_secs() as usize,
                )
                .await?;
            } else {
                // `gateway install` may start the Windows task while
                // registering it. Preserve an intentionally stopped service.
                crate::commands::gateway_service::stop_selected_gateway_service(
                    &runtime,
                    paths.state_dir,
                    paths.service_config_path,
                    Some(&search_path),
                )
                .await?;
            }
            Ok::<(), String>(())
        }
        .await;
        match service_restore {
            Ok(()) => {
                service_restore_succeeded = true;
                if previous.selected_service.running {
                    state.transition(
                        Some(GatewayLifecycle::Running),
                        Some(GatewayRuntimeMode::SystemService),
                        None,
                        "storage transaction: previous Gateway service restored",
                    );
                }
            }
            Err(error) => errors.push(format!("restore previous Gateway service: {error}")),
        }
    }

    if !previous.selected_runtime_was_running()
        || selected_runtime_restored_by_service(previous, service_restore_succeeded)
    {
        return errors;
    }

    if let Err(error) = start_runtime_locked(
        app,
        state,
        previous.restore_mode(),
        previous.port,
        binary,
        paths,
        RuntimeStartPolicy::ReuseVerifiedEndpoint,
    )
    .await
    {
        errors.push(format!("restore selected Gateway runtime: {error}"));
    }
    errors
}

fn restore_bootstrap(old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String> {
    match old_bootstrap {
        Some(old) => paths::save_storage_bootstrap(old),
        None => paths::remove_storage_bootstrap(),
    }
}

/// A storage target may be an empty directory the user created before opening
/// JunQi, or a directory created by this transaction. Even the latter can
/// receive external writes while a long migration runs, so rollback preserves
/// it under a recovery sibling instead of recursively deleting it.
#[derive(Clone, Copy)]
enum TransactionTargetOwnership {
    Preexisting,
    CreatedByTransaction,
}

fn cleanup_transaction_target(
    target: &Path,
    ownership: TransactionTargetOwnership,
) -> Result<Option<PathBuf>, String> {
    if matches!(ownership, TransactionTargetOwnership::Preexisting) {
        return Ok(None);
    }
    crate::commands::directory_transaction::preserve_directory_for_recovery(
        target,
        "incomplete storage target",
    )
}

#[derive(Clone, Copy)]
enum BootstrapRollback {
    Unchanged,
    Restore,
}

#[derive(Clone, Copy)]
enum TerminalRollback {
    Unchanged,
    Resync,
}

#[derive(Clone, Copy)]
struct RollbackPolicy {
    bootstrap: BootstrapRollback,
    terminal: TerminalRollback,
}

impl RollbackPolicy {
    const FRESH_PREPARATION: Self = Self {
        bootstrap: BootstrapRollback::Unchanged,
        terminal: TerminalRollback::Unchanged,
    };
    const MIGRATION_PREPARATION: Self = Self {
        bootstrap: BootstrapRollback::Unchanged,
        terminal: TerminalRollback::Unchanged,
    };
    const AFTER_BOOTSTRAP_SAVE: Self = Self {
        bootstrap: BootstrapRollback::Unchanged,
        terminal: TerminalRollback::Unchanged,
    };
    const AFTER_SWITCH: Self = Self {
        bootstrap: BootstrapRollback::Restore,
        terminal: TerminalRollback::Resync,
    };
}

struct StorageRollbackContext<'a, 'state> {
    app: &'a AppHandle,
    state: &'a State<'state, GatewayProcess>,
    previous: PreviousGateway,
    old_bootstrap: Option<&'a StorageBootstrap>,
    old_state_dir: &'a Path,
    old_config_path: &'a Path,
    old_native_config_path: &'a Path,
    binary: Option<&'a Path>,
    target: &'a Path,
    target_ownership: TransactionTargetOwnership,
}

impl StorageRollbackContext<'_, '_> {
    async fn run(&self, policy: RollbackPolicy, failure: String) -> String {
        let mut errors = Vec::new();
        if matches!(policy.bootstrap, BootstrapRollback::Restore) {
            collect_rollback_error(
                &mut errors,
                "restore bootstrap",
                restore_bootstrap(self.old_bootstrap),
            );
        }
        match cleanup_transaction_target(self.target, self.target_ownership) {
            Ok(Some(recovery)) => errors.push(format!(
                "incomplete storage target was preserved for recovery at {}",
                recovery.display()
            )),
            Ok(None) => {}
            Err(error) => errors.push(format!("clean target: {error}")),
        }
        if matches!(policy.terminal, TerminalRollback::Resync) {
            if let Err(error) =
                crate::commands::terminal_integration::sync_terminal_integration().await
            {
                errors.push(format!("restore terminal integration: {}", error));
            }
        }
        self.restore_gateway(&mut errors).await;
        append_rollback_errors(failure, errors)
    }

    /// A Gateway/service activation may succeed far enough to retain the new
    /// state directory even when its caller receives an error. Confirm it is
    /// stopped and its port released before restoring bootstrap or deleting a
    /// transaction-owned target. If that cannot be proven, retain the new
    /// layout for explicit recovery instead of creating a live process with a
    /// deleted configuration tree.
    async fn run_after_gateway_activation(
        &self,
        policy: RollbackPolicy,
        layout: &StorageBootstrap,
        selected_service: bool,
        failure: String,
    ) -> String {
        if let Err(error) = stop_all_locked(
            self.state,
            self.binary,
            &layout.state_dir,
            &layout.config_path,
            selected_service,
        )
        .await
        {
            self.state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "storage rollback could not stop the new Gateway runtime",
            );
            return append_rollback_errors(
                failure,
                vec![format!(
                    "new Gateway runtime was not stopped; the new storage target was retained: {error}"
                )],
            );
        }
        if let Err(error) =
            crate::commands::gateway_supervisor::wait_for_port_free(self.previous.port, 30_000)
                .await
        {
            self.state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "storage rollback could not confirm the new Gateway port was released",
            );
            return append_rollback_errors(
                failure,
                vec![format!(
                    "new Gateway port was not released; the new storage target was retained: {error}"
                )],
            );
        }
        self.run(policy, failure).await
    }

    async fn restore_gateway(&self, errors: &mut Vec<String>) {
        let restore_errors = restore_previous_gateway(
            self.app,
            self.state,
            self.previous,
            self.binary,
            GatewayRuntimePaths {
                state_dir: self.old_state_dir,
                config_path: self.old_config_path,
                service_config_path: self.old_native_config_path,
            },
        )
        .await;
        if !restore_errors.is_empty() {
            errors.extend(restore_errors);
            self.state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "storage transaction rollback failed",
            );
        }
    }
}

fn collect_rollback_error(errors: &mut Vec<String>, operation: &str, result: Result<(), String>) {
    if let Err(error) = result {
        errors.push(format!("{}: {}", operation, error));
    }
}

fn append_rollback_errors(failure: String, errors: Vec<String>) -> String {
    if errors.is_empty() {
        failure
    } else {
        format!("{}; rollback issues: {}", failure, errors.join("; "))
    }
}

/// Restore only the workspace value JunQi wrote during a pending runtime
/// relocation. An external edit wins: if the config no longer points at the
/// candidate workspace, leave it untouched instead of replaying an old file
/// snapshot over the user's changes.
fn restore_workspace_if_still_owned(
    candidate: &StorageBootstrap,
    previous: &StorageBootstrap,
    native_workspace_written: bool,
) -> Result<bool, String> {
    if !native_workspace_written {
        return Ok(false);
    }
    // Runtime-location reconfiguration always patches the Native host config.
    // The user may subsequently select Docker before rollback, but that mode
    // choice must not redirect recovery to Docker's derived config file.
    let config_path = candidate.config_path.clone();
    let raw = match std::fs::read_to_string(&config_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(format!(
                "Failed to read {} while recovering runtime locations: {error}",
                config_path.display()
            ))
        }
    };
    let config = crate::commands::config::parse_openclaw_config(&raw).map_err(|error| {
        format!(
            "Failed to parse {} while recovering runtime locations: {error}",
            config_path.display()
        )
    })?;
    let current_workspace = config
        .get("agents")
        .and_then(|agents| agents.get("defaults"))
        .and_then(|defaults| defaults.get("workspace"))
        .and_then(serde_json::Value::as_str);
    let Some(current_workspace) = current_workspace else {
        return Ok(false);
    };
    if !configured_workspace_matches(current_workspace, &candidate.workspace_dir) {
        return Ok(false);
    }
    patch_workspace_for_runtime(
        &config_path,
        &previous.workspace_dir,
        OpenClawRuntimeMode::Native,
    )?;
    Ok(true)
}

/// Restore a persisted runtime-location transaction through its durable
/// phases. The phase marker remains until both the previous layout and its
/// Gateway/service ownership are healthy again, so a Windows Scheduled Task
/// can never be left pointing at a candidate Node/npm location after a crash.
async fn recover_pending_runtime_reconfiguration(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
) -> Result<bool, String> {
    let Some((candidate, pending)) = paths::preflight_runtime_reconfiguration_recovery()? else {
        return Ok(false);
    };
    let previous_layout = pending.previous_layout();

    if !pending.previous_layout_is_restored() {
        let gateway_recovery = pending.gateway_recovery();
        let (service_runtime, service_state_dir, service_config_path, selected_service_running) =
            if gateway_recovery.selected_service_was_running {
                let contract = gateway_recovery.native_service_launch().ok_or_else(|| {
                "The pending runtime reconfiguration predates service launch recovery; retry from the previous JunQi version or restore the selected Gateway service before continuing"
                    .to_string()
            })?;
                let runtime = crate::commands::system::native_openclaw_runtime_from_gateway_service_launch_contract(contract)?;
                (
                    Some(runtime),
                    previous_layout.state_dir.as_path(),
                    previous_layout.config_path.as_path(),
                    true,
                )
            } else {
                let candidate_binary =
                    crate::commands::system::resolve_openclaw_binary_async().await;
                let candidate_service = match candidate_binary.as_deref() {
                    Some(binary) => {
                        selected_gateway_service(
                            Some(binary),
                            &candidate.state_dir,
                            &candidate.config_path,
                            candidate.runtime_mode,
                        )
                        .await?
                    }
                    None => SelectedGatewayService::default(),
                };
                let runtime = match (candidate_binary, candidate_service.installed) {
                    (Some(binary), true) => Some(
                        crate::commands::system::compatible_native_openclaw_runtime(binary).await?,
                    ),
                    _ => None,
                };
                (
                    runtime,
                    candidate.state_dir.as_path(),
                    candidate.config_path.as_path(),
                    candidate_service.installed,
                )
            };
        stop_all_locked_with_service_runtime(
            state,
            service_runtime.as_ref(),
            service_state_dir,
            service_config_path,
            selected_service_running,
        )
        .await
        .map_err(|error| {
            format!(
                "Could not stop the candidate runtime; previous locations were left unchanged: {error}"
            )
        })?;
        crate::commands::gateway_supervisor::wait_for_port_free(
            gateway_recovery.port,
            30_000,
        )
        .await
        .map_err(|error| {
            format!(
                "Candidate Gateway port was not released; previous locations were left unchanged: {error}"
            )
        })?;
        restore_workspace_if_still_owned(
            &candidate,
            &previous_layout,
            pending.native_workspace_was_written(),
        )?;
        paths::stage_runtime_reconfiguration_previous_layout()?.ok_or_else(|| {
            "The pending runtime reconfiguration disappeared before the previous layout could be restored"
                .to_string()
        })?;
    }

    let mut errors = Vec::new();
    if let Err(error) = crate::commands::terminal_integration::sync_terminal_integration().await {
        errors.push(format!("restore terminal integration: {error}"));
    }
    let previous = previous_gateway_from_pending(pending.gateway_recovery());
    let old_binary = crate::commands::system::resolve_openclaw_binary_async().await;
    let previous_config_path = runtime_config_path_for_layout(&previous_layout);
    errors.extend(
        restore_previous_gateway(
            app,
            state,
            previous,
            old_binary.as_deref(),
            GatewayRuntimePaths {
                state_dir: &previous_layout.state_dir,
                config_path: &previous_config_path,
                service_config_path: &previous_layout.config_path,
            },
        )
        .await,
    );
    if !errors.is_empty() {
        return Err(format!(
            "Previous runtime locations were restored, but Gateway recovery needs attention: {}",
            errors.join("; ")
        ));
    }
    paths::complete_runtime_reconfiguration_recovery()?.ok_or_else(|| {
        "The pending runtime reconfiguration disappeared before Gateway recovery completed"
            .to_string()
    })?;
    Ok(true)
}

/// Keep an unfinished relocation durable when its inline setup step fails.
/// The caller already owns the Gateway operation lock, so this is the single
/// reconciliation path for setup failures, Back navigation, and startup.
async fn recover_runtime_reconfiguration_after_failure(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    failure: String,
) -> String {
    match recover_pending_runtime_reconfiguration(app, state).await {
        Ok(true) => failure,
        Ok(false) => append_rollback_errors(
            failure,
            vec![
                "the runtime reconfiguration marker disappeared before recovery could be verified"
                    .to_string(),
            ],
        ),
        Err(recovery_error) => {
            let mut errors = vec![format!(
                "runtime recovery remains pending and will be retried on the next launch: {recovery_error}"
            )];
            if let Err(record_error) =
                paths::record_runtime_reconfiguration_recovery_error(recovery_error)
            {
                errors.push(format!("record pending runtime recovery: {record_error}"));
            }
            append_rollback_errors(failure, errors)
        }
    }
}

/// Recover a relocation that survived an unexpected desktop exit after the
/// managed Gateway state and platform-service APIs are available.
pub(crate) async fn recover_interrupted_runtime_reconfiguration(
    app: &AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<bool, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let result = recover_pending_runtime_reconfiguration(app, &state).await;
    if let Err(error) = &result {
        let _ = paths::record_runtime_reconfiguration_recovery_error(error.clone());
    }
    result
}

/// Commit a durable runtime relocation only after the candidate Gateway is
/// authenticated with its selected config. Dependency installation alone is
/// not enough: a broken Gateway must still be able to roll back to the prior
/// Node/Git/npm/OpenClaw contract.
#[tauri::command]
pub async fn commit_runtime_reconfiguration(
    state: State<'_, GatewayProcess>,
) -> Result<bool, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let Some((candidate, pending)) = paths::preflight_runtime_reconfiguration_rollback()? else {
        return Ok(false);
    };
    if !crate::commands::gateway::gateway_matches_config(
        pending.gateway_recovery().port,
        &candidate.config_path,
    )
    .await
    {
        return Err(format!(
            "Candidate Gateway is not healthy on port {}; runtime locations remain recoverable",
            pending.gateway_recovery().port
        ));
    }
    paths::commit_runtime_reconfiguration()?.ok_or_else(|| {
        "The pending runtime reconfiguration disappeared before it could be committed".to_string()
    })?;
    Ok(true)
}

/// Abort a pending runtime relocation after dependency installation or Gateway
/// startup fails. The candidate is stopped before bootstrap is restored so an
/// old identity can never accidentally terminate a process using new paths.
#[tauri::command]
pub async fn rollback_runtime_reconfiguration(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<bool, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let result = recover_pending_runtime_reconfiguration(&app, &state).await;
    if let Err(error) = &result {
        let _ = paths::record_runtime_reconfiguration_recovery_error(error.clone());
    }
    result
}

#[tauri::command]
pub async fn get_storage_setup_status() -> Result<StorageSetupStatus, String> {
    let bootstrap = paths::load_storage_bootstrap();
    let runtime_reconfiguration_recovery_error = paths::runtime_reconfiguration_recovery_error()?;
    let (effective, configuration_error) = match paths::effective_runtime_locations() {
        Ok(effective) => (effective, None),
        Err(error) => {
            let fallback = bootstrap.clone().unwrap_or_else(|| {
                StorageBootstrap::for_state_dir(paths::legacy_default_state_dir(), None)
            });
            (
                paths::EffectiveRuntimeLocations {
                    state_dir: fallback.state_dir.clone(),
                    config_path: fallback.config_path.clone(),
                    node_runtime_dir: fallback.node_runtime_dir.clone(),
                    git_runtime_dir: fallback.git_runtime_dir.clone(),
                    npm_prefix: fallback.npm_prefix.clone(),
                    npm_cache_dir: fallback.npm_cache_dir.clone(),
                    openclaw_git_dir: None,
                },
                Some(error),
            )
        }
    };
    let process_overrides = paths::runtime_location_overrides().ok();
    let state_overridden = process_overrides
        .as_ref()
        .and_then(|overrides| overrides.state_dir.as_ref())
        .is_some();
    let legacy = paths::legacy_default_state_dir();
    let configured = configuration_error.is_none()
        && runtime_reconfiguration_recovery_error.is_none()
        && (bootstrap.is_some() || state_overridden);
    let stats = if configured {
        DirectoryStats::default()
    } else {
        let legacy_for_stats = legacy.clone();
        tokio::task::spawn_blocking(move || collect_stats(&legacy_for_stats).unwrap_or_default())
            .await
            .map_err(|e| format!("Failed to inspect existing storage: {}", e))?
    };
    let layout = bootstrap.clone().unwrap_or_else(|| {
        let state_dir = effective.state_dir.clone();
        let config_path = effective.config_path.clone();
        let workspace = configured_workspace(&state_dir, &state_dir, &config_path);
        let mut layout = StorageBootstrap::for_state_dir(state_dir, Some(workspace));
        layout.config_path = config_path;
        layout
    });
    let workspace_dir = if state_overridden {
        configured_workspace(
            &effective.state_dir,
            &effective.state_dir,
            &effective.config_path,
        )
    } else {
        layout.workspace_dir.clone()
    };
    let runtime_dir = if state_overridden {
        effective.state_dir.clone()
    } else {
        layout.runtime_dir.clone()
    };
    let capabilities = crate::commands::runtime_policy::ManagedRuntimeCapabilities::current();
    Ok(StorageSetupStatus {
        configured,
        configuration_error,
        runtime_reconfiguration_recovery_error,
        state_dir: effective.state_dir.to_string_lossy().to_string(),
        config_path: match layout.runtime_mode {
            OpenClawRuntimeMode::Native => effective.config_path.to_string_lossy().to_string(),
            OpenClawRuntimeMode::Docker => {
                paths::config_path_for_runtime(&effective.state_dir, OpenClawRuntimeMode::Docker)
                    .to_string_lossy()
                    .to_string()
            }
        },
        workspace_dir: workspace_dir.to_string_lossy().to_string(),
        runtime_dir: runtime_dir.to_string_lossy().to_string(),
        npm_cache_dir: effective
            .npm_cache_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        npm_prefix: effective
            .npm_prefix
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        node_runtime_dir: effective
            .node_runtime_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        git_runtime_dir: effective
            .git_runtime_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        custom_node_runtime_supported: capabilities.node,
        custom_git_runtime_supported: capabilities.git,
        openclaw_relocation_required: layout.openclaw_relocation_required,
        terminal_integration: layout.terminal_integration,
        terminal_launcher_dir: paths::terminal_launcher_dir().to_string_lossy().to_string(),
        legacy_dir: legacy.to_string_lossy().to_string(),
        legacy_exists: legacy.exists(),
        legacy_size_bytes: stats.bytes,
    })
}

#[tauri::command]
pub async fn update_npm_cache_directory(
    state: State<'_, GatewayProcess>,
    npm_cache_dir: String,
) -> Result<String, String> {
    paths::validate_runtime_overrides()?;
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate
        .try_lock_owned()
        .map_err(|_| "Gateway or storage maintenance is running; try again shortly".to_string())?;
    let current = paths::load_storage_bootstrap()
        .ok_or("Storage setup must be completed before changing the npm cache directory")?;
    if paths::runtime_reconfiguration_recovery_error()?.is_some() {
        return Err(
            "Finish or recover the pending runtime location change before changing the npm cache directory"
                .to_string(),
        );
    }
    let reset_to_default = npm_cache_dir.trim().is_empty();
    let updated = layout_with_npm_cache(
        &current,
        (!reset_to_default).then_some(npm_cache_dir.as_str()),
    )?;
    let directory = updated.npm_cache_dir.as_ref();
    let existed = directory.is_some_and(|path| path.exists());
    if let Some(directory) = directory {
        std::fs::create_dir_all(directory).map_err(|error| {
            format!(
                "Failed to create npm cache directory {}: {}",
                directory.display(),
                error
            )
        })?;
        verify_directory_writable(directory)?;
    }
    if let Err(error) = paths::save_storage_bootstrap(&updated) {
        if !existed {
            if let Some(directory) = directory {
                let _ = std::fs::remove_dir(directory);
            }
        }
        return Err(error);
    }
    Ok(if reset_to_default {
        String::new()
    } else {
        directory
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default()
    })
}

#[tauri::command]
pub async fn configure_storage(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    target_dir: String,
    migrate_existing: bool,
    locations: InstallLocationSelection,
) -> Result<StorageConfigureResult, String> {
    paths::validate_explicit_runtime_overrides()?;
    let target = required_absolute_path("OpenClaw state directory", &target_dir)?;
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let target_ownership = if target.symlink_metadata().is_ok() {
        TransactionTargetOwnership::Preexisting
    } else {
        TransactionTargetOwnership::CreatedByTransaction
    };
    let old_bootstrap = paths::load_storage_bootstrap();
    let source = paths::desktop_dir();
    let old_config = paths::active_config_path();
    // Bootstrap keeps the Native config path even while Docker is selected so
    // switching back to Native never reuses the container's host mount file.
    let old_native_config = paths::config_path();
    let mut layout = selected_layout(target.clone(), locations)?;
    apply_process_runtime_overrides(&mut layout, &target)?;
    if paths::runtime_location_overrides()?
        .openclaw_git_dir
        .is_some()
        && layout.npm_prefix.is_some()
    {
        return Err(
            "A Git-checkout OpenClaw runtime cannot be combined with an npm global prefix selection"
                .into(),
        );
    }
    // Reconfiguring or migrating storage must not silently switch a working
    // Docker installation back to Native. A fresh setup can still choose a
    // different mode immediately after this transaction completes.
    if let Some(existing) = old_bootstrap.as_ref() {
        layout.runtime_mode = existing.runtime_mode;
    }
    let existing_layout = old_bootstrap.clone().unwrap_or_else(|| {
        let mut layout = StorageBootstrap::for_state_dir(
            source.clone(),
            Some(configured_workspace(&source, &source, &old_native_config)),
        );
        layout.config_path = old_native_config.clone();
        layout
    });
    // OpenClaw keeps MediaPath values absolute in copied transcripts. Preserve
    // only JunQi-recorded source roots for those historical attachments.
    preserve_migrated_media_roots(&mut layout, &existing_layout, &source, migrate_existing);
    if paths::explicit_config_path_override()?.is_none() {
        layout.config_path =
            config_path_for_storage_change(&old_native_config, &source, &target, migrate_existing);
    }
    layout.gateway_service_rebind_required = existing_layout.gateway_service_rebind_required;
    layout.gateway_service_was_running = existing_layout.gateway_service_was_running;
    layout.runtime_switch_rollback_mode = existing_layout.runtime_switch_rollback_mode;
    let runtime_location_changes = RuntimeLocationChanges::between(&existing_layout, &layout);
    let native_runtime_reconfiguration =
        apply_runtime_location_transition(&existing_layout, &mut layout);
    let binary = crate::commands::system::resolve_openclaw_binary_async().await;
    layout.openclaw_relocation_contract = if runtime_location_changes.npm_prefix {
        relocation_contract_for_binary(binary.as_deref())?
            .or_else(|| existing_layout.openclaw_relocation_contract.clone())
    } else if layout.openclaw_relocation_required {
        existing_layout.openclaw_relocation_contract.clone()
    } else {
        None
    };
    let port = std::fs::read_to_string(&old_config)
        .ok()
        .and_then(|raw| crate::commands::config::parse_openclaw_config(&raw).ok())
        .and_then(|config| crate::commands::config::gateway_port_from_config(&config))
        .unwrap_or_else(crate::commands::config::default_gateway_port);

    // 选择新位置时先做真实 chmod 能力探测(BUG-CPI-08):exFAT/网络盘会拒绝
    // Gateway 启动所需的权限调整,必须在数据迁移发生前拦下,而不是让用户
    // 迁完数据后陷入启动超时。Node 尚未安装时跳过,由 Gateway 启动前的
    // 探测兜底。
    if !paths::paths_refer_to_same_location(&target, &source) {
        if let Some(probe_node) = crate::commands::system::check_node()
            .await
            .ok()
            .as_ref()
            .and_then(crate::commands::state_dir_probe::probe_node_path)
        {
            if let crate::commands::state_dir_probe::ChmodProbeOutcome::Unsupported(detail) =
                crate::commands::state_dir_probe::probe_chmod_capability(&probe_node, &target).await
            {
                return Err(crate::commands::state_dir_probe::chmod_unsupported_message(
                    &target, &detail,
                ));
            }
        }
    }

    if paths::paths_refer_to_same_location(&target, &source) {
        validate_location_changes(&layout, Some(&existing_layout))?;
        // Recovery can target the already-selected directory. Re-run the same
        // capability contract used for migrations before changing bootstrap,
        // service, or runtime locations; writability alone does not prove that
        // Node's chmod/rename operations are supported on Windows mounts.
        verify_layout_storage_capability(&layout).await?;
        let previous = PreviousGateway {
            reachable: crate::commands::gateway::gateway_matches_config(port, &old_config).await,
            runtime: state.runtime_snapshot()?,
            selected_runtime: existing_layout.runtime_mode,
            port,
            selected_service: if old_bootstrap.is_some() {
                selected_gateway_service(
                    binary.as_deref(),
                    &source,
                    &old_native_config,
                    existing_layout.runtime_mode,
                )
                .await?
            } else {
                SelectedGatewayService::default()
            },
        };
        if previous.selected_service.installed
            && (native_runtime_reconfiguration
                || !paths::paths_refer_to_same_location(&layout.config_path, &old_native_config))
        {
            layout.gateway_service_rebind_required = true;
            layout.gateway_service_was_running = previous.selected_service.running;
        }
        // Capture the current, verified service launch before persisting a
        // candidate Node/npm layout. A new portable runtime can legitimately
        // be empty until the next setup step, while an existing Windows task
        // still needs the old Node + OpenClaw entry to be stopped safely.
        let previous_service_runtime = if native_runtime_reconfiguration
            && previous.selected_service.installed
        {
            let binary = binary.as_ref().ok_or_else(|| {
                "OpenClaw is unavailable; cannot preserve the selected Gateway service for runtime reconfiguration"
                    .to_string()
            })?;
            Some(
                crate::commands::system::compatible_native_openclaw_runtime(binary.clone())
                    .await
                    .map_err(|error| {
                        format!(
                            "Could not preserve the selected Gateway service launch contract: {error}"
                        )
                    })?,
            )
        } else {
            None
        };
        let reconfiguration =
            StorageReconfiguration::begin(old_bootstrap.clone(), &old_config, &layout)?;
        if native_runtime_reconfiguration {
            // Persist the recovery memento before stopping a working Gateway.
            // A later dependency install runs in a separate frontend action,
            // so this cannot rely on an in-memory rollback guard.
            paths::begin_runtime_reconfiguration(
                &existing_layout,
                &mut layout,
                pending_gateway_recovery(previous, previous_service_runtime.as_ref()),
                reconfiguration.writes_native_workspace(),
            )?;
            paths::save_storage_bootstrap(&layout)?;

            if let Err(error) = stop_all_locked(
                &state,
                binary.as_deref(),
                &source,
                &old_native_config,
                previous.selected_service.running,
            )
            .await
            {
                return Err(
                    recover_runtime_reconfiguration_after_failure(&app, &state, error).await,
                );
            }
            if let Err(error) =
                crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
            {
                let failure = format!(
                    "Gateway did not stop cleanly; runtime locations were not changed: {}",
                    error
                );
                return Err(
                    recover_runtime_reconfiguration_after_failure(&app, &state, failure).await,
                );
            }
        }
        let reconfiguration_result = if native_runtime_reconfiguration {
            reconfiguration
                .apply_pending_runtime_reconfiguration(&layout)
                .await
        } else {
            reconfiguration.apply(&layout, true).await
        };
        if let Err(error) = reconfiguration_result {
            if native_runtime_reconfiguration {
                return Err(
                    recover_runtime_reconfiguration_after_failure(&app, &state, error).await,
                );
            }
            return Err(error);
        }
        return Ok(StorageConfigureResult {
            state_dir: layout.state_dir.to_string_lossy().to_string(),
            config_path: runtime_config_path_for_layout(&layout)
                .to_string_lossy()
                .to_string(),
            workspace_dir: layout.workspace_dir.to_string_lossy().to_string(),
            runtime_dir: layout.runtime_dir.to_string_lossy().to_string(),
            npm_cache_dir: layout
                .npm_cache_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            npm_prefix: layout
                .npm_prefix
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            node_runtime_dir: layout
                .node_runtime_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            git_runtime_dir: layout
                .git_runtime_dir
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            runtime_reconfiguration_required: native_runtime_reconfiguration,
            openclaw_relocation_required: layout.openclaw_relocation_required,
            terminal_integration: layout.terminal_integration,
            created_fresh: false,
            migrated: false,
            files_copied: 0,
            bytes_copied: 0,
        });
    }

    if migrate_existing && paths::paths_overlap(&target, &source) {
        return Err("Target directory cannot be inside the current state directory".to_string());
    }
    if migrate_existing && !source.exists() {
        return Err(format!(
            "Source directory does not exist: {}",
            source.display()
        ));
    }
    if migrate_existing {
        let expected_workspace =
            map_workspace_to_target(&existing_layout.workspace_dir, &source, &target)
                .unwrap_or_else(|| existing_layout.workspace_dir.clone());
        let expected_runtime =
            map_workspace_to_target(&existing_layout.runtime_dir, &source, &target)
                .unwrap_or(existing_layout.runtime_dir);
        let expected_cache = existing_layout.npm_cache_dir.as_ref().map(|cache| {
            map_workspace_to_target(cache, &source, &target).unwrap_or_else(|| cache.clone())
        });
        if layout.workspace_dir != expected_workspace || layout.runtime_dir != expected_runtime {
            return Err(
                "Custom workspace or OpenClaw internal runtime locations require a fresh setup; migration preserves the OpenClaw data layout"
                    .into(),
            );
        }
        let mut expected_layout = StorageBootstrap::with_locations(
            target.clone(),
            expected_workspace,
            expected_runtime,
            expected_cache.clone(),
            existing_layout.npm_prefix,
            existing_layout.terminal_integration,
        );
        expected_layout.node_runtime_dir = existing_layout.node_runtime_dir;
        expected_layout.git_runtime_dir = existing_layout.git_runtime_dir;
        expected_layout.runtime_mode = existing_layout.runtime_mode;
        validate_location_changes(&layout, Some(&expected_layout))?;
    } else {
        validate_independent_locations(&layout)?;
    }
    if target
        .symlink_metadata()
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Storage target cannot be a symbolic link".to_string());
    }
    if path_has_reparse_ancestor(&target) {
        return Err(
            "Storage target cannot be inside a symbolic link or Windows junction".to_string(),
        );
    }
    // Reject incompatible filesystems before stopping an existing Gateway,
    // copying data, or committing bootstrap.json to the new location.
    verify_layout_storage_capability(&layout).await?;
    if !directory_is_empty(&target)? {
        return Err("Target directory must be empty".to_string());
    }

    let previous = PreviousGateway {
        reachable: crate::commands::gateway::gateway_matches_config(port, &old_config).await,
        runtime: state.runtime_snapshot()?,
        selected_runtime: existing_layout.runtime_mode,
        port,
        selected_service: if old_bootstrap.is_some() {
            selected_gateway_service(
                binary.as_deref(),
                &source,
                &old_native_config,
                existing_layout.runtime_mode,
            )
            .await?
        } else {
            SelectedGatewayService::default()
        },
    };
    if previous.selected_service.installed {
        layout.gateway_service_rebind_required = true;
        layout.gateway_service_was_running = previous.selected_service.running;
    }
    let rollback = StorageRollbackContext {
        app: &app,
        state: &state,
        previous,
        old_bootstrap: old_bootstrap.as_ref(),
        old_state_dir: &source,
        old_config_path: &old_config,
        old_native_config_path: &old_native_config,
        binary: binary.as_deref(),
        target: &target,
        target_ownership,
    };
    emit_progress(
        &app,
        "storage.progress.stoppingGateway",
        "Stopping the previous Gateway...",
        0.08,
    );
    stop_all_locked_with_compensation(
        &app,
        &state,
        previous,
        binary.as_deref(),
        &source,
        &old_config,
        &old_native_config,
    )
    .await?;
    if let Err(error) = crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
    {
        if previous.selected_runtime_was_running() {
            if crate::commands::gateway::gateway_matches_config(port, &old_config).await {
                state.transition(
                    Some(GatewayLifecycle::Running),
                    Some(previous.restore_mode()),
                    None,
                    "storage migration: previous endpoint never stopped",
                );
                return Err(format!(
                    "Gateway is still running; storage migration was not started: {}",
                    error
                ));
            }
            let restore_errors = restore_previous_gateway(
                &app,
                &state,
                previous,
                binary.as_deref(),
                GatewayRuntimePaths {
                    state_dir: &source,
                    config_path: &old_config,
                    service_config_path: &old_native_config,
                },
            )
            .await;
            return Err(append_rollback_errors(
                format!("Gateway did not stop cleanly: {error}"),
                restore_errors,
            ));
        }
        state.transition(
            Some(GatewayLifecycle::Error),
            Some(GatewayRuntimeMode::External),
            None,
            "storage migration: target port remains occupied",
        );
        return Err(format!(
            "Gateway port {} remains occupied; storage migration was not started: {}",
            port, error
        ));
    }

    if migrate_existing {
        emit_progress(
            &app,
            "storage.progress.copying",
            "Copying OpenClaw data...",
            0.28,
        );
    } else {
        emit_progress(
            &app,
            "storage.progress.preparingFresh",
            "Preparing a new OpenClaw environment...",
            0.28,
        );
    }
    let source_for_prepare = source.clone();
    let target_for_prepare = target.clone();
    let layout_for_prepare = layout;
    let preparation_rollback = match migrate_existing {
        true => RollbackPolicy::MIGRATION_PREPARATION,
        false => RollbackPolicy::FRESH_PREPARATION,
    };
    let prepared = match tokio::task::spawn_blocking(move || {
        prepare_storage_target(
            &source_for_prepare,
            &target_for_prepare,
            migrate_existing,
            layout_for_prepare,
        )
    })
    .await
    {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(error)) => {
            let failure = rollback.run(preparation_rollback, error).await;
            return Err(failure);
        }
        Err(error) => {
            let failure = rollback
                .run(
                    preparation_rollback,
                    format!("Migration worker failed: {}", error),
                )
                .await;
            return Err(failure);
        }
    };
    let prepared_config_path = runtime_config_path_for_layout(&prepared.layout);

    if migrate_existing {
        emit_progress(
            &app,
            "storage.progress.verifying",
            "Verifying migrated data...",
            0.62,
        );
    }
    emit_progress(
        &app,
        "storage.progress.switching",
        "Switching the storage location...",
        0.76,
    );
    if let Err(error) = paths::save_storage_bootstrap(&prepared.layout) {
        let failure = rollback
            .run(RollbackPolicy::AFTER_BOOTSTRAP_SAVE, error)
            .await;
        return Err(failure);
    }
    if !native_runtime_reconfiguration {
        if let Err(error) = crate::commands::terminal_integration::sync_terminal_integration().await
        {
            let failure = rollback.run(RollbackPolicy::AFTER_SWITCH, error).await;
            return Err(failure);
        }
    }

    if prepared.layout.gateway_service_rebind_required
        && !native_runtime_reconfiguration
        && matches!(prepared.layout.runtime_mode, OpenClawRuntimeMode::Native)
    {
        let rebind_binary = binary.clone();
        let rebind_result = async {
            let binary = rebind_binary.ok_or_else(|| {
                "OpenClaw binary is unavailable; cannot rebind the selected Gateway service"
                    .to_string()
            })?;
            let runtime =
                crate::commands::system::compatible_native_openclaw_runtime(binary.to_path_buf())
                    .await?;
            let search_path = crate::commands::system::openclaw_search_path();
            crate::commands::gateway_service::reconcile_pending_gateway_service(
                &runtime,
                &prepared.layout.state_dir,
                &prepared.layout.config_path,
                port,
                Some(&search_path),
            )
            .await
        }
        .await;
        if let Err(error) = rebind_result {
            let failure = rollback
                .run_after_gateway_activation(
                    RollbackPolicy::AFTER_SWITCH,
                    &prepared.layout,
                    true,
                    format!(
                        "Gateway service rebind failed after storage migration: {}",
                        error
                    ),
                )
                .await;
            return Err(failure);
        }
    }

    if migrate_existing
        && previous.selected_runtime_was_running()
        && !native_runtime_reconfiguration
    {
        emit_progress(
            &app,
            "storage.progress.startingGateway",
            "Starting Gateway from the new storage location...",
            0.86,
        );
        if let Err(error) = start_runtime_locked(
            &app,
            &state,
            previous.restore_mode(),
            port,
            binary.as_deref(),
            GatewayRuntimePaths {
                state_dir: &prepared.layout.state_dir,
                config_path: &prepared_config_path,
                service_config_path: &prepared.layout.config_path,
            },
            RuntimeStartPolicy::RequireFreshOwner,
        )
        .await
        {
            let failure = rollback
                .run_after_gateway_activation(
                    RollbackPolicy::AFTER_SWITCH,
                    &prepared.layout,
                    prepared.layout.gateway_service_rebind_required,
                    format!("Gateway failed to start from migrated storage: {}", error),
                )
                .await;
            return Err(failure);
        }
    }

    emit_progress(
        &app,
        "storage.progress.complete",
        "Storage location updated",
        1.0,
    );
    Ok(StorageConfigureResult {
        state_dir: prepared.layout.state_dir.to_string_lossy().to_string(),
        config_path: prepared_config_path.to_string_lossy().to_string(),
        workspace_dir: prepared.layout.workspace_dir.to_string_lossy().to_string(),
        runtime_dir: prepared.layout.runtime_dir.to_string_lossy().to_string(),
        npm_cache_dir: prepared
            .layout
            .npm_cache_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        npm_prefix: prepared
            .layout
            .npm_prefix
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        node_runtime_dir: prepared
            .layout
            .node_runtime_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        git_runtime_dir: prepared
            .layout
            .git_runtime_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        runtime_reconfiguration_required: native_runtime_reconfiguration,
        openclaw_relocation_required: prepared.layout.openclaw_relocation_required,
        terminal_integration: prepared.layout.terminal_integration,
        created_fresh: !migrate_existing,
        migrated: migrate_existing,
        files_copied: prepared.copied.files,
        bytes_copied: prepared.copied.bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bug_iu_04_external_and_unknown_runtimes_restore_as_managed_children() {
        for mode in [GatewayRuntimeMode::External, GatewayRuntimeMode::None] {
            let strategy = RuntimeRestoreStrategy::for_mode(mode);
            assert_eq!(strategy, RuntimeRestoreStrategy::ManagedChild);
            assert_eq!(strategy.restored_mode(), GatewayRuntimeMode::ManagedChild);
        }
    }

    #[test]
    fn bug_iu_04_preserves_explicit_service_and_docker_ownership() {
        assert_eq!(
            RuntimeRestoreStrategy::for_mode(GatewayRuntimeMode::SystemService),
            RuntimeRestoreStrategy::SystemService
        );
        assert_eq!(
            RuntimeRestoreStrategy::for_mode(GatewayRuntimeMode::Docker),
            RuntimeRestoreStrategy::Docker
        );
    }

    #[test]
    fn pending_gateway_recovery_round_trips_selected_service_ownership() {
        let previous = PreviousGateway {
            reachable: true,
            runtime: GatewayRuntimeState {
                lifecycle: GatewayLifecycle::Running,
                mode: GatewayRuntimeMode::SystemService,
                restarting: false,
            },
            selected_runtime: OpenClawRuntimeMode::Native,
            port: 18_789,
            selected_service: SelectedGatewayService {
                installed: true,
                running: true,
            },
        };

        let restored = previous_gateway_from_pending(pending_gateway_recovery(previous, None));

        assert!(restored.selected_runtime_was_running());
        assert_eq!(restored.restore_mode(), GatewayRuntimeMode::SystemService);
        assert!(restored.selected_service.installed);
        assert!(restored.selected_service.running);
    }

    fn storage_test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "junqi-storage-{}-{}-{}",
            name,
            std::process::id(),
            uuid::Uuid::new_v4()
        ))
    }

    fn test_layout(target: &Path, workspace: PathBuf) -> StorageBootstrap {
        StorageBootstrap::with_locations(
            target.to_path_buf(),
            workspace,
            target.to_path_buf(),
            Some(target.join("npm-cache")),
            None,
            false,
        )
    }

    fn test_selection(root: &Path) -> InstallLocationSelection {
        InstallLocationSelection {
            workspace_dir: root.join("workspace").to_string_lossy().to_string(),
            runtime_dir: root.join("runtime").to_string_lossy().to_string(),
            npm_cache_dir: None,
            npm_prefix: None,
            node_runtime_dir: None,
            git_runtime_dir: None,
            terminal_integration: false,
        }
    }

    #[test]
    fn stopped_official_service_does_not_replace_the_running_managed_runtime() {
        let previous = PreviousGateway {
            reachable: true,
            runtime: GatewayRuntimeState {
                lifecycle: GatewayLifecycle::Running,
                mode: GatewayRuntimeMode::ManagedChild,
                restarting: false,
            },
            selected_runtime: OpenClawRuntimeMode::Native,
            port: 18_789,
            selected_service: SelectedGatewayService {
                installed: true,
                running: false,
            },
        };

        assert!(previous.selected_runtime_was_running());
        assert_eq!(previous.restore_mode(), GatewayRuntimeMode::ManagedChild);

        let running_service = PreviousGateway {
            selected_service: SelectedGatewayService {
                installed: true,
                running: true,
            },
            ..previous
        };
        assert_eq!(
            running_service.restore_mode(),
            GatewayRuntimeMode::SystemService
        );
    }

    #[test]
    fn failed_stop_compensates_the_runtime_that_was_running_before_storage_change() {
        let managed = PreviousGateway {
            reachable: true,
            runtime: GatewayRuntimeState {
                lifecycle: GatewayLifecycle::Running,
                mode: GatewayRuntimeMode::ManagedChild,
                restarting: false,
            },
            selected_runtime: OpenClawRuntimeMode::Native,
            port: 18_789,
            selected_service: SelectedGatewayService {
                installed: true,
                running: false,
            },
        };
        assert!(managed.selected_runtime_was_running());
        assert_eq!(managed.restore_mode(), GatewayRuntimeMode::ManagedChild);

        let service = PreviousGateway {
            selected_service: SelectedGatewayService {
                installed: true,
                running: true,
            },
            ..managed
        };
        assert!(service.selected_runtime_was_running());
        assert_eq!(service.restore_mode(), GatewayRuntimeMode::SystemService);

        let stopped = PreviousGateway {
            reachable: false,
            runtime: GatewayRuntimeState {
                lifecycle: GatewayLifecycle::Stopped,
                mode: GatewayRuntimeMode::None,
                restarting: false,
            },
            selected_service: SelectedGatewayService::default(),
            ..managed
        };
        assert!(!stopped.selected_runtime_was_running());
    }

    #[test]
    fn docker_rollback_uses_persisted_selection_not_a_cold_start_snapshot() {
        let docker = PreviousGateway {
            reachable: true,
            runtime: GatewayRuntimeState {
                lifecycle: GatewayLifecycle::Stopped,
                mode: GatewayRuntimeMode::None,
                restarting: false,
            },
            selected_runtime: OpenClawRuntimeMode::Docker,
            port: 18_789,
            selected_service: SelectedGatewayService {
                installed: true,
                running: true,
            },
        };

        assert!(docker.selected_runtime_was_running());
        assert_eq!(docker.restore_mode(), GatewayRuntimeMode::Docker);
        assert!(!selected_runtime_restored_by_service(docker, true));
    }

    #[test]
    fn rollback_never_removes_a_preexisting_target_directory() {
        let root = storage_test_root("preexisting-target-rollback");
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        let concurrent_file = target.join("created-while-migrating.txt");
        std::fs::write(&concurrent_file, "user data").unwrap();

        cleanup_transaction_target(&target, TransactionTargetOwnership::Preexisting).unwrap();

        assert!(target.is_dir());
        assert!(concurrent_file.is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_preserves_a_created_target_in_a_recovery_sibling() {
        let root = storage_test_root("created-target-rollback");
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("incomplete.json"), "{}").unwrap();

        let recovery =
            cleanup_transaction_target(&target, TransactionTargetOwnership::CreatedByTransaction)
                .unwrap()
                .unwrap();

        assert!(!target.exists());
        assert_eq!(
            std::fs::read_to_string(recovery.join("incomplete.json")).unwrap(),
            "{}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn state_probe_prefers_the_candidate_portable_node_runtime() {
        let root = storage_test_root("candidate-node-probe");
        let mut layout = test_layout(&root.join("state"), root.join("workspace"));
        let runtime = root.join("portable-node");
        layout.node_runtime_dir = Some(runtime.clone());

        assert_eq!(
            candidate_node_path(&layout),
            Some(paths::node_binary_for_runtime_dir(&runtime))
        );
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn custom_dependency_runtime_locations_are_explicit_and_cannot_overlap_storage() {
        let root = storage_test_root("custom-dependency-locations");
        let mut selection = test_selection(&root);
        selection.node_runtime_dir = Some(
            root.with_file_name("node-runtime")
                .to_string_lossy()
                .to_string(),
        );
        #[cfg(windows)]
        {
            selection.git_runtime_dir = Some(
                root.with_file_name("git-runtime")
                    .to_string_lossy()
                    .to_string(),
            );
        }
        let layout = selected_layout(root.clone(), selection).unwrap();
        assert_eq!(
            layout.node_runtime_dir,
            Some(root.with_file_name("node-runtime"))
        );
        #[cfg(windows)]
        assert_eq!(
            layout.git_runtime_dir,
            Some(root.with_file_name("git-runtime"))
        );
        #[cfg(not(windows))]
        assert_eq!(layout.git_runtime_dir, None);
        assert!(validate_independent_locations(&layout).is_ok());

        let mut overlapping = test_selection(&root);
        overlapping.node_runtime_dir = Some(overlapping.workspace_dir.clone());
        let overlapping = selected_layout(root, overlapping).unwrap();
        assert!(validate_independent_locations(&overlapping).is_err());
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    #[test]
    fn unsupported_platform_rejects_a_custom_node_runtime() {
        let root = storage_test_root("unsupported-custom-node");
        let mut selection = test_selection(&root);
        selection.node_runtime_dir = Some(
            root.with_file_name("node-runtime")
                .to_string_lossy()
                .to_string(),
        );
        assert!(selected_layout(root, selection)
            .unwrap_err()
            .contains("only supported on Windows and macOS"));
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_layout_rejects_a_custom_git_runtime() {
        let root = storage_test_root("unsupported-custom-git");
        let mut selection = test_selection(&root);
        selection.git_runtime_dir = Some(root.with_file_name("git-runtime").display().to_string());
        assert!(selected_layout(root, selection)
            .unwrap_err()
            .contains("only supported on Windows"));
    }

    #[test]
    fn migration_allows_independent_dependency_locations_to_change() {
        let root = storage_test_root("migration-runtime-locations");
        let current = StorageBootstrap::for_state_dir(root.join("old-state"), None);
        let mut next = StorageBootstrap::for_state_dir(root.join("new-state"), None);
        next.workspace_dir = root.join("new-state").join("workspace");
        next.runtime_dir = root.join("new-state").join("runtime");
        next.npm_cache_dir = Some(root.join("npm-cache"));
        next.npm_prefix = Some(root.join("npm-prefix"));
        next.node_runtime_dir = Some(root.join("node"));
        next.git_runtime_dir = Some(root.join("git"));

        assert!(validate_location_changes(&next, Some(&current)).is_ok());
        assert!(apply_runtime_location_transition(&current, &mut next));
        assert!(next.openclaw_relocation_required);
    }

    #[test]
    fn migration_preserves_only_explicit_prior_media_state_roots() {
        let root = storage_test_root("media-history");
        let oldest = root.join("oldest");
        let source = root.join("source");
        let target = root.join("target");
        let mut existing = StorageBootstrap::for_state_dir(source.clone(), None);
        existing.remember_historical_media_state_dir(oldest.clone());
        let mut next = StorageBootstrap::for_state_dir(target, None);

        preserve_migrated_media_roots(&mut next, &existing, &source, true);

        assert_eq!(next.historical_media_state_dirs, vec![oldest, source]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn new_dependency_locations_cannot_be_nested_in_openclaw_state() {
        let root = storage_test_root("state-nested-dependency");
        let state = root.join("state");
        let mut layout = StorageBootstrap::with_locations(
            state.clone(),
            root.join("workspace"),
            root.join("runtime"),
            None,
            Some(state.join("npm")),
            false,
        );
        assert!(validate_location_changes(&layout, None)
            .unwrap_err()
            .contains("outside the OpenClaw state directory"));

        layout.npm_prefix = Some(root.join("npm"));
        layout.node_runtime_dir = Some(state.join("node"));
        assert!(validate_location_changes(&layout, None)
            .unwrap_err()
            .contains("outside the OpenClaw state directory"));
    }

    #[test]
    fn legacy_dependency_overlap_fails_closed_instead_of_silent_drift() {
        let root = storage_test_root("legacy-state-nested-dependency");
        let state = root.join("state");
        let layout = StorageBootstrap::with_locations(
            state.clone(),
            root.join("workspace"),
            root.join("runtime"),
            None,
            Some(state.join("npm")),
            false,
        );
        assert!(validate_location_changes(&layout, Some(&layout))
            .unwrap_err()
            .contains("outside the OpenClaw state directory"));
    }

    #[test]
    fn migration_keeps_pending_openclaw_relocation_until_install_succeeds() {
        let root = storage_test_root("pending-openclaw-relocation");
        let mut current = StorageBootstrap::for_state_dir(root.join("old-state"), None);
        current.openclaw_relocation_required = true;
        let mut next = current.clone();

        assert!(apply_runtime_location_transition(&current, &mut next));
        assert!(next.openclaw_relocation_required);
    }

    #[test]
    fn bug_wrm_path_comparison_ignores_equivalent_existing_paths() {
        let root = storage_test_root("equivalent-runtime-locations");
        std::fs::create_dir_all(&root).unwrap();
        let equivalent = root.join(".");

        assert!(!optional_locations_differ(Some(&root), Some(&equivalent)));
        assert!(optional_locations_differ(Some(&root), None));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn docker_migration_defers_host_openclaw_relocation_until_native_is_selected() {
        let root = storage_test_root("docker-openclaw-relocation");
        let mut current = StorageBootstrap::for_state_dir(root.join("old-state"), None);
        current.runtime_mode = OpenClawRuntimeMode::Docker;
        let mut next = current.clone();
        next.npm_prefix = Some(root.join("new-prefix"));

        assert!(!apply_runtime_location_transition(&current, &mut next));
        assert!(next.openclaw_relocation_required);
    }

    struct FailAfterConfigPatch;

    impl ReconfigurationOperations for FailAfterConfigPatch {
        fn ensure_layout(layout: &StorageBootstrap) -> Result<(), String> {
            ensure_layout_directories(layout)
        }

        fn patch_workspace(
            config_path: &Path,
            workspace_dir: &Path,
            runtime_mode: OpenClawRuntimeMode,
        ) -> Result<(), String> {
            patch_workspace_for_runtime(config_path, workspace_dir, runtime_mode)
        }

        fn save_bootstrap(_layout: &StorageBootstrap) -> Result<(), String> {
            Err("injected bootstrap failure".into())
        }

        fn restore_bootstrap(_old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String> {
            Err("injected bootstrap restore marker".into())
        }

        async fn sync_terminal() -> Result<(), String> {
            Ok(())
        }
    }

    struct RejectUnexpectedWorkspaceWrite;

    impl ReconfigurationOperations for RejectUnexpectedWorkspaceWrite {
        fn ensure_layout(_layout: &StorageBootstrap) -> Result<(), String> {
            Ok(())
        }

        fn patch_workspace(
            _config_path: &Path,
            _workspace_dir: &Path,
            _runtime_mode: OpenClawRuntimeMode,
        ) -> Result<(), String> {
            Err("the unchanged Native workspace must not be rewritten".into())
        }

        fn save_bootstrap(_layout: &StorageBootstrap) -> Result<(), String> {
            Ok(())
        }

        fn restore_bootstrap(_old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String> {
            Ok(())
        }

        async fn sync_terminal() -> Result<(), String> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn same_location_reconfiguration_rolls_back_config_and_directories() {
        let root = storage_test_root("same-location-rollback");
        std::fs::create_dir_all(&root).unwrap();
        let config_path = root.join("openclaw.json");
        let original = r#"{"agents":{"defaults":{"workspace":"original"}}}"#;
        std::fs::write(&config_path, original).unwrap();
        let layout = StorageBootstrap::with_locations(
            root.clone(),
            root.join("workspace-new"),
            root.join("runtime-new"),
            Some(root.join("cache-new")),
            Some(root.join("prefix-new")),
            false,
        );

        let transaction = StorageReconfiguration::begin(None, &config_path, &layout).unwrap();
        let error = transaction
            .apply_with::<FailAfterConfigPatch>(&layout, true)
            .await
            .unwrap_err();

        assert!(error.contains("injected bootstrap failure"));
        assert!(error.contains("injected bootstrap restore marker"));
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), original);
        for path in layout_directories(&layout) {
            if path != root {
                assert!(!path.exists(), "{} should be rolled back", path.display());
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn pending_runtime_reconfiguration_failure_preserves_its_bootstrap_memento() {
        let root = storage_test_root("pending-runtime-preserve-bootstrap");
        std::fs::create_dir_all(&root).unwrap();
        let config_path = root.join("openclaw.json");
        let original = r#"{"agents":{"defaults":{"workspace":"original"}}}"#;
        std::fs::write(&config_path, original).unwrap();
        let layout = StorageBootstrap::with_locations(
            root.clone(),
            root.join("workspace-new"),
            root.join("runtime-new"),
            Some(root.join("cache-new")),
            Some(root.join("prefix-new")),
            false,
        );

        let transaction = StorageReconfiguration::begin(None, &config_path, &layout).unwrap();
        let error = transaction
            .apply_with_policy::<FailAfterConfigPatch>(
                &layout,
                false,
                StorageReconfigurationFailurePolicy::PreservePendingRuntimeReconfiguration,
            )
            .await
            .unwrap_err();

        assert!(error.contains("injected bootstrap failure"));
        assert!(!error.contains("injected bootstrap restore marker"));
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), original);
        for path in layout_directories(&layout) {
            if path != root {
                assert!(!path.exists(), "{} should be rolled back", path.display());
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn node_only_reconfiguration_keeps_an_unchanged_native_config_byte_for_byte() {
        let root = storage_test_root("node-only-native-config");
        std::fs::create_dir_all(&root).unwrap();
        let workspace = root.join("workspace");
        let layout = StorageBootstrap::with_locations(
            root.clone(),
            workspace.clone(),
            root.join("runtime"),
            None,
            None,
            false,
        );
        let encoded_workspace =
            serde_json::to_string(&workspace.to_string_lossy().into_owned()).unwrap();
        let original = format!(
            "{{\n  // Keep JSON5 comments when runtime locations change.\n  agents: {{ defaults: {{ workspace: {encoded_workspace} }} }}\n}}\n"
        );
        std::fs::write(&layout.config_path, &original).unwrap();

        let transaction =
            StorageReconfiguration::begin(None, &layout.config_path, &layout).unwrap();
        assert!(!transaction.writes_native_workspace());
        transaction
            .apply_with::<RejectUnexpectedWorkspaceWrite>(&layout, false)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&layout.config_path).unwrap(),
            original
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn node_only_reconfiguration_preserves_a_relative_native_workspace() {
        let root = storage_test_root("node-only-relative-native-config");
        std::fs::create_dir_all(&root).unwrap();
        let working_dir = paths::stable_openclaw_working_dir().unwrap();
        let workspace = working_dir.join("junqi-relative-workspace");
        let layout = StorageBootstrap::with_locations(
            root.clone(),
            workspace,
            root.join("runtime"),
            None,
            None,
            false,
        );
        let original = "{ agents: { defaults: { workspace: 'junqi-relative-workspace' } } }\n";
        std::fs::write(&layout.config_path, original).unwrap();

        let transaction =
            StorageReconfiguration::begin(None, &layout.config_path, &layout).unwrap();
        assert!(!transaction.writes_native_workspace());
        transaction
            .apply_with::<RejectUnexpectedWorkspaceWrite>(&layout, false)
            .await
            .unwrap();

        assert_eq!(
            std::fs::read_to_string(&layout.config_path).unwrap(),
            original
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn node_reconfiguration_never_rewrites_an_external_native_config() {
        let root = storage_test_root("node-only-external-native-config");
        let state = root.join("state");
        let external = root.join("external").join("openclaw.json");
        std::fs::create_dir_all(external.parent().unwrap()).unwrap();
        let mut layout = StorageBootstrap::for_state_dir(state, Some(root.join("workspace")));
        layout.config_path = external.clone();
        let original = "{ agents: { defaults: { workspace: '/user-owned/workspace' } } }\n";
        std::fs::write(&external, original).unwrap();

        let transaction = StorageReconfiguration::begin(None, &external, &layout).unwrap();
        assert!(!transaction.writes_native_workspace());
        transaction
            .apply_with::<RejectUnexpectedWorkspaceWrite>(&layout, false)
            .await
            .unwrap();

        assert_eq!(std::fs::read_to_string(&external).unwrap(), original);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn config_snapshot_preserves_an_external_edit_after_transactional_write() {
        let root = storage_test_root("snapshot-external-edit");
        std::fs::create_dir_all(&root).unwrap();
        let config = root.join("openclaw.json");
        std::fs::write(&config, "{\"workspace\":\"before\"}").unwrap();
        let mut snapshot = TextFileSnapshot::capture(&config).unwrap();

        std::fs::write(&config, "{\"workspace\":\"transaction\"}").unwrap();
        snapshot.record_transaction_write().unwrap();
        std::fs::write(&config, "{\"workspace\":\"external\"}").unwrap();

        assert!(matches!(
            snapshot.restore().unwrap(),
            SnapshotRestore::PreservedExternalChange
        ));
        assert_eq!(
            std::fs::read_to_string(&config).unwrap(),
            "{\"workspace\":\"external\"}"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pending_runtime_recovery_restores_workspace_only_when_the_candidate_still_owns_it() {
        let root = storage_test_root("pending-runtime-workspace");
        std::fs::create_dir_all(&root).unwrap();
        let previous =
            StorageBootstrap::for_state_dir(root.clone(), Some(root.join("workspace-old")));
        let mut candidate = previous.clone();
        candidate.workspace_dir = root.join("workspace-new");
        let candidate_workspace = candidate.workspace_dir.to_string_lossy().to_string();
        std::fs::write(
            &candidate.config_path,
            serde_json::json!({
                "agents": { "defaults": { "workspace": candidate_workspace } }
            })
            .to_string(),
        )
        .unwrap();

        assert!(!restore_workspace_if_still_owned(&candidate, &previous, false).unwrap());
        let unchanged = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&candidate.config_path).unwrap(),
        )
        .unwrap();
        assert_eq!(
            unchanged["agents"]["defaults"]["workspace"],
            serde_json::Value::String(candidate.workspace_dir.to_string_lossy().to_string())
        );

        assert!(restore_workspace_if_still_owned(&candidate, &previous, true).unwrap());
        let restored = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&candidate.config_path).unwrap(),
        )
        .unwrap();
        assert_eq!(
            restored["agents"]["defaults"]["workspace"],
            serde_json::Value::String(previous.workspace_dir.to_string_lossy().to_string())
        );

        std::fs::write(
            &candidate.config_path,
            serde_json::json!({
                "agents": { "defaults": { "workspace": root.join("external") } }
            })
            .to_string(),
        )
        .unwrap();
        assert!(!restore_workspace_if_still_owned(&candidate, &previous, true).unwrap());
        let preserved = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&candidate.config_path).unwrap(),
        )
        .unwrap();
        assert_eq!(
            preserved["agents"]["defaults"]["workspace"],
            serde_json::Value::String(root.join("external").to_string_lossy().to_string())
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn pending_runtime_recovery_recognizes_a_relative_candidate_workspace() {
        let root = storage_test_root("pending-runtime-relative-workspace");
        std::fs::create_dir_all(&root).unwrap();
        let previous =
            StorageBootstrap::for_state_dir(root.clone(), Some(root.join("workspace-old")));
        let mut candidate = previous.clone();
        candidate.workspace_dir = paths::stable_openclaw_working_dir()
            .unwrap()
            .join("junqi-relative-workspace");
        std::fs::write(
            &candidate.config_path,
            "{ agents: { defaults: { workspace: 'junqi-relative-workspace' } } }\n",
        )
        .unwrap();

        assert!(restore_workspace_if_still_owned(&candidate, &previous, true).unwrap());
        let restored = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(&candidate.config_path).unwrap(),
        )
        .unwrap();
        assert_eq!(
            restored["agents"]["defaults"]["workspace"],
            serde_json::Value::String(previous.workspace_dir.to_string_lossy().to_string())
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn install_layout_rejects_relative_and_duplicate_locations() {
        let root = storage_test_root("layout-validation");
        let mut relative = test_selection(&root);
        relative.workspace_dir = "relative-workspace".into();
        assert!(selected_layout(root.clone(), relative).is_err());

        let mut traversal = test_selection(&root);
        traversal.workspace_dir = root
            .join("workspace")
            .join("..")
            .join("other")
            .to_string_lossy()
            .to_string();
        assert!(selected_layout(root.clone(), traversal).is_err());

        let mut duplicate = test_selection(&root);
        duplicate.npm_cache_dir = Some(duplicate.runtime_dir.clone());
        let duplicate = selected_layout(root.clone(), duplicate).unwrap();
        assert!(validate_independent_locations(&duplicate).is_err());

        let mut prefix_collision = test_selection(&root);
        prefix_collision.npm_prefix = Some(prefix_collision.runtime_dir.clone());
        let prefix_collision = selected_layout(root, prefix_collision).unwrap();
        assert!(validate_independent_locations(&prefix_collision).is_err());
    }

    #[test]
    fn npm_cache_update_is_independent_from_installed_runtime() {
        let root = storage_test_root("npm-cache-update");
        let current = StorageBootstrap::with_locations(
            root.clone(),
            root.join("workspace"),
            root.join("runtime"),
            Some(root.join("cache-old")),
            None,
            false,
        );
        let next_cache = root.join("cache-new");
        let next_cache_text = next_cache.to_string_lossy().to_string();
        let updated = layout_with_npm_cache(&current, Some(&next_cache_text)).unwrap();

        assert_eq!(updated.npm_cache_dir, Some(next_cache));
        assert_eq!(updated.runtime_dir, current.runtime_dir);
        assert_eq!(updated.workspace_dir, current.workspace_dir);
        let colliding_path = current.runtime_dir.to_string_lossy().to_string();
        assert!(layout_with_npm_cache(&current, Some(&colliding_path)).is_err());
        assert_eq!(
            layout_with_npm_cache(&current, None).unwrap().npm_cache_dir,
            None
        );
    }

    #[test]
    fn install_layout_rejects_nested_and_symlinked_locations() {
        let root = storage_test_root("layout-overlap");
        let mut nested = test_selection(&root);
        nested.npm_cache_dir = Some(
            PathBuf::from(&nested.runtime_dir)
                .join("nested-cache")
                .to_string_lossy()
                .to_string(),
        );
        let nested = selected_layout(root.clone(), nested).unwrap();
        assert!(validate_independent_locations(&nested).is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let real = root.join("real");
            std::fs::create_dir_all(&real).unwrap();
            let alias = root.join("alias");
            symlink(&real, &alias).unwrap();
            let layout = StorageBootstrap::with_locations(
                root.join("state"),
                real.join("workspace"),
                alias,
                Some(root.join("cache")),
                None,
                false,
            );
            assert!(validate_independent_locations(&layout).is_err());
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_overlap_is_grandfathered_without_allowing_new_prefix_overlap() {
        let root = storage_test_root("legacy-layout");
        let existing = StorageBootstrap::for_state_dir(root.clone(), Some(root.join("workspace")));
        let custom_prefix = StorageBootstrap::with_locations(
            root.clone(),
            existing.workspace_dir.clone(),
            existing.runtime_dir.clone(),
            existing.npm_cache_dir.clone(),
            Some(root.with_file_name("external-prefix")),
            true,
        );
        assert!(validate_location_changes(&custom_prefix, Some(&existing)).is_ok());

        let overlapping_prefix = StorageBootstrap::with_locations(
            root.clone(),
            existing.workspace_dir.clone(),
            existing.runtime_dir.clone(),
            existing.npm_cache_dir.clone(),
            Some(root.join("workspace").join("npm-prefix")),
            true,
        );
        assert!(validate_location_changes(&overlapping_prefix, Some(&existing)).is_err());
    }

    #[test]
    fn windows_path_overlap_handles_case_and_separator_boundaries() {
        let runtime = r"c:\users\wei\junqi runtime";
        assert!(path_strings_overlap(
            runtime,
            r"c:\users\wei\junqi runtime\node",
            '\\'
        ));
        assert!(!path_strings_overlap(
            runtime,
            r"c:\users\wei\junqi runtime-old",
            '\\'
        ));
    }

    #[test]
    fn bug_st02_copy_and_verify_directory_tree() {
        let root =
            std::env::temp_dir().join(format!("junqi-storage-test-{}", uuid::Uuid::new_v4()));
        let source = root.join("source");
        let target = root.join("target");
        std::fs::create_dir_all(source.join("agents/main")).unwrap();
        std::fs::write(source.join("openclaw.json"), b"{\"gateway\":{}}").unwrap();
        std::fs::write(source.join("agents/main/session.json"), b"session").unwrap();
        copy_tree(&source, &target).unwrap();
        assert_eq!(
            collect_stats(&source).unwrap(),
            collect_stats(&target).unwrap()
        );
        assert_eq!(
            hash_file(&source.join("openclaw.json")).unwrap(),
            hash_file(&target.join("openclaw.json")).unwrap()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn bug_st02_nested_target_is_detectable() {
        let source = PathBuf::from("/tmp/openclaw-source");
        assert!(source.join("nested").starts_with(&source));
    }

    #[test]
    fn bug_st07_migration_rewrites_workspace_inside_state_dir() {
        let root = storage_test_root("internal-workspace");
        let source = root.join("source");
        let target = root.join("target");
        let source_workspace = source.join("workspace-main");
        std::fs::create_dir_all(&source_workspace).unwrap();
        std::fs::write(
            source.join("openclaw.json"),
            serde_json::json!({
                "agents": { "defaults": { "workspace": source_workspace } }
            })
            .to_string(),
        )
        .unwrap();

        let migrated_workspace = target.join("workspace-main");
        let prepared = prepare_storage_target(
            &source,
            &target,
            true,
            test_layout(&target, migrated_workspace.clone()),
        )
        .unwrap();
        let migrated_config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(target.join("openclaw.json")).unwrap())
                .unwrap();

        assert_eq!(prepared.layout.workspace_dir, migrated_workspace);
        assert_eq!(
            migrated_config["agents"]["defaults"]["workspace"],
            serde_json::Value::String(migrated_workspace.to_string_lossy().to_string())
        );
        assert!(source.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_rewrites_workspace_in_a_json5_openclaw_config() {
        let root = storage_test_root("json5-workspace");
        let source = root.join("source");
        let target = root.join("target");
        let source_workspace = source.join("workspace");
        std::fs::create_dir_all(&source_workspace).unwrap();
        std::fs::write(
            source.join("openclaw.json"),
            r#"
            {
              // OpenClaw permits JSON5 syntax in user configuration.
              agents: { defaults: { workspace: "workspace", }, },
            }
            "#,
        )
        .unwrap();

        let migrated_workspace = target.join("workspace");
        prepare_storage_target(
            &source,
            &target,
            true,
            test_layout(&target, migrated_workspace.clone()),
        )
        .unwrap();
        let migrated = crate::commands::config::parse_openclaw_config(
            &std::fs::read_to_string(target.join("openclaw.json")).unwrap(),
        )
        .unwrap();

        assert_eq!(
            migrated["agents"]["defaults"]["workspace"],
            serde_json::Value::String(migrated_workspace.to_string_lossy().to_string())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unchanged_json5_workspace_does_not_rewrite_or_back_up_the_config() {
        let root = storage_test_root("json5-workspace-noop");
        std::fs::create_dir_all(&root).unwrap();
        let config = root.join("openclaw.json");
        let workspace = root.join("workspace");
        let raw = format!(
            "{{\n  // preserve this JSON5 comment\n  agents: {{ defaults: {{ workspace: {:?}, }}, }},\n}}\n",
            workspace.to_string_lossy()
        );
        std::fs::write(&config, &raw).unwrap();

        patch_configured_workspace(&config, &workspace).unwrap();

        assert_eq!(std::fs::read_to_string(&config).unwrap(), raw);
        assert!(!root.join("config-backups").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bug_rt01_migration_rewrites_the_selected_docker_config() {
        let root = storage_test_root("docker-runtime-config");
        let source = root.join("source");
        let target = root.join("target");
        let source_workspace = source.join("workspace-docker");
        std::fs::create_dir_all(source.join("docker")).unwrap();
        std::fs::create_dir_all(&source_workspace).unwrap();
        std::fs::write(
            source.join("openclaw.json"),
            serde_json::json!({
                "agents": { "defaults": { "workspace": source.join("native-workspace") } }
            })
            .to_string(),
        )
        .unwrap();
        std::fs::write(
            source.join("docker").join("openclaw.json"),
            serde_json::json!({
                "agents": { "defaults": { "workspace": source_workspace } }
            })
            .to_string(),
        )
        .unwrap();

        let migrated_workspace = target.join("workspace-docker");
        let mut layout = test_layout(&target, migrated_workspace.clone());
        layout.runtime_mode = OpenClawRuntimeMode::Docker;
        prepare_storage_target(&source, &target, true, layout).unwrap();
        let migrated_config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(target.join("docker").join("openclaw.json")).unwrap(),
        )
        .unwrap();
        let migrated_native_config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(target.join("openclaw.json")).unwrap())
                .unwrap();

        assert_eq!(
            migrated_config["agents"]["defaults"]["workspace"],
            serde_json::Value::String(
                crate::commands::docker::OPENCLAW_CONTAINER_WORKSPACE_DIR.to_string(),
            )
        );
        assert_eq!(
            migrated_native_config["agents"]["defaults"]["workspace"],
            serde_json::Value::String(migrated_workspace.to_string_lossy().to_string())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bug_st07_migration_preserves_external_workspace() {
        let root = storage_test_root("external-workspace");
        let source = root.join("source");
        let target = root.join("target");
        let external_workspace = root.join("shared-workspace");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&external_workspace).unwrap();
        std::fs::write(
            source.join("openclaw.json"),
            serde_json::json!({
                "agents": { "defaults": { "workspace": external_workspace } }
            })
            .to_string(),
        )
        .unwrap();

        let prepared = prepare_storage_target(
            &source,
            &target,
            true,
            test_layout(&target, external_workspace.clone()),
        )
        .unwrap();
        let migrated_config: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(target.join("openclaw.json")).unwrap())
                .unwrap();

        assert_eq!(prepared.layout.workspace_dir, external_workspace);
        assert_eq!(
            migrated_config["agents"]["defaults"]["workspace"],
            serde_json::Value::String(external_workspace.to_string_lossy().to_string())
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn external_config_keeps_its_workspace_during_state_migration() {
        let root = storage_test_root("external-config-workspace");
        let source = root.join("source");
        let target = root.join("target");
        let config = root.join("config").join("openclaw.json");
        let workspace = source.join("workspace");
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        std::fs::write(
            &config,
            serde_json::json!({
                "agents": { "defaults": { "workspace": workspace } }
            })
            .to_string(),
        )
        .unwrap();

        assert_eq!(configured_workspace(&source, &target, &config), workspace);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bug_st05_invalid_config_never_activates_migration_target() {
        let root = storage_test_root("invalid-config");
        let source = root.join("source");
        let target = root.join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("openclaw.json"), b"{invalid").unwrap();

        let result = prepare_storage_target(
            &source,
            &target,
            true,
            test_layout(&target, target.join("workspace")),
        );

        assert!(result.is_err());
        assert!(!target.exists());
        let leftovers = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != "source")
            .count();
        assert_eq!(leftovers, 0);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn bug_st08_symlinked_state_root_is_copied_without_mutating_source() {
        use std::os::unix::fs::symlink;

        let root = storage_test_root("symlink-root");
        let actual_source = root.join("actual-source");
        let source = root.join("source-link");
        let target = root.join("target");
        std::fs::create_dir_all(actual_source.join("workspace")).unwrap();
        symlink(&actual_source, &source).unwrap();
        let original_config = serde_json::json!({
            "agents": { "defaults": { "workspace": source.join("workspace") } }
        })
        .to_string();
        std::fs::write(actual_source.join("openclaw.json"), &original_config).unwrap();

        let prepared = prepare_storage_target(
            &source,
            &target,
            true,
            test_layout(&target, target.join("workspace")),
        )
        .unwrap();

        assert!(target.is_dir());
        assert!(!target.symlink_metadata().unwrap().file_type().is_symlink());
        assert_eq!(prepared.layout.workspace_dir, target.join("workspace"));
        assert_eq!(
            std::fs::read_to_string(actual_source.join("openclaw.json")).unwrap(),
            original_config,
            "migration must never patch the source through its symlink"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
