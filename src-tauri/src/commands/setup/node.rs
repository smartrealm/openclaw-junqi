//! Node.js runtime resolution and installation across portable archives,
//! Windows MSI, macOS pkg, and winget.

use super::*;

#[cfg_attr(not(windows), allow(dead_code))]
pub(super) async fn fetch_node_distribution_index(
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
pub(super) async fn resolve_managed_node_version(
    requirement: &NodeRuntimeRequirement,
    platform: ManagedNodePlatform,
) -> Result<String, String> {
    let artifact = platform.distribution_artifact();
    resolve_managed_node_version_for_artifact(requirement, &artifact).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) async fn resolve_managed_node_version_for_artifact(
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

pub(super) fn parse_shasums(text: &str, filename: &str) -> Option<String> {
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
pub(super) async fn resolve_node_sha256(
    version: &str,
    platform: ManagedNodePlatform,
) -> Result<String, String> {
    let filename = platform.archive_filename(version);
    resolve_node_sha256_for_filename(version, &filename).await
}

#[cfg_attr(all(not(windows), not(target_os = "macos")), allow(dead_code))]
pub(super) async fn resolve_node_sha256_for_filename(
    version: &str,
    filename: &str,
) -> Result<String, String> {
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
/// Setup has two runtime contracts: an existing local OpenClaw package is
/// authoritative for a reuse path, while a machine without OpenClaw must
/// resolve the exact target package before installing anything. Keeping this
/// distinction prevents an offline registry from blocking a healthy existing
/// installation and prevents a fresh installation from using a broad fallback.
pub(super) async fn setup_node_requirement() -> Result<NodeRuntimeRequirement, String> {
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
    pub(super) fn verified(
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
pub(super) async fn resolve_complete_node_runtime_contract(
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

pub(super) fn ready_node_runtime_message(
    runtime: &crate::commands::system::NodeRuntimeContract,
) -> String {
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
pub(super) async fn wait_for_node_runtime_settle(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
    budget: DependencyInstallBudget,
    operation: &SetupOperation,
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
                    SETUP_OPERATION_CANCELLED_MESSAGE,
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
pub(super) async fn wait_for_git_runtime_settle(
    app: &tauri::AppHandle,
    budget: DependencyInstallBudget,
    operation: &SetupOperation,
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
                    SETUP_OPERATION_CANCELLED_MESSAGE,
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
    let operation = SetupOperation::begin(&app, SetupOperationKind::Node, operation_id)?;
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
    let operation = SetupOperation::begin(&app, SetupOperationKind::Node, operation_id)?;
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

pub(super) async fn install_node_for_requirement(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation_id: Option<String>,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    let operation = SetupOperation::begin(&app, SetupOperationKind::Node, operation_id)?;
    install_node_for_requirement_with_operation(app, requirement, force, &operation).await
}

pub(super) async fn setup_node_requirement_for_operation(
    operation: &SetupOperation,
) -> Result<NodeRuntimeRequirement, String> {
    operation.ensure_active()?;
    tokio::select! {
        result = setup_node_requirement() => {
            operation.ensure_active()?;
            result
        }
        _ = operation.cancelled() => Err(SETUP_OPERATION_CANCELLED_MESSAGE.into()),
    }
}

pub(super) async fn install_node_for_requirement_with_operation(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &SetupOperation,
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

pub(super) async fn install_node_for_requirement_inner(
    #[cfg_attr(all(not(windows), not(target_os = "macos")), allow(unused_variables))]
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &SetupOperation,
) -> Result<crate::commands::system::NodeRuntimeContract, String> {
    let _guard = wait_for_setup_operation_lock(
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
pub(super) async fn install_portable_node_runtime(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    target: PathBuf,
    operation: &SetupOperation,
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
pub(super) async fn install_windows_system_node(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &SetupOperation,
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
pub(super) async fn install_macos_system_node(
    app: tauri::AppHandle,
    requirement: NodeRuntimeRequirement,
    force: bool,
    operation: &SetupOperation,
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
            return Err(SETUP_OPERATION_CANCELLED_MESSAGE.into());
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
                return Err(SETUP_OPERATION_CANCELLED_MESSAGE.into());
            }
        }
    }
}

#[cfg(windows)]
pub(super) async fn install_windows_system_node_from_mirrors(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
    budget: DependencyInstallBudget,
    operation: &SetupOperation,
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
pub(super) async fn install_windows_system_node_with_winget(
    app: &tauri::AppHandle,
    requirement: &NodeRuntimeRequirement,
    budget: DependencyInstallBudget,
    operation: &SetupOperation,
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
#[derive(Clone, Copy)]
pub(super) enum NodeRuntimePurpose {
    ExecuteOpenClaw,
    InstallOpenClawPackage,
}

impl NodeRuntimePurpose {
    pub(super) fn requires_npm(self) -> bool {
        matches!(self, Self::InstallOpenClawPackage)
    }
}

/// Resolve one complete runtime contract for an OpenClaw operation. The
/// requirement is read from package metadata, so version evolution does not
/// require a JunQi release with another hard-coded range.
pub(super) async fn ensure_node_runtime(
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
pub(super) async fn ensure_installable_node_runtime(
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
