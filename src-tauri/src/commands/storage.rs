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

fn verify_directory_writable(path: &Path) -> Result<(), String> {
    let probe = path.join(format!(".junqi-write-probe-{}", uuid::Uuid::new_v4()));
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|error| format!("npm cache directory is not writable: {}", error))?;
    std::fs::remove_file(&probe)
        .map_err(|error| format!("Failed to remove npm cache write probe: {}", error))
}

async fn verify_state_directory_capability(
    state_dir: &Path,
    runtime_mode: OpenClawRuntimeMode,
) -> Result<(), String> {
    if matches!(runtime_mode, OpenClawRuntimeMode::Docker) {
        return crate::commands::openclaw_state_dir::verify_state_directory_basics(state_dir);
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

async fn verify_layout_storage_capability(layout: &StorageBootstrap) -> Result<(), String> {
    verify_state_directory_capability(&layout.state_dir, layout.runtime_mode).await?;
    let Some(config_parent) = layout.config_path.parent() else {
        return Err("OpenClaw config path has no parent directory".into());
    };
    if !paths::paths_refer_to_same_location(config_parent, &layout.state_dir) {
        verify_state_directory_capability(config_parent, layout.runtime_mode).await?;
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
    let mut config = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
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
    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize migrated config: {}", error))?;
    paths::atomic_write_text(config_path, &serialized).map_err(|error| {
        format!(
            "Failed to update migrated workspace in {}: {}",
            config_path.display(),
            error
        )
    })
}

struct TextFileSnapshot {
    path: PathBuf,
    original: Option<String>,
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
        })
    }

    fn restore(&self) -> Result<(), String> {
        match &self.original {
            Some(content) => paths::atomic_write_text(&self.path, content),
            None if self.path.exists() => std::fs::remove_file(&self.path).map_err(|error| {
                format!(
                    "Failed to remove {} during rollback: {}",
                    self.path.display(),
                    error
                )
            }),
            None => Ok(()),
        }
    }
}

struct StorageReconfiguration {
    old_bootstrap: Option<StorageBootstrap>,
    config_snapshots: Vec<RuntimeConfigSnapshot>,
    created_directories: Vec<PathBuf>,
}

struct RuntimeConfigSnapshot {
    file: TextFileSnapshot,
    mode: OpenClawRuntimeMode,
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
    fn sync_terminal() -> Result<(), String>;
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

    fn sync_terminal() -> Result<(), String> {
        crate::commands::terminal_integration::sync_terminal_integration().map(|_| ())
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
                TextFileSnapshot::capture(&path).map(|file| RuntimeConfigSnapshot { file, mode })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Self {
            old_bootstrap,
            config_snapshots,
            created_directories,
        })
    }

    fn apply(self, layout: &StorageBootstrap, sync_terminal: bool) -> Result<(), String> {
        self.apply_with::<SystemReconfigurationOperations>(layout, sync_terminal)
    }

    fn apply_with<O: ReconfigurationOperations>(
        self,
        layout: &StorageBootstrap,
        sync_terminal: bool,
    ) -> Result<(), String> {
        let result = self.apply_changes::<O>(layout, sync_terminal);
        match result {
            Ok(()) => Ok(()),
            Err(error) => Err(self.rollback::<O>(error)),
        }
    }

    fn apply_changes<O: ReconfigurationOperations>(
        &self,
        layout: &StorageBootstrap,
        sync_terminal: bool,
    ) -> Result<(), String> {
        O::ensure_layout(layout)?;
        for snapshot in &self.config_snapshots {
            if matches!(snapshot.mode, OpenClawRuntimeMode::Native)
                && !paths::paths_overlap(&snapshot.file.path, &layout.state_dir)
            {
                // An explicitly external Native config owns its workspace
                // outside the storage transaction. Do not rewrite that file
                // merely because the state-directory layout changed.
                continue;
            }
            O::patch_workspace(&snapshot.file.path, &layout.workspace_dir, snapshot.mode)?;
        }
        O::save_bootstrap(layout)?;
        if sync_terminal {
            O::sync_terminal()?;
        }
        Ok(())
    }

    fn rollback<O: ReconfigurationOperations>(&self, failure: String) -> String {
        let mut errors = Vec::new();
        if let Err(error) = O::restore_bootstrap(self.old_bootstrap.as_ref()) {
            errors.push(format!("restore bootstrap: {}", error));
        }
        for snapshot in self.config_snapshots.iter().rev() {
            if let Err(error) = snapshot.file.restore() {
                errors.push(format!("restore OpenClaw config: {}", error));
            }
        }
        if let Err(error) = O::sync_terminal() {
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
    let child = state.child.lock().ok().and_then(|mut child| child.take());
    if let Some(mut child) = child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
    }
    if matches!(paths::active_runtime_mode(), OpenClawRuntimeMode::Docker) {
        crate::commands::docker::stop_docker_gateway_locked().await?;
    }
    if selected_service {
        let binary = binary.ok_or_else(|| {
            "OpenClaw binary is unavailable; cannot stop the selected Gateway service".to_string()
        })?;
        let runtime =
            crate::commands::system::compatible_native_openclaw_runtime(binary.to_path_buf())
                .await?;
        if !crate::commands::gateway_service::stop_selected_gateway_service(
            &runtime,
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
    port: u16,
    selected_service: SelectedGatewayService,
}

impl PreviousGateway {
    fn restore_mode(self) -> GatewayRuntimeMode {
        if self.selected_service.running {
            GatewayRuntimeMode::SystemService
        } else {
            // An installed-but-stopped official service does not own the
            // endpoint that was observed before migration. Restore the
            // runtime that was actually serving it (managed child, Docker,
            // or an external endpoint) instead of promoting the stopped
            // service merely because its registration still exists.
            match self.runtime.mode {
                GatewayRuntimeMode::SystemService => GatewayRuntimeMode::ManagedChild,
                mode => mode,
            }
        }
    }

    fn was_running(self) -> bool {
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
    Ok(SelectedGatewayService {
        installed: selected && inspection.installed,
        running: selected && inspection.running,
    })
}

async fn start_runtime_locked(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    mode: GatewayRuntimeMode,
    port: u16,
    binary: Option<&Path>,
    state_dir: &Path,
    config_path: &Path,
    service_config_path: &Path,
) -> Result<(), String> {
    let strategy = if matches!(mode, GatewayRuntimeMode::SystemService) {
        RuntimeRestoreStrategy::SystemService
    } else {
        RuntimeRestoreStrategy::for_mode(mode)
    };
    let health_config_path = if matches!(strategy, RuntimeRestoreStrategy::SystemService) {
        service_config_path
    } else {
        config_path
    };
    if crate::commands::gateway::gateway_matches_config(port, health_config_path).await {
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
            crate::commands::gateway::start_gateway_locked(
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
                state_dir,
                service_config_path,
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

    wait_for_gateway(port, health_config_path, 30).await?;
    let final_mode = strategy.restored_mode();
    state.transition(
        Some(GatewayLifecycle::Running),
        Some(final_mode),
        None,
        "storage transaction: Gateway runtime healthy",
    );
    Ok(())
}

fn restore_bootstrap(old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String> {
    match old_bootstrap {
        Some(old) => paths::save_storage_bootstrap(old),
        None => paths::remove_storage_bootstrap(),
    }
}

fn cleanup_transaction_target(target: &Path) -> Result<(), String> {
    if !target.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(target).map_err(|error| {
        format!(
            "Failed to clean incomplete storage target {}: {}",
            target.display(),
            error
        )
    })
}

#[derive(Clone, Copy)]
enum TargetRollback {
    Preserve,
    Remove,
}

#[derive(Clone, Copy)]
enum BootstrapRollback {
    Unchanged,
    Restore,
}

#[derive(Clone, Copy)]
struct RollbackPolicy {
    target: TargetRollback,
    bootstrap: BootstrapRollback,
}

impl RollbackPolicy {
    const FRESH_PREPARATION: Self = Self {
        target: TargetRollback::Remove,
        bootstrap: BootstrapRollback::Unchanged,
    };
    const MIGRATION_PREPARATION: Self = Self {
        target: TargetRollback::Preserve,
        bootstrap: BootstrapRollback::Unchanged,
    };
    const AFTER_BOOTSTRAP_SAVE: Self = Self {
        target: TargetRollback::Remove,
        bootstrap: BootstrapRollback::Unchanged,
    };
    const AFTER_SWITCH: Self = Self {
        target: TargetRollback::Remove,
        bootstrap: BootstrapRollback::Restore,
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
        if matches!(policy.target, TargetRollback::Remove) {
            collect_rollback_error(
                &mut errors,
                "clean target",
                cleanup_transaction_target(self.target),
            );
        }
        self.restore_gateway(&mut errors).await;
        append_rollback_errors(failure, errors)
    }

    async fn restore_gateway(&self, errors: &mut Vec<String>) {
        // Reachability is only one observation. An installed Scheduled Task
        // can be running between probes, or can be intentionally stopped;
        // restore based on the captured deployment state rather than losing a
        // service merely because its endpoint was briefly unavailable.
        if self.previous.selected_service.installed {
            let service_restore = async {
                let binary = self.binary.ok_or_else(|| {
                    "OpenClaw binary is unavailable; cannot restore the selected Gateway service"
                        .to_string()
                })?;
                let runtime = crate::commands::system::compatible_native_openclaw_runtime(
                    binary.to_path_buf(),
                )
                .await?;
                let search_path = crate::commands::system::openclaw_search_path();
                crate::commands::gateway_service::install_selected_gateway_service_with_path(
                    &runtime,
                    self.old_state_dir,
                    self.old_native_config_path,
                    self.previous.port,
                    Some(&search_path),
                )
                .await?;
                if self.previous.selected_service.running {
                    crate::commands::gateway_service::start_selected_gateway_service_with_path(
                        &runtime,
                        self.old_state_dir,
                        self.old_native_config_path,
                        Some(&search_path),
                    )
                    .await?;
                    wait_for_gateway(self.previous.port, self.old_config_path, 30).await?;
                } else {
                    // `gateway install` may start the Windows task while
                    // registering it. Preserve an intentionally stopped
                    // service instead of leaving a new listener behind.
                    crate::commands::gateway_service::stop_selected_gateway_service(
                        &runtime,
                        self.old_state_dir,
                        self.old_native_config_path,
                        Some(&search_path),
                    )
                    .await?;
                }
                Ok::<(), String>(())
            }
            .await;
            let service_restore_succeeded = match service_restore {
                Ok(()) => true,
                Err(error) => {
                    errors.push(format!("restore previous Gateway service: {}", error));
                    self.state.transition(
                        Some(GatewayLifecycle::Error),
                        Some(GatewayRuntimeMode::None),
                        None,
                        "storage transaction rollback could not restore the official service",
                    );
                    false
                }
            };
            if !self.previous.was_running() {
                return;
            }
            if self.previous.selected_service.running && service_restore_succeeded {
                return;
            }
        }
        if !self.previous.was_running() {
            return;
        }
        let result = start_runtime_locked(
            self.app,
            self.state,
            self.previous.restore_mode(),
            self.previous.port,
            self.binary,
            self.old_state_dir,
            self.old_config_path,
            self.old_native_config_path,
        )
        .await;
        if let Err(error) = result {
            errors.push(format!("restore previous Gateway: {}", error));
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

#[tauri::command]
pub async fn get_storage_setup_status() -> Result<StorageSetupStatus, String> {
    let bootstrap = paths::load_storage_bootstrap();
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
    let configured = configuration_error.is_none() && (bootstrap.is_some() || state_overridden);
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
    if paths::explicit_config_path_override()?.is_none() {
        layout.config_path =
            config_path_for_storage_change(&old_native_config, &source, &target, migrate_existing);
    }
    layout.gateway_service_rebind_required = existing_layout.gateway_service_rebind_required;
    layout.gateway_service_was_running = existing_layout.gateway_service_was_running;
    layout.runtime_switch_rollback_mode = existing_layout.runtime_switch_rollback_mode;
    let native_runtime_reconfiguration =
        apply_runtime_location_transition(&existing_layout, &mut layout);
    let binary = crate::commands::system::resolve_openclaw_binary_async().await;
    let port = std::fs::read_to_string(&old_config)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|config| crate::commands::config::gateway_port_from_config(&config))
        .unwrap_or_else(crate::commands::config::default_gateway_port);

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
        if native_runtime_reconfiguration {
            stop_all_locked(
                &state,
                binary.as_deref(),
                &source,
                &old_native_config,
                previous.selected_service.running,
            )
            .await?;
            if let Err(error) =
                crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
            {
                let failure = format!(
                    "Gateway did not stop cleanly; runtime locations were not changed: {}",
                    error
                );
                let restore = if previous.was_running() {
                    start_runtime_locked(
                        &app,
                        &state,
                        previous.restore_mode(),
                        previous.port,
                        binary.as_deref(),
                        &source,
                        &old_config,
                        &old_native_config,
                    )
                    .await
                    .err()
                    .map(|error| format!("restore previous Gateway: {}", error))
                    .into_iter()
                    .collect()
                } else {
                    state.transition(
                        Some(GatewayLifecycle::Error),
                        Some(GatewayRuntimeMode::External),
                        None,
                        "storage reconfiguration: target port remains occupied",
                    );
                    Vec::new()
                };
                return Err(append_rollback_errors(failure, restore));
            }
        }
        if let Err(error) = StorageReconfiguration::begin(old_bootstrap, &old_config, &layout)?
            .apply(&layout, !native_runtime_reconfiguration)
        {
            if native_runtime_reconfiguration && previous.was_running() {
                let mut errors = Vec::new();
                if let Err(restore_error) = start_runtime_locked(
                    &app,
                    &state,
                    previous.restore_mode(),
                    previous.port,
                    binary.as_deref(),
                    &source,
                    &old_config,
                    &old_native_config,
                )
                .await
                {
                    errors.push(format!("restore previous Gateway: {}", restore_error));
                }
                return Err(append_rollback_errors(error, errors));
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
    };
    emit_progress(
        &app,
        "storage.progress.stoppingGateway",
        "Stopping the previous Gateway...",
        0.08,
    );
    if let Err(error) = stop_all_locked(
        &state,
        binary.as_deref(),
        &source,
        &old_native_config,
        previous.selected_service.running,
    )
    .await
    {
        return Err(error);
    }
    if let Err(error) = crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
    {
        if previous.was_running() {
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
            let restore_error = start_runtime_locked(
                &app,
                &state,
                previous.restore_mode(),
                port,
                binary.as_deref(),
                &source,
                &old_config,
                &old_native_config,
            )
            .await
            .err();
            return Err(match restore_error {
                Some(restore_error) => format!(
                    "Gateway did not stop cleanly: {}; restore failed: {}",
                    error, restore_error
                ),
                None => format!("Gateway did not stop cleanly: {}", error),
            });
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
        if let Err(error) = crate::commands::terminal_integration::sync_terminal_integration() {
            let failure = rollback.run(RollbackPolicy::AFTER_SWITCH, error).await;
            let _ = crate::commands::terminal_integration::sync_terminal_integration();
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
                .run(
                    RollbackPolicy::AFTER_SWITCH,
                    format!(
                        "Gateway service rebind failed after storage migration: {}",
                        error
                    ),
                )
                .await;
            return Err(failure);
        }
    }

    if migrate_existing && previous.was_running() && !native_runtime_reconfiguration {
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
            &prepared.layout.state_dir,
            &prepared_config_path,
            &prepared.layout.config_path,
        )
        .await
        {
            stop_all_locked(
                &state,
                binary.as_deref(),
                &prepared.layout.state_dir,
                &prepared.layout.config_path,
                previous.selected_service.running,
            )
            .await
            .ok();
            let failure = rollback
                .run(
                    RollbackPolicy::AFTER_SWITCH,
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
            port: 18_789,
            selected_service: SelectedGatewayService {
                installed: true,
                running: false,
            },
        };

        assert!(previous.was_running());
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
            Ok(())
        }

        fn sync_terminal() -> Result<(), String> {
            Ok(())
        }
    }

    #[test]
    fn same_location_reconfiguration_rolls_back_config_and_directories() {
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
            .unwrap_err();

        assert!(error.contains("injected bootstrap failure"));
        assert_eq!(std::fs::read_to_string(&config_path).unwrap(), original);
        for path in layout_directories(&layout) {
            if path != root {
                assert!(!path.exists(), "{} should be rolled back", path.display());
            }
        }
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
