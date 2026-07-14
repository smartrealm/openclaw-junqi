use crate::commands::gateway::{is_gateway_serving, resolve_openclaw_binary};
use crate::paths::{self, StorageBootstrap};
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode, GatewayRuntimeState};
use crate::state::GatewayProcess;
use serde::Serialize;
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
    migrated: bool,
    files_copied: u64,
    bytes_copied: u64,
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

fn patch_migrated_workspace(
    config_path: &Path,
    old_state: &Path,
    new_state: &Path,
) -> Result<(), String> {
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
    let Some(workspace) = config
        .get_mut("agents")
        .and_then(|v| v.get_mut("defaults"))
        .and_then(|v| v.get_mut("workspace"))
    else {
        return Ok(());
    };
    let Some(raw_workspace) = workspace.as_str() else {
        return Ok(());
    };
    let old_workspace = paths::resolve_openclaw_user_path(raw_workspace)?;
    let Some(new_workspace) = map_workspace_to_target(&old_workspace, old_state, new_state) else {
        return Ok(());
    };
    *workspace = serde_json::Value::String(new_workspace.to_string_lossy().to_string());
    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize migrated config: {}", error))?;
    std::fs::write(config_path, serialized).map_err(|error| {
        format!(
            "Failed to update migrated workspace in {}: {}",
            config_path.display(),
            error
        )
    })
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
        patch_migrated_workspace(&copied_config, source, target)?;
        stage.activate(target)?;
        source_stats
    } else {
        std::fs::create_dir_all(target.join("workspace"))
            .map_err(|error| format!("Failed to create storage directory: {}", error))?;
        DirectoryStats::default()
    };

    let workspace = if migrate_existing {
        configured_workspace(source, target)
    } else {
        target.join("workspace")
    };
    Ok(PreparedStorage {
        layout: StorageBootstrap::for_state_dir(target.to_path_buf(), Some(workspace)),
        copied,
    })
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

async fn rollback_storage_transaction(
    app: &AppHandle,
    state: &State<'_, GatewayProcess>,
    previous: PreviousGateway,
    old_bootstrap: Option<&StorageBootstrap>,
    old_state_dir: &Path,
    old_config_path: &Path,
    binary: Option<&Path>,
    target: &Path,
    cleanup_target: bool,
    bootstrap_switched: bool,
    failure: String,
) -> String {
    let mut rollback_errors = Vec::new();
    if bootstrap_switched {
        if let Err(error) = restore_bootstrap(old_bootstrap) {
            rollback_errors.push(format!("restore bootstrap: {}", error));
        }
    }
    if cleanup_target {
        if let Err(error) = cleanup_transaction_target(target) {
            rollback_errors.push(error);
        }
    }
    if previous.reachable {
        if let Err(error) = start_runtime_locked(
            app,
            state,
            previous.runtime.mode,
            previous.port,
            binary,
            old_state_dir,
            old_config_path,
        )
        .await
        {
            rollback_errors.push(format!("restore previous Gateway: {}", error));
            state.transition(
                Some(GatewayLifecycle::Error),
                Some(GatewayRuntimeMode::None),
                None,
                "storage transaction rollback failed",
            );
        }
    }

    if rollback_errors.is_empty() {
        failure
    } else {
        format!(
            "{}; rollback issues: {}",
            failure,
            rollback_errors.join("; ")
        )
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
        legacy_dir: legacy.to_string_lossy().to_string(),
        legacy_exists: legacy.exists(),
        legacy_size_bytes: stats.bytes,
    })
}

#[tauri::command]
pub async fn configure_storage(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
    target_dir: String,
    migrate_existing: bool,
) -> Result<StorageConfigureResult, String> {
    let target = PathBuf::from(target_dir);
    if !target.is_absolute() {
        return Err("Storage directory must be an absolute path".to_string());
    }

    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let old_bootstrap = paths::load_storage_bootstrap();
    let source = paths::desktop_dir();
    let old_config = paths::config_path();
    let binary = resolve_openclaw_binary();
    let port = std::fs::read_to_string(&old_config)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|config| config.get("gateway")?.get("port")?.as_u64())
        .map(|value| value as u16)
        .unwrap_or(18789);

    if target == source {
        let layout = StorageBootstrap::for_state_dir(
            target.clone(),
            Some(configured_workspace(&source, &target)),
        );
        paths::save_storage_bootstrap(&layout)?;
        return Ok(StorageConfigureResult {
            state_dir: layout.state_dir.to_string_lossy().to_string(),
            config_path: layout.config_path.to_string_lossy().to_string(),
            workspace_dir: layout.workspace_dir.to_string_lossy().to_string(),
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
    let prepared = match tokio::task::spawn_blocking(move || {
        prepare_storage_target(&source_for_prepare, &target_for_prepare, migrate_existing)
    })
    .await
    {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(error)) => {
            let failure = rollback_storage_transaction(
                &app,
                &state,
                previous,
                old_bootstrap.as_ref(),
                &source,
                &old_config,
                binary.as_deref(),
                &target,
                !migrate_existing,
                false,
                error,
            )
            .await;
            return Err(failure);
        }
        Err(error) => {
            let failure = rollback_storage_transaction(
                &app,
                &state,
                previous,
                old_bootstrap.as_ref(),
                &source,
                &old_config,
                binary.as_deref(),
                &target,
                !migrate_existing,
                false,
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
        let failure = rollback_storage_transaction(
            &app,
            &state,
            previous,
            old_bootstrap.as_ref(),
            &source,
            &old_config,
            binary.as_deref(),
            &target,
            true,
            false,
            error,
        )
        .await;
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
            let failure = rollback_storage_transaction(
                &app,
                &state,
                previous,
                old_bootstrap.as_ref(),
                &source,
                &old_config,
                binary.as_deref(),
                &target,
                true,
                true,
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

        let prepared = prepare_storage_target(&source, &target, true).unwrap();
        let migrated_workspace = target.join("workspace-main");
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

        let prepared = prepare_storage_target(&source, &target, true).unwrap();
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

        let result = prepare_storage_target(&source, &target, true);

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

        let prepared = prepare_storage_target(&source, &target, true).unwrap();

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
