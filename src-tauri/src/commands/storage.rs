use crate::commands::gateway::{is_gateway_serving, resolve_openclaw_binary};
use crate::paths::{self, StorageBootstrap};
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::GatewayProcess;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};

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

fn emit_progress(app: &AppHandle, message: impl AsRef<str>, progress: f64) {
    let _ = app.emit(
        "storage-migration-progress",
        serde_json::json!({ "message": message.as_ref(), "progress": progress }),
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

fn configured_workspace(source: &Path, target: &Path) -> PathBuf {
    let source_default = source.join("workspace");
    let configured = paths::read_workspace_from_config(&source.join("openclaw.json"));
    match configured {
        Some(workspace) if workspace.starts_with(source) => workspace
            .strip_prefix(source)
            .map(|relative| target.join(relative))
            .unwrap_or_else(|_| target.join("workspace")),
        Some(workspace) => workspace,
        None => target.join(
            source_default
                .strip_prefix(source)
                .unwrap_or_else(|_| Path::new("workspace")),
        ),
    }
}

fn patch_migrated_workspace(config_path: &Path, old_state: &Path, new_state: &Path) {
    let Ok(raw) = std::fs::read_to_string(config_path) else {
        return;
    };
    let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return;
    };
    let Some(workspace) = config
        .get_mut("agents")
        .and_then(|v| v.get_mut("defaults"))
        .and_then(|v| v.get_mut("workspace"))
    else {
        return;
    };
    let Some(old_workspace) = workspace.as_str().map(PathBuf::from) else {
        return;
    };
    if !old_workspace.starts_with(old_state) {
        return;
    }
    let Ok(relative) = old_workspace.strip_prefix(old_state) else {
        return;
    };
    *workspace = serde_json::Value::String(new_state.join(relative).to_string_lossy().to_string());
    if let Ok(serialized) = serde_json::to_string_pretty(&config) {
        let _ = std::fs::write(config_path, serialized);
    }
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
    if !directory_is_empty(&target)? {
        return Err("Target directory must be empty".to_string());
    }

    let was_reachable = is_gateway_serving(port).await;
    emit_progress(&app, "正在停止旧 Gateway…", 0.08);
    stop_all_locked(&state, binary.as_deref(), &source, &old_config).await;

    let mut copied = DirectoryStats::default();
    if migrate_existing {
        if !source.exists() {
            return Err(format!(
                "Source directory does not exist: {}",
                source.display()
            ));
        }
        emit_progress(&app, "正在复制 OpenClaw 数据…", 0.28);
        let stage = target.with_file_name(format!(
            ".{}-junqi-migrating-{}",
            target
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("openclaw"),
            uuid::Uuid::new_v4()
        ));
        if stage.exists() {
            let _ = std::fs::remove_dir_all(&stage);
        }
        let source_for_copy = source.clone();
        let stage_for_copy = stage.clone();
        tokio::task::spawn_blocking(move || copy_tree(&source_for_copy, &stage_for_copy))
            .await
            .map_err(|e| format!("Migration worker failed: {}", e))??;

        emit_progress(&app, "正在校验迁移数据…", 0.62);
        let source_stats = collect_stats(&source)?;
        let stage_stats = collect_stats(&stage)?;
        if source_stats != stage_stats {
            let _ = std::fs::remove_dir_all(&stage);
            return Err(format!(
                "Migration verification failed: source={:?}, copied={:?}",
                source_stats, stage_stats
            ));
        }
        let source_config = source.join("openclaw.json");
        let copied_config = stage.join("openclaw.json");
        if source_config.exists()
            && (!copied_config.exists() || hash_file(&source_config)? != hash_file(&copied_config)?)
        {
            let _ = std::fs::remove_dir_all(&stage);
            return Err("Migration verification failed for openclaw.json".to_string());
        }
        if target.exists() {
            std::fs::remove_dir(&target)
                .map_err(|e| format!("Failed to prepare target directory: {}", e))?;
        }
        std::fs::rename(&stage, &target)
            .map_err(|e| format!("Failed to activate migrated directory: {}", e))?;
        patch_migrated_workspace(&target.join("openclaw.json"), &source, &target);
        copied = stage_stats;
    } else {
        std::fs::create_dir_all(target.join("workspace"))
            .map_err(|e| format!("Failed to create storage directory: {}", e))?;
    }

    emit_progress(&app, "正在切换存储位置…", 0.76);
    let workspace = if migrate_existing {
        configured_workspace(&source, &target)
    } else {
        target.join("workspace")
    };
    let layout = StorageBootstrap::for_state_dir(target.clone(), Some(workspace));
    if let Err(error) = paths::save_storage_bootstrap(&layout) {
        if let Some(old) = old_bootstrap.as_ref() {
            let _ = paths::save_storage_bootstrap(old);
        }
        return Err(error);
    }

    if migrate_existing && was_reachable {
        if let Some(binary) = binary.as_deref() {
            emit_progress(&app, "正在更新 Gateway 系统服务…", 0.86);
            let port_string = port.to_string();
            let service_result = async {
                run_gateway_service_command(
                    binary,
                    &layout.state_dir,
                    &layout.config_path,
                    &["gateway", "install", "--force", "--port", &port_string],
                )
                .await?;
                let _ = run_gateway_service_command(
                    binary,
                    &layout.state_dir,
                    &layout.config_path,
                    &["gateway", "start"],
                )
                .await;
                for _ in 0..30 {
                    if is_gateway_serving(port).await {
                        return Ok::<(), String>(());
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                }
                Err(format!(
                    "Gateway service did not become reachable on port {}",
                    port
                ))
            }
            .await;
            if let Err(service_error) = service_result {
                let _ = run_gateway_service_command(
                    binary,
                    &layout.state_dir,
                    &layout.config_path,
                    &["gateway", "stop"],
                )
                .await;
                if let Some(old) = old_bootstrap.as_ref() {
                    let _ = paths::save_storage_bootstrap(old);
                } else {
                    let _ = paths::remove_storage_bootstrap();
                }
                let _ = run_gateway_service_command(
                    binary,
                    &source,
                    &old_config,
                    &["gateway", "install", "--force", "--port", &port_string],
                )
                .await;
                let _ = run_gateway_service_command(
                    binary,
                    &source,
                    &old_config,
                    &["gateway", "start"],
                )
                .await;
                return Err(format!(
                    "Storage was copied but Gateway service migration failed: {}",
                    service_error
                ));
            }
        }
    }

    emit_progress(&app, "存储位置已更新", 1.0);
    Ok(StorageConfigureResult {
        state_dir: layout.state_dir.to_string_lossy().to_string(),
        config_path: layout.config_path.to_string_lossy().to_string(),
        workspace_dir: layout.workspace_dir.to_string_lossy().to_string(),
        migrated: migrate_existing,
        files_copied: copied.files,
        bytes_copied: copied.bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
