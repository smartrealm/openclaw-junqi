//! OpenClaw package installation: install-target resolution, staged install
//! validation, and atomic promotion on Windows and Unix.

use super::*;

pub(super) struct OpenclawInstallTarget {
    pub(super) release: npm_registry::OpenclawReleaseTarget,
    pub(super) node_requirement: NodeRuntimeRequirement,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum OpenclawInstallTargetResolution {
    Latest,
    PinnedRelocation(paths::OpenclawRelocationContract),
}

impl OpenclawInstallTargetResolution {
    pub(super) fn for_install(
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

pub(super) async fn target_openclaw_install_target(
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
pub(super) async fn selected_node_npm_prefix(
    node: &crate::commands::system::NodeStatus,
) -> Option<PathBuf> {
    crate::commands::system::npm_global_prefix_for_node(node).await
}

pub(super) fn prefix_bin_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    }
}

pub(super) fn prefix_bin_is_on_login_path(prefix: &std::path::Path) -> bool {
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

pub(super) async fn pick_install_target(
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
pub(super) fn try_use_prefix(path: &std::path::Path) -> bool {
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

pub(super) fn openclaw_node_modules_dir(prefix: &std::path::Path) -> PathBuf {
    if cfg!(windows) {
        prefix.join("node_modules")
    } else {
        prefix.join("lib").join("node_modules")
    }
}

pub(super) fn windows_openclaw_package_dir(prefix: &std::path::Path) -> PathBuf {
    prefix.join("node_modules").join("openclaw")
}

pub(super) fn validate_staged_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
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

pub(super) async fn validate_staged_openclaw_package(
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

pub(super) const OPENCLAW_PROMOTION_MARKER: &str = ".junqi-openclaw-promotion.json";
pub(super) const OPENCLAW_PROMOTION_BACKUP: &str = ".junqi-openclaw-promotion-backup";
pub(super) const OPENCLAW_PROMOTION_STAGED_SHIMS: &str = ".junqi-openclaw-promotion-shims";
pub(super) const OPENCLAW_SHIMS: [&str; 3] = ["openclaw", "openclaw.cmd", "openclaw.ps1"];

#[derive(Debug)]
pub(super) enum PromotionFinalization {
    Complete,
    CleanupDeferred(String),
}

pub(super) fn finalize_verified_openclaw_promotion(
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

pub(super) fn verified_promotion_cleanup_result(
    finalization: PromotionFinalization,
) -> Result<(), String> {
    match finalization {
        PromotionFinalization::Complete => Ok(()),
        PromotionFinalization::CleanupDeferred(error) => Err(error),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct OpenClawPromotionState {
    pub(super) had_existing_package: bool,
    pub(super) existing_shims: Vec<String>,
}

pub(super) fn recover_interrupted_openclaw_promotion(target_prefix: &Path) -> Result<(), String> {
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

pub(super) async fn promote_staged_openclaw_install(
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

pub(super) fn unix_openclaw_package_dir(prefix: &Path) -> PathBuf {
    prefix.join("lib").join("node_modules").join("openclaw")
}

pub(super) fn unix_openclaw_launcher(prefix: &Path) -> PathBuf {
    prefix.join("bin").join("openclaw")
}

pub(super) fn validate_staged_unix_openclaw_install(prefix: &Path) -> Result<(), String> {
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
pub(super) struct UnixOpenClawPromotionState {
    pub(super) had_existing_package: bool,
    pub(super) had_existing_launcher: bool,
}

pub(super) fn recover_interrupted_unix_openclaw_promotion(
    target_prefix: &Path,
) -> Result<(), String> {
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

pub(super) fn promote_staged_unix_openclaw_install(
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
pub(super) fn remove_broken_openclaw_install(prefix: &std::path::Path) -> Result<(), String> {
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
    operation_id: Option<String>,
) -> Result<String, String> {
    install_openclaw_impl(app, state, OpenclawInstallMode::Normal, operation_id).await
}

/// Reinstall the selected OpenClaw package even when a binary is still
/// detectable. This is deliberately separate from normal first-install
/// detection so a user-visible "reinstall" action has real repair semantics.
#[tauri::command]
pub async fn reinstall_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    operation_id: Option<String>,
) -> Result<String, String> {
    install_openclaw_impl(
        app,
        state,
        OpenclawInstallMode::ReinstallExisting,
        operation_id,
    )
    .await
}

#[tauri::command]
pub async fn relocate_openclaw(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    operation_id: Option<String>,
) -> Result<String, String> {
    if !paths::openclaw_relocation_required() {
        return Err("OpenClaw relocation was not requested by storage migration".into());
    }
    install_openclaw_impl(app, state, OpenclawInstallMode::Relocate, operation_id).await
}

pub(super) fn existing_npm_prefix_for_reinstall(binary: &Path, windows: bool) -> Option<PathBuf> {
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
pub(super) enum OpenclawInstallMode {
    Normal,
    ReinstallExisting,
    Relocate,
}

impl OpenclawInstallMode {
    /// Every install entry point honors a persisted relocation request. This
    /// keeps future callers from reusing the old npm prefix while a storage
    /// migration is unfinished.
    pub(super) fn for_current_storage(self) -> Self {
        if paths::openclaw_relocation_required() {
            Self::Relocate
        } else {
            self
        }
    }

    pub(super) fn forces_npm_install(self) -> bool {
        !matches!(self, Self::Normal)
    }
}

pub(super) fn verify_relocated_openclaw_prefix(
    binary: &Path,
    expected_prefix: &Path,
) -> Result<(), String> {
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
pub(super) struct OpenclawRelocationRequest {
    pub(super) expected_npm_prefix: Option<PathBuf>,
    pub(super) effective_target: Option<PathBuf>,
    pub(super) package_contract: Option<paths::OpenclawRelocationContract>,
}

impl OpenclawRelocationRequest {
    pub(super) fn capture() -> Result<Self, String> {
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

    pub(super) fn package_contract(&self) -> Option<&paths::OpenclawRelocationContract> {
        self.package_contract.as_ref()
    }

    pub(super) fn freeze_target(&mut self, target: &Path) -> Result<(), String> {
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

    pub(super) async fn commit(
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

pub(super) async fn install_openclaw_impl(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    mode: OpenclawInstallMode,
    operation_id: Option<String>,
) -> Result<String, String> {
    // npm owns the OpenClaw installation deadline and performs explicit
    // process-tree cleanup before retrying a registry. An outer timeout would
    // cancel that cleanup future and could detach npm lifecycle children.
    let operation = SetupOperation::begin(&app, SetupOperationKind::OpenClaw, operation_id)?;
    install_openclaw_impl_inner(app, state, mode, &operation).await
}

pub(super) async fn install_openclaw_impl_inner(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    mode: OpenclawInstallMode,
    operation: &SetupOperation,
) -> Result<String, String> {
    crate::commands::setup_progress::scope_operation(
        operation.progress_id(),
        install_openclaw_impl_inner_scoped(app, state, mode, operation),
    )
    .await
}

async fn install_openclaw_impl_inner_scoped(
    app: tauri::AppHandle,
    state: tauri::State<'_, GatewayProcess>,
    mode: OpenclawInstallMode,
    operation: &SetupOperation,
) -> Result<String, String> {
    paths::validate_runtime_overrides()?;
    crate::commands::system::validate_openclaw_binary_override()?;
    let step = "openclaw";
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = tokio::select! {
        guard = operation_gate.lock_owned() => guard,
        _ = operation.cancelled() => return Err(SETUP_OPERATION_CANCELLED_MESSAGE.into()),
    };
    let install_lock = OPENCLAW_INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = wait_for_setup_operation_lock(install_lock, operation).await?;
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
        operation,
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

    // The package that answers on the Gateway port is now stale: a Gateway that
    // was already serving when this transaction started still runs the previous
    // code. Record that so the next start takes the lifecycle over rather than
    // adopting that endpoint and reporting a repair that never took effect.
    state
        .openclaw_package_replaced
        .store(true, Ordering::Release);

    let installed_version = verified.version.unwrap_or_else(|| "unknown version".into());
    emit(
        &app,
        step,
        &format!("OpenClaw {} installed successfully", installed_version),
        1.0,
    );
    Ok(format!(
        "OpenClaw {} installed successfully",
        installed_version
    ))
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
pub(super) struct NpmInstallRequest<'a> {
    pub(super) app: &'a tauri::AppHandle,
    pub(super) step: &'a str,
    pub(super) npm: &'a crate::commands::system::NpmExecutionContext,
    pub(super) global_prefix: &'a std::path::Path,
    pub(super) target: &'a npm_registry::OpenclawReleaseTarget,
    pub(super) force: bool,
    pub(super) progress: std::ops::Range<f64>,
    pub(super) operation: &'a SetupOperation,
}

pub(super) async fn npm_install_with_fallback(
    request: NpmInstallRequest<'_>,
) -> Result<(), String> {
    let NpmInstallRequest {
        app,
        step,
        npm,
        global_prefix,
        target,
        force,
        progress,
        operation,
    } = request;
    let progress_operation_id = operation.progress_id();
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
            "npm network policy: fetch-retries=2, fetch-timeout=120000ms, slow-source-threshold={}s, output-silence-is-nonfatal=true, transaction-deadline={}s",
            NPM_SLOW_FETCH_THRESHOLD.as_secs(),
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
        operation.ensure_active()?;
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
        let npm_activity_log_slot = format!("npm-install-{install_nonce}-{}", reg_idx + 1);
        emit_coalesced(
            app,
            step,
            &format!(
                "【安装 {}/{}】使用 {} 安装 {}...",
                reg_idx + 1,
                total_regs,
                reg_label,
                package_spec
            ),
            &npm_activity_log_slot,
            prog_start,
        );

        let mut cmd = npm.command();

        cmd.args([
            "install",
            "-g",
            "--prefer-offline",
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
        let (slow_fetch_tx, mut slow_fetch_rx) = tokio::sync::watch::channel(None::<String>);
        let slow_fetch_triggered = Arc::new(AtomicBool::new(false));
        let fetch_metrics = Arc::new(Mutex::new(NpmFetchMetrics::default()));
        let diagnostics = Arc::new(Mutex::new(Vec::new()));
        let npm_progress = Arc::new(NpmStreamProgress::default());
        let last_output_seconds = Arc::new(AtomicU64::new(0));

        // Stream stdout to progress events so the user sees live npm output
        let stdout_task = child.stdout.take().map(|stdout| {
            let app_c = app.clone();
            let step_c = step.to_string();
            let slow_fetch_tx = slow_fetch_tx.clone();
            let slow_fetch_triggered = Arc::clone(&slow_fetch_triggered);
            let fetch_metrics = Arc::clone(&fetch_metrics);
            let source_label = reg_label.clone();
            let diagnostics = Arc::clone(&diagnostics);
            let process_label = process_label.clone();
            let npm_progress = Arc::clone(&npm_progress);
            let last_output_seconds = Arc::clone(&last_output_seconds);
            let progress_operation_id = progress_operation_id.clone();
            tokio::spawn(crate::commands::setup_progress::scope_operation(
                progress_operation_id,
                async move {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let mut lines = BufReader::new(stdout).lines();
                    while let Some(line) = lines
                        .next_line()
                        .await
                        .map_err(|error| format!("Failed to read npm stdout: {error}"))?
                    {
                        record_process_output(&app_c, &step_c, &process_label, "stdout", &line);
                        last_output_seconds
                            .store(attempt_started.elapsed().as_secs(), Ordering::Release);
                        let progress =
                            prog_start + (prog_end - prog_start) * npm_progress.observe(&line);
                        observe_npm_fetch(
                            &line,
                            &source_label,
                            &slow_fetch_tx,
                            &slow_fetch_triggered,
                            &fetch_metrics,
                        );
                        if npm_log_line_is_http_telemetry(&line) {
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
                },
            ))
        });
        let tar_warning_count = Arc::new(AtomicUsize::new(0));
        let stderr_task = child.stderr.take().map(|stderr| {
            let app_e = app.clone();
            let step_e = step.to_string();
            let tar_warning_count_e = Arc::clone(&tar_warning_count);
            let slow_fetch_tx = slow_fetch_tx.clone();
            let slow_fetch_triggered = Arc::clone(&slow_fetch_triggered);
            let fetch_metrics = Arc::clone(&fetch_metrics);
            let source_label = reg_label.clone();
            let diagnostics = Arc::clone(&diagnostics);
            let process_label = process_label.clone();
            let npm_progress = Arc::clone(&npm_progress);
            let last_output_seconds = Arc::clone(&last_output_seconds);
            let progress_operation_id = progress_operation_id.clone();
            tokio::spawn(crate::commands::setup_progress::scope_operation(
                progress_operation_id,
                async move {
                    use tokio::io::{AsyncBufReadExt, BufReader};
                    let mut lines = BufReader::new(stderr).lines();
                    while let Some(line) = lines
                        .next_line()
                        .await
                        .map_err(|error| format!("Failed to read npm stderr: {error}"))?
                    {
                        record_process_output(&app_e, &step_e, &process_label, "stderr", &line);
                        last_output_seconds
                            .store(attempt_started.elapsed().as_secs(), Ordering::Release);
                        let progress =
                            prog_start + (prog_end - prog_start) * npm_progress.observe(&line);
                        observe_npm_fetch(
                            &line,
                            &source_label,
                            &slow_fetch_tx,
                            &slow_fetch_triggered,
                            &fetch_metrics,
                        );
                        if npm_log_line_is_http_telemetry(&line) {
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
                },
            ))
        });
        let (heartbeat_tx, mut heartbeat_rx) = tokio::sync::watch::channel(false);
        let heartbeat_app = app.clone();
        let heartbeat_step = step.to_string();
        let heartbeat_label = reg_label.to_string();
        let heartbeat_progress = Arc::clone(&npm_progress);
        let heartbeat_fetch_metrics = Arc::clone(&fetch_metrics);
        let heartbeat_last_output_seconds = Arc::clone(&last_output_seconds);
        let heartbeat_log_slot = npm_activity_log_slot.clone();
        let progress_operation_id = progress_operation_id.clone();
        let heartbeat_task = tokio::spawn(crate::commands::setup_progress::scope_operation(
            progress_operation_id,
            async move {
                loop {
                    tokio::select! {
                        changed = heartbeat_rx.changed() => {
                            if changed.is_err() || *heartbeat_rx.borrow() {
                                break;
                            }
                        }
                        _ = tokio::time::sleep(std::time::Duration::from_secs(15)) => {
                            let elapsed = attempt_started.elapsed();
                            let last_output_age = std::time::Duration::from_secs(
                                elapsed.as_secs().saturating_sub(
                                    heartbeat_last_output_seconds.load(Ordering::Acquire),
                                ),
                            );
                            emit_coalesced(
                                &heartbeat_app,
                                &heartbeat_step,
                                &npm_install_activity_message(
                                    &heartbeat_label,
                                    elapsed,
                                    last_output_age,
                                    npm_fetch_snapshot(&heartbeat_fetch_metrics),
                                ),
                                &heartbeat_log_slot,
                                heartbeat_progress.overall(prog_start, prog_end),
                            );
                        }
                    }
                }
            },
        ));
        let wait_result = wait_for_npm_process_with_slow_signal(
            &mut child,
            &mut slow_fetch_rx,
            deadline,
            Some(&operation.cancellation),
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
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
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
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
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
            NpmWaitResult::Cancelled => {
                let cleanup = stop_npm_process(&mut child, child_pid, output).await;
                record_process_finished(
                    app,
                    step,
                    &process_label,
                    child_pid,
                    None,
                    attempt_started.elapsed(),
                );
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{SETUP_OPERATION_CANCELLED_MESSAGE}; process cleanup was not confirmed: {cleanup_error}"
                    ));
                }
                return Err(SETUP_OPERATION_CANCELLED_MESSAGE.into());
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
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
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
            NpmWaitResult::DeadlineExceeded => {
                let diagnostic = npm_diagnostic_text(&diagnostics);
                let base_error = "npm install exceeded the 30-minute dependency deadline";
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
                emit_npm_fetch_summary(
                    app,
                    step,
                    &reg_label,
                    &fetch_metrics,
                    &npm_activity_log_slot,
                    prog_live,
                );
                if let Err(cleanup_error) = cleanup {
                    return Err(format!(
                        "{last_err}; process cleanup was not confirmed, so no fallback registry was started: {cleanup_error}"
                    ));
                }
                return Err(last_err);
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
                &format!("{} installed (via {})", package_spec, reg_label),
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
}
