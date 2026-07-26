//! Git installation for platforms where OpenClaw's npm dependencies need it.

use super::*;

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

pub(super) async fn install_git_impl(
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

pub(super) async fn install_git_impl_inner(
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
        // Git for Windows no longer publishes a full x86 installer. Use a
        // stable JunQi-owned MinGit target so the first install succeeds and
        // every later setup can reuse the verified executable without UAC.
        if std::env::consts::ARCH == "x86" {
            return install_windows_portable_git(
                app,
                force,
                paths::managed_git_fallback_dir(),
                operation,
            )
            .await;
        }
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
pub(super) async fn install_windows_system_git(
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
pub(super) async fn install_windows_system_git_from_mirrors(
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
pub(super) async fn install_windows_portable_git(
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
