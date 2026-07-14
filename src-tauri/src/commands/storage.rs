use crate::commands::gateway::{is_gateway_serving, resolve_openclaw_binary};
use crate::paths::{self, StorageBootstrap};
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
    state_dir: String,
    config_path: String,
    workspace_dir: String,
    runtime_dir: String,
    npm_cache_dir: String,
    npm_prefix: Option<String>,
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
    npm_cache_dir: String,
    npm_prefix: Option<String>,
    terminal_integration: bool,
    migrated: bool,
    files_copied: u64,
    bytes_copied: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallLocationSelection {
    workspace_dir: String,
    runtime_dir: String,
    npm_cache_dir: String,
    npm_prefix: Option<String>,
    terminal_integration: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct DirectoryStats {
    files: u64,
    bytes: u64,
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
    if metadata.file_type().is_symlink() || metadata.is_file() {
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
    if metadata.file_type().is_symlink() {
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

fn required_absolute_path(label: &str, raw: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(raw.trim());
    if raw.trim().is_empty() {
        return Err(format!("{} is required", label));
    }
    if !path.is_absolute() {
        return Err(format!("{} must be an absolute path", label));
    }
    if path.parent().is_none() {
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

fn normalize_existing_prefix(path: &Path) -> PathBuf {
    let mut cursor = path;
    let mut missing = Vec::new();
    while !cursor.exists() {
        let Some(name) = cursor.file_name() else {
            break;
        };
        missing.push(name.to_os_string());
        let Some(parent) = cursor.parent() else {
            break;
        };
        cursor = parent;
    }
    let mut normalized = std::fs::canonicalize(cursor).unwrap_or_else(|_| cursor.to_path_buf());
    for component in missing.into_iter().rev() {
        normalized.push(component);
    }
    normalized
}

fn comparable_path(path: &Path) -> String {
    let value = normalize_existing_prefix(path)
        .to_string_lossy()
        .to_string();
    if cfg!(windows) {
        value.replace('/', "\\").to_lowercase()
    } else {
        value
    }
}

fn locations_overlap(left: &Path, right: &Path) -> bool {
    let left = comparable_path(left);
    let right = comparable_path(right);
    path_strings_overlap(&left, &right, if cfg!(windows) { '\\' } else { '/' })
}

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
        ("managed runtime", layout.runtime_dir.as_path()),
        ("npm cache", layout.npm_cache_dir.as_path()),
    ];
    if let Some(prefix) = &layout.npm_prefix {
        locations.push(("npm global prefix", prefix.as_path()));
    }
    locations
}

fn validate_location_changes(
    layout: &StorageBootstrap,
    existing: Option<&StorageBootstrap>,
) -> Result<(), String> {
    let locations = layout_locations(layout);
    let existing_locations = existing.map(layout_locations).unwrap_or_default();
    for (index, (left_label, left)) in locations.iter().enumerate() {
        for (right_label, right) in locations.iter().skip(index + 1) {
            if locations_overlap(left, right) {
                let overlap_is_unchanged = existing.is_some()
                    && existing_locations
                        .iter()
                        .find(|(label, _)| label == left_label)
                        .is_some_and(|(_, path)| path == left)
                    && existing_locations
                        .iter()
                        .find(|(label, _)| label == right_label)
                        .is_some_and(|(_, path)| path == right)
                    && locations_overlap(left, right);
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
    let runtime = required_absolute_path("Managed runtime directory", &selection.runtime_dir)?;
    let npm_cache = required_absolute_path("npm cache directory", &selection.npm_cache_dir)?;
    let npm_prefix = optional_absolute_path("npm global prefix", selection.npm_prefix.as_deref())?;

    Ok(StorageBootstrap::with_locations(
        state_dir,
        workspace,
        runtime,
        npm_cache,
        npm_prefix,
        selection.terminal_integration,
    ))
}

fn layout_with_npm_cache(
    current: &StorageBootstrap,
    npm_cache_dir: &str,
) -> Result<StorageBootstrap, String> {
    let mut updated = current.clone();
    updated.npm_cache_dir = required_absolute_path("npm cache directory", npm_cache_dir)?;
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

fn ensure_layout_directories(layout: &StorageBootstrap) -> Result<(), String> {
    for (label, path) in [
        ("OpenClaw state", &layout.state_dir),
        ("workspace", &layout.workspace_dir),
        ("managed runtime", &layout.runtime_dir),
        ("npm cache", &layout.npm_cache_dir),
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
    if let Some(prefix) = &layout.npm_prefix {
        std::fs::create_dir_all(prefix).map_err(|error| {
            format!(
                "Failed to create npm prefix {}: {}",
                prefix.display(),
                error
            )
        })?;
    }
    Ok(())
}

fn map_workspace_to_target(workspace: &Path, source: &Path, target: &Path) -> Option<PathBuf> {
    if let Ok(relative) = workspace.strip_prefix(source) {
        return Some(target.join(relative));
    }
    let canonical_source = std::fs::canonicalize(source).ok()?;
    let relative = workspace.strip_prefix(canonical_source).ok()?;
    Some(target.join(relative))
}

fn configured_workspace(source: &Path, target: &Path) -> PathBuf {
    let source_default = source.join("workspace");
    let configured = paths::read_workspace_from_config(&source.join("openclaw.json"));
    match configured {
        Some(workspace) => map_workspace_to_target(&workspace, source, target).unwrap_or(workspace),
        None => target.join(
            source_default
                .strip_prefix(source)
                .unwrap_or_else(|_| Path::new("workspace")),
        ),
    }
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
    config_snapshot: TextFileSnapshot,
    created_directories: Vec<PathBuf>,
}

trait ReconfigurationOperations {
    fn ensure_layout(layout: &StorageBootstrap) -> Result<(), String>;
    fn patch_workspace(config_path: &Path, workspace_dir: &Path) -> Result<(), String>;
    fn save_bootstrap(layout: &StorageBootstrap) -> Result<(), String>;
    fn restore_bootstrap(old_bootstrap: Option<&StorageBootstrap>) -> Result<(), String>;
    fn sync_terminal() -> Result<(), String>;
}

struct SystemReconfigurationOperations;

impl ReconfigurationOperations for SystemReconfigurationOperations {
    fn ensure_layout(layout: &StorageBootstrap) -> Result<(), String> {
        ensure_layout_directories(layout)
    }

    fn patch_workspace(config_path: &Path, workspace_dir: &Path) -> Result<(), String> {
        patch_configured_workspace(config_path, workspace_dir)
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
        Ok(Self {
            old_bootstrap,
            config_snapshot: TextFileSnapshot::capture(config_path)?,
            created_directories,
        })
    }

    fn apply(self, layout: &StorageBootstrap) -> Result<(), String> {
        self.apply_with::<SystemReconfigurationOperations>(layout)
    }

    fn apply_with<O: ReconfigurationOperations>(
        self,
        layout: &StorageBootstrap,
    ) -> Result<(), String> {
        let result = self.apply_changes::<O>(layout);
        match result {
            Ok(()) => Ok(()),
            Err(error) => Err(self.rollback::<O>(error)),
        }
    }

    fn apply_changes<O: ReconfigurationOperations>(
        &self,
        layout: &StorageBootstrap,
    ) -> Result<(), String> {
        O::ensure_layout(layout)?;
        O::patch_workspace(&self.config_snapshot.path, &layout.workspace_dir)?;
        O::save_bootstrap(layout)?;
        O::sync_terminal()?;
        Ok(())
    }

    fn rollback<O: ReconfigurationOperations>(&self, failure: String) -> String {
        let mut errors = Vec::new();
        if let Err(error) = O::restore_bootstrap(self.old_bootstrap.as_ref()) {
            errors.push(format!("restore bootstrap: {}", error));
        }
        if let Err(error) = self.config_snapshot.restore() {
            errors.push(format!("restore OpenClaw config: {}", error));
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
        layout.npm_cache_dir.clone(),
    ];
    if let Some(prefix) = &layout.npm_prefix {
        directories.push(prefix.clone());
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

fn prepare_storage_target(
    source: &Path,
    target: &Path,
    migrate_existing: bool,
    layout: StorageBootstrap,
) -> Result<PreparedStorage, String> {
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
        let source_config = copy_source.join("openclaw.json");
        let copied_config = stage.path.join("openclaw.json");
        if source_config.exists()
            && (!copied_config.exists() || hash_file(&source_config)? != hash_file(&copied_config)?)
        {
            return Err("Migration verification failed for openclaw.json".to_string());
        }
        patch_configured_workspace(&copied_config, &layout.workspace_dir)?;
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

async fn run_gateway_service_command(
    binary: &Path,
    state_dir: &Path,
    config_path: &Path,
    args: &[&str],
) -> Result<(), String> {
    let output = tokio::process::Command::new(binary)
        .args(args)
        .env("PATH", crate::commands::system::openclaw_search_path())
        .env("OPENCLAW_STATE_DIR", state_dir)
        .env("OPENCLAW_CONFIG_PATH", config_path)
        .output()
        .await
        .map_err(|e| format!("Failed to run OpenClaw service command: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("OpenClaw service command exited with {}", output.status)
        } else {
            stderr
        })
    }
}

async fn stop_all_locked(
    state: &State<'_, GatewayProcess>,
    binary: Option<&Path>,
    state_dir: &Path,
    config_path: &Path,
) {
    let child = state.child.lock().ok().and_then(|mut child| child.take());
    if let Some(mut child) = child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
    }
    let _ = crate::commands::docker::stop_docker_gateway_locked().await;
    if let Some(binary) = binary {
        let _ =
            run_gateway_service_command(binary, state_dir, config_path, &["gateway", "stop"]).await;
    }
    state.transition(
        Some(GatewayLifecycle::Stopped),
        Some(GatewayRuntimeMode::None),
        None,
        "storage migration: all managed runtimes stopped",
    );
}

#[derive(Debug, Clone, Copy)]
struct PreviousGateway {
    reachable: bool,
    runtime: GatewayRuntimeState,
    port: u16,
}

async fn wait_for_gateway(port: u16, attempts: usize) -> Result<(), String> {
    for _ in 0..attempts {
        if is_gateway_serving(port).await {
            return Ok(());
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
    Err(format!("Gateway did not become reachable on port {}", port))
}

async fn start_runtime_locked(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    mode: GatewayRuntimeMode,
    port: u16,
    binary: Option<&Path>,
    state_dir: &Path,
    config_path: &Path,
) -> Result<(), String> {
    if is_gateway_serving(port).await {
        state.transition(
            Some(GatewayLifecycle::Running),
            Some(mode),
            None,
            "storage transaction: existing runtime is reachable",
        );
        return Ok(());
    }

    match mode {
        GatewayRuntimeMode::Docker => {
            crate::commands::docker::start_docker_gateway_locked(app.clone(), Some(port), None)
                .await?;
            state.transition(
                Some(GatewayLifecycle::Running),
                Some(GatewayRuntimeMode::Docker),
                None,
                "storage transaction: Docker runtime restored",
            );
        }
        GatewayRuntimeMode::ManagedChild => {
            crate::commands::gateway::start_gateway_locked(
                app.clone(),
                app.state::<GatewayProcess>(),
                Some(port),
            )
            .await?;
        }
        GatewayRuntimeMode::External
        | GatewayRuntimeMode::SystemService
        | GatewayRuntimeMode::None => {
            let binary = binary.ok_or_else(|| {
                "OpenClaw binary is unavailable; cannot restore the Gateway service".to_string()
            })?;
            let port_string = port.to_string();
            run_gateway_service_command(
                binary,
                state_dir,
                config_path,
                &["gateway", "install", "--force", "--port", &port_string],
            )
            .await?;
            run_gateway_service_command(binary, state_dir, config_path, &["gateway", "start"])
                .await?;
            state.transition(
                Some(GatewayLifecycle::Starting),
                Some(GatewayRuntimeMode::SystemService),
                None,
                "storage transaction: Gateway service starting",
            );
        }
    }

    wait_for_gateway(port, 30).await?;
    let final_mode = match mode {
        GatewayRuntimeMode::None | GatewayRuntimeMode::External => {
            GatewayRuntimeMode::SystemService
        }
        other => other,
    };
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
        if !self.previous.reachable {
            return;
        }
        let result = start_runtime_locked(
            self.app,
            self.state,
            self.previous.runtime.mode,
            self.previous.port,
            self.binary,
            self.old_state_dir,
            self.old_config_path,
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
    let legacy = paths::legacy_default_state_dir();
    let configured = bootstrap.is_some() || std::env::var_os("OPENCLAW_STATE_DIR").is_some();
    let stats = if configured {
        DirectoryStats::default()
    } else {
        let legacy_for_stats = legacy.clone();
        tokio::task::spawn_blocking(move || collect_stats(&legacy_for_stats).unwrap_or_default())
            .await
            .map_err(|e| format!("Failed to inspect existing storage: {}", e))?
    };
    let layout = bootstrap
        .clone()
        .unwrap_or_else(|| StorageBootstrap::for_state_dir(legacy.clone(), None));
    Ok(StorageSetupStatus {
        configured,
        state_dir: layout.state_dir.to_string_lossy().to_string(),
        config_path: layout.config_path.to_string_lossy().to_string(),
        workspace_dir: layout.workspace_dir.to_string_lossy().to_string(),
        runtime_dir: layout.runtime_dir.to_string_lossy().to_string(),
        npm_cache_dir: layout.npm_cache_dir.to_string_lossy().to_string(),
        npm_prefix: layout
            .npm_prefix
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        terminal_integration: layout.terminal_integration,
        terminal_launcher_dir: paths::terminal_launcher_dir().to_string_lossy().to_string(),
        legacy_dir: legacy.to_string_lossy().to_string(),
        legacy_exists: legacy.exists(),
        legacy_size_bytes: stats.bytes,
    })
}

#[tauri::command]
pub async fn update_npm_cache_directory(npm_cache_dir: String) -> Result<String, String> {
    let current = paths::load_storage_bootstrap()
        .ok_or("Storage setup must be completed before changing the npm cache directory")?;
    let updated = layout_with_npm_cache(&current, &npm_cache_dir)?;
    let directory = updated.npm_cache_dir.clone();
    let existed = directory.exists();
    std::fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "Failed to create npm cache directory {}: {}",
            directory.display(),
            error
        )
    })?;
    verify_directory_writable(&directory)?;
    if let Err(error) = paths::save_storage_bootstrap(&updated) {
        if !existed {
            let _ = std::fs::remove_dir(&directory);
        }
        return Err(error);
    }
    Ok(directory.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn configure_storage(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    target_dir: String,
    migrate_existing: bool,
    locations: InstallLocationSelection,
) -> Result<StorageConfigureResult, String> {
    let target = required_absolute_path("OpenClaw state directory", &target_dir)?;

    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let old_bootstrap = paths::load_storage_bootstrap();
    let source = paths::desktop_dir();
    let old_config = paths::config_path();
    let layout = selected_layout(target.clone(), locations)?;
    let binary = resolve_openclaw_binary();
    let port = std::fs::read_to_string(&old_config)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|config| crate::commands::config::gateway_port_from_config(&config))
        .unwrap_or_else(crate::commands::config::default_gateway_port);

    if target == source {
        let existing_layout = old_bootstrap.clone().unwrap_or_else(|| {
            StorageBootstrap::for_state_dir(
                source.clone(),
                Some(configured_workspace(&source, &source)),
            )
        });
        validate_location_changes(&layout, Some(&existing_layout))?;
        StorageReconfiguration::begin(old_bootstrap, &old_config, &layout)?.apply(&layout)?;
        return Ok(StorageConfigureResult {
            state_dir: layout.state_dir.to_string_lossy().to_string(),
            config_path: layout.config_path.to_string_lossy().to_string(),
            workspace_dir: layout.workspace_dir.to_string_lossy().to_string(),
            runtime_dir: layout.runtime_dir.to_string_lossy().to_string(),
            npm_cache_dir: layout.npm_cache_dir.to_string_lossy().to_string(),
            npm_prefix: layout
                .npm_prefix
                .as_ref()
                .map(|path| path.to_string_lossy().to_string()),
            terminal_integration: layout.terminal_integration,
            migrated: false,
            files_copied: 0,
            bytes_copied: 0,
        });
    }

    if migrate_existing && target.starts_with(&source) {
        return Err("Target directory cannot be inside the current state directory".to_string());
    }
    if migrate_existing && !source.exists() {
        return Err(format!(
            "Source directory does not exist: {}",
            source.display()
        ));
    }
    if migrate_existing {
        let existing_layout = old_bootstrap.clone().unwrap_or_else(|| {
            StorageBootstrap::for_state_dir(
                source.clone(),
                Some(configured_workspace(&source, &source)),
            )
        });
        let expected_workspace = configured_workspace(&source, &target);
        let expected_runtime =
            map_workspace_to_target(&existing_layout.runtime_dir, &source, &target)
                .unwrap_or(existing_layout.runtime_dir);
        let expected_cache =
            map_workspace_to_target(&existing_layout.npm_cache_dir, &source, &target)
                .unwrap_or(existing_layout.npm_cache_dir);
        if layout.workspace_dir != expected_workspace
            || layout.runtime_dir != expected_runtime
            || layout.npm_cache_dir != expected_cache
        {
            return Err(
                "Custom workspace, runtime, or cache locations require a fresh setup; migration preserves the existing layout"
                    .into(),
            );
        }
        let expected_layout = StorageBootstrap::with_locations(
            target.clone(),
            expected_workspace,
            expected_runtime,
            expected_cache,
            existing_layout.npm_prefix,
            existing_layout.terminal_integration,
        );
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
    if !directory_is_empty(&target)? {
        return Err("Target directory must be empty".to_string());
    }

    let previous = PreviousGateway {
        reachable: is_gateway_serving(port).await,
        runtime: state.runtime_snapshot()?,
        port,
    };
    let rollback = StorageRollbackContext {
        app: &app,
        state: &state,
        previous,
        old_bootstrap: old_bootstrap.as_ref(),
        old_state_dir: &source,
        old_config_path: &old_config,
        binary: binary.as_deref(),
        target: &target,
    };
    emit_progress(
        &app,
        "storage.progress.stoppingGateway",
        "Stopping the previous Gateway...",
        0.08,
    );
    stop_all_locked(&state, binary.as_deref(), &source, &old_config).await;
    if let Err(error) = crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await
    {
        if previous.reachable {
            if is_gateway_serving(port).await {
                state.transition(
                    Some(GatewayLifecycle::Running),
                    Some(previous.runtime.mode),
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
                previous.runtime.mode,
                port,
                binary.as_deref(),
                &source,
                &old_config,
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
    if let Err(error) = crate::commands::terminal_integration::sync_terminal_integration() {
        let failure = rollback.run(RollbackPolicy::AFTER_SWITCH, error).await;
        let _ = crate::commands::terminal_integration::sync_terminal_integration();
        return Err(failure);
    }

    if migrate_existing && previous.reachable {
        emit_progress(
            &app,
            "storage.progress.startingGateway",
            "Starting Gateway from the new storage location...",
            0.86,
        );
        if let Err(error) = start_runtime_locked(
            &app,
            &state,
            previous.runtime.mode,
            port,
            binary.as_deref(),
            &prepared.layout.state_dir,
            &prepared.layout.config_path,
        )
        .await
        {
            stop_all_locked(
                &state,
                binary.as_deref(),
                &prepared.layout.state_dir,
                &prepared.layout.config_path,
            )
            .await;
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
        config_path: prepared.layout.config_path.to_string_lossy().to_string(),
        workspace_dir: prepared.layout.workspace_dir.to_string_lossy().to_string(),
        runtime_dir: prepared.layout.runtime_dir.to_string_lossy().to_string(),
        npm_cache_dir: prepared.layout.npm_cache_dir.to_string_lossy().to_string(),
        npm_prefix: prepared
            .layout
            .npm_prefix
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        terminal_integration: prepared.layout.terminal_integration,
        migrated: migrate_existing,
        files_copied: prepared.copied.files,
        bytes_copied: prepared.copied.bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
            target.join("npm-cache"),
            None,
            false,
        )
    }

    fn test_selection(root: &Path) -> InstallLocationSelection {
        InstallLocationSelection {
            workspace_dir: root.join("workspace").to_string_lossy().to_string(),
            runtime_dir: root.join("runtime").to_string_lossy().to_string(),
            npm_cache_dir: root.join("npm-cache").to_string_lossy().to_string(),
            npm_prefix: None,
            terminal_integration: false,
        }
    }

    struct FailAfterConfigPatch;

    impl ReconfigurationOperations for FailAfterConfigPatch {
        fn ensure_layout(layout: &StorageBootstrap) -> Result<(), String> {
            ensure_layout_directories(layout)
        }

        fn patch_workspace(config_path: &Path, workspace_dir: &Path) -> Result<(), String> {
            patch_configured_workspace(config_path, workspace_dir)
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
            root.join("cache-new"),
            Some(root.join("prefix-new")),
            false,
        );

        let transaction = StorageReconfiguration::begin(None, &config_path, &layout).unwrap();
        let error = transaction
            .apply_with::<FailAfterConfigPatch>(&layout)
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
        duplicate.npm_cache_dir = duplicate.runtime_dir.clone();
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
            root.join("cache-old"),
            None,
            false,
        );
        let next_cache = root.join("cache-new");
        let updated = layout_with_npm_cache(&current, &next_cache.to_string_lossy()).unwrap();

        assert_eq!(updated.npm_cache_dir, next_cache);
        assert_eq!(updated.runtime_dir, current.runtime_dir);
        assert_eq!(updated.workspace_dir, current.workspace_dir);
        assert!(layout_with_npm_cache(&current, &current.runtime_dir.to_string_lossy()).is_err());
    }

    #[test]
    fn install_layout_rejects_nested_and_symlinked_locations() {
        let root = storage_test_root("layout-overlap");
        let mut nested = test_selection(&root);
        nested.npm_cache_dir = PathBuf::from(&nested.runtime_dir)
            .join("nested-cache")
            .to_string_lossy()
            .to_string();
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
                root.join("cache"),
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
