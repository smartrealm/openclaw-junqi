use crate::commands::gateway::{ensure_config_with_token, GatewayStatus};
use crate::commands::setup_progress::{emit, emit_error};
use crate::paths;
use crate::platform;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

const OPENCLAW_IMAGE: &str = "ghcr.io/openclaw/openclaw";
/// Stable container name owned exclusively by JunQi. Keep every Docker entry
/// point on this constant so terminal integration and CLI helpers cannot drift
/// from the lifecycle manager.
pub(crate) const OPENCLAW_CONTAINER_NAME: &str = "maxauto-openclaw";
pub(crate) const OPENCLAW_CONTAINER_STATE_DIR: &str = "/home/node/.openclaw";
pub(crate) const OPENCLAW_CONTAINER_CONFIG_PATH: &str = "/home/node/.openclaw/openclaw.json";
pub(crate) const OPENCLAW_CONTAINER_WORKSPACE_DIR: &str = "/home/node/.openclaw/workspace";

const CONTAINER_OWNER_LABEL: &str = "com.junqi.openclaw.owner";
const CONTAINER_OWNER: &str = "junqi-desktop";
const CONTAINER_ROLE_LABEL: &str = "com.junqi.openclaw.role";
const CONTAINER_ROLE: &str = "gateway";
const CONTAINER_SCHEMA_LABEL: &str = "com.junqi.openclaw.schema";
const CONTAINER_SCHEMA: &str = "1";
const CONTAINER_STATE_LABEL: &str = "com.junqi.openclaw.state-id";

/// Separates paths resolved by the host from paths interpreted inside the
/// OpenClaw container. A container path must never be parsed or created on the
/// host, especially on Windows where `/home/...` has unrelated drive semantics.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RuntimePathMapping {
    pub(crate) host_state_dir: PathBuf,
    pub(crate) host_config_path: PathBuf,
    pub(crate) host_workspace: PathBuf,
    pub(crate) runtime_state_dir: &'static str,
    pub(crate) runtime_config_path: &'static str,
    pub(crate) runtime_workspace: &'static str,
}

impl RuntimePathMapping {
    pub(crate) fn for_layout(
        host_state_dir: PathBuf,
        host_workspace: PathBuf,
    ) -> Result<Self, String> {
        if !host_state_dir.is_absolute() || !host_workspace.is_absolute() {
            return Err("Docker host state and workspace paths must be absolute".into());
        }
        let host_config_path =
            paths::config_path_for_runtime(&host_state_dir, paths::OpenClawRuntimeMode::Docker);
        Ok(Self {
            host_state_dir,
            host_config_path,
            host_workspace,
            runtime_state_dir: OPENCLAW_CONTAINER_STATE_DIR,
            runtime_config_path: OPENCLAW_CONTAINER_CONFIG_PATH,
            runtime_workspace: OPENCLAW_CONTAINER_WORKSPACE_DIR,
        })
    }

    pub(crate) fn from_active_layout() -> Result<Self, String> {
        let host_state_dir = paths::desktop_dir();
        let host_workspace = paths::load_storage_bootstrap()
            .filter(|layout| {
                paths::paths_refer_to_same_location(&layout.state_dir, &host_state_dir)
            })
            .map(|layout| layout.workspace_dir)
            .unwrap_or_else(|| host_state_dir.join("workspace"));
        Self::for_layout(host_state_dir, host_workspace)
    }

    pub(crate) fn host_config_dir(&self) -> Result<&Path, String> {
        self.host_config_path
            .parent()
            .ok_or_else(|| "Invalid Docker configuration path".into())
    }

    pub(crate) fn normalize_config(&self) -> Result<(), String> {
        normalize_docker_config_runtime_paths(&self.host_config_path)
    }
}

/// Normalize a copied or existing Docker configuration without resolving the
/// configured container workspace through host filesystem APIs.
pub(crate) fn normalize_docker_config_runtime_paths(config_path: &Path) -> Result<(), String> {
    if !config_path.exists() {
        return Ok(());
    }
    let raw = std::fs::read_to_string(config_path).map_err(|error| {
        format!(
            "Failed to read Docker config {}: {}",
            config_path.display(),
            error
        )
    })?;
    let mut config = serde_json::from_str::<serde_json::Value>(&raw).map_err(|error| {
        format!(
            "Failed to parse Docker config {}: {}",
            config_path.display(),
            error
        )
    })?;
    let root = config
        .as_object_mut()
        .ok_or("OpenClaw Docker configuration root must be an object")?;
    let agents = root
        .entry("agents")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("OpenClaw Docker agents configuration must be an object")?;
    let defaults = agents
        .entry("defaults")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("OpenClaw Docker agent defaults must be an object")?;
    let desired = serde_json::Value::String(OPENCLAW_CONTAINER_WORKSPACE_DIR.into());
    if defaults.get("workspace") == Some(&desired) {
        return Ok(());
    }
    defaults.insert("workspace".into(), desired);
    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Failed to serialize Docker config: {}", error))?;
    paths::atomic_write_text(config_path, &serialized).map_err(|error| {
        format!(
            "Failed to normalize Docker config {}: {}",
            config_path.display(),
            error
        )
    })
}

fn normalized_state_identity_path(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| {
        let mut normalized = PathBuf::new();
        for component in path.components() {
            match component {
                Component::CurDir => {}
                Component::ParentDir => {
                    normalized.pop();
                }
                other => normalized.push(other.as_os_str()),
            }
        }
        normalized
    });
    let value = resolved.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value
            .strip_prefix("//?/")
            .unwrap_or(&value)
            .to_ascii_lowercase()
    } else {
        value
    }
}

fn state_identity(path: &Path) -> String {
    let mut digest = Sha256::new();
    digest.update(normalized_state_identity_path(path).as_bytes());
    format!("{:x}", digest.finalize())
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ManagedContainerContract {
    state_id: String,
}

impl ManagedContainerContract {
    fn for_mapping(mapping: &RuntimePathMapping) -> Self {
        Self {
            state_id: state_identity(&mapping.host_state_dir),
        }
    }

    fn run_label_args(&self) -> Vec<String> {
        [
            (CONTAINER_OWNER_LABEL, CONTAINER_OWNER),
            (CONTAINER_ROLE_LABEL, CONTAINER_ROLE),
            (CONTAINER_SCHEMA_LABEL, CONTAINER_SCHEMA),
            (CONTAINER_STATE_LABEL, self.state_id.as_str()),
        ]
        .into_iter()
        .flat_map(|(key, value)| ["--label".to_string(), format!("{}={}", key, value)])
        .collect()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ContainerPresence {
    Absent,
    Managed { running: bool, state_id: String },
    LegacyManaged { running: bool },
    Foreign,
}

fn classify_container_inspection(value: &serde_json::Value) -> Result<ContainerPresence, String> {
    let container = value
        .as_array()
        .and_then(|items| items.first())
        .ok_or("Docker inspect returned no container record")?;
    let labels = container
        .pointer("/Config/Labels")
        .and_then(serde_json::Value::as_object);
    let label = |key: &str| labels.and_then(|values| values.get(key)?.as_str());
    let state_id = label(CONTAINER_STATE_LABEL).unwrap_or_default();
    let managed = label(CONTAINER_OWNER_LABEL) == Some(CONTAINER_OWNER)
        && label(CONTAINER_ROLE_LABEL) == Some(CONTAINER_ROLE)
        && label(CONTAINER_SCHEMA_LABEL) == Some(CONTAINER_SCHEMA)
        && state_id.len() == 64
        && state_id.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !managed {
        return Ok(ContainerPresence::Foreign);
    }
    let running = container
        .pointer("/State/Running")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    Ok(ContainerPresence::Managed {
        running,
        state_id: state_id.to_string(),
    })
}

fn legacy_container_matches_layout(
    value: &serde_json::Value,
    mapping: &RuntimePathMapping,
) -> bool {
    let Some(container) = value.as_array().and_then(|items| items.first()) else {
        return false;
    };
    let labels = container
        .pointer("/Config/Labels")
        .and_then(serde_json::Value::as_object);
    if labels.is_some_and(|values| values.contains_key(CONTAINER_OWNER_LABEL)) {
        return false;
    }
    let image_matches = container
        .pointer("/Config/Image")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|image| image.starts_with(OPENCLAW_IMAGE));
    if !image_matches {
        return false;
    }
    let env = container
        .pointer("/Config/Env")
        .and_then(serde_json::Value::as_array);
    let has_env = |expected: &str| {
        env.is_some_and(|values| values.iter().any(|value| value.as_str() == Some(expected)))
    };
    if !has_env(&format!("OPENCLAW_STATE_DIR={}", mapping.runtime_state_dir))
        || !has_env(&format!(
            "OPENCLAW_CONFIG_PATH={}",
            mapping.runtime_config_path
        ))
    {
        return false;
    }
    let mounts = container
        .get("Mounts")
        .and_then(serde_json::Value::as_array);
    let mount_matches = |destination: &str, source: &Path| {
        mounts.is_some_and(|values| {
            values.iter().any(|mount| {
                mount.get("Type").and_then(serde_json::Value::as_str) == Some("bind")
                    && mount.get("Destination").and_then(serde_json::Value::as_str)
                        == Some(destination)
                    && mount
                        .get("Source")
                        .and_then(serde_json::Value::as_str)
                        .map(Path::new)
                        .is_some_and(|candidate| {
                            paths::paths_refer_to_same_location(candidate, source)
                        })
            })
        })
    };
    let Ok(config_dir) = mapping.host_config_dir() else {
        return false;
    };
    mount_matches(mapping.runtime_state_dir, config_dir)
        && mount_matches(mapping.runtime_workspace, &mapping.host_workspace)
}

#[derive(Default)]
struct DockerPullProgress {
    layers: HashMap<String, f64>,
    furthest: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum DockerLayerPhase {
    Queued,
    Downloading(f64),
    Verifying,
    Downloaded,
    Extracting(f64),
    Complete,
}

impl DockerLayerPhase {
    fn fraction(self) -> f64 {
        match self {
            Self::Queued => 0.02,
            Self::Downloading(ratio) => 0.05 + ratio * 0.5,
            Self::Verifying => 0.58,
            Self::Downloaded => 0.62,
            Self::Extracting(ratio) => 0.62 + ratio * 0.36,
            Self::Complete => 1.0,
        }
    }
}

const FIXED_DOCKER_PHASES: &[(&str, DockerLayerPhase)] = &[
    ("Pull complete", DockerLayerPhase::Complete),
    ("Download complete", DockerLayerPhase::Downloaded),
    ("Verifying Checksum", DockerLayerPhase::Verifying),
    ("Pulling fs layer", DockerLayerPhase::Queued),
    ("Waiting", DockerLayerPhase::Queued),
];

#[derive(Clone, Copy)]
struct TransferPhaseRule {
    prefix: &'static str,
    build: fn(f64) -> DockerLayerPhase,
}

const TRANSFER_DOCKER_PHASES: &[TransferPhaseRule] = &[
    TransferPhaseRule {
        prefix: "Downloading",
        build: DockerLayerPhase::Downloading,
    },
    TransferPhaseRule {
        prefix: "Extracting",
        build: DockerLayerPhase::Extracting,
    },
];

fn parse_docker_layer_phase(state: &str) -> Option<DockerLayerPhase> {
    FIXED_DOCKER_PHASES
        .iter()
        .find_map(|(prefix, phase)| state.strip_prefix(prefix).map(|_| *phase))
        .or_else(|| {
            TRANSFER_DOCKER_PHASES.iter().find_map(|rule| {
                state.strip_prefix(rule.prefix)?;
                transfer_ratio(state).map(rule.build)
            })
        })
}

impl DockerPullProgress {
    fn observe(&mut self, line: &str) -> f64 {
        let Some((layer, state)) = line.trim().split_once(": ") else {
            return self.furthest;
        };
        let Some(phase) = parse_docker_layer_phase(state) else {
            return self.furthest;
        };
        let layer_progress = phase.fraction();
        self.layers
            .entry(layer.to_owned())
            .and_modify(|current| *current = current.max(layer_progress))
            .or_insert(layer_progress);
        let aggregate = self.layers.values().sum::<f64>() / self.layers.len() as f64;
        self.furthest = self.furthest.max(aggregate).clamp(0.0, 0.98);
        self.furthest
    }
}

fn transfer_ratio(state: &str) -> Option<f64> {
    let pair = state.split_whitespace().find(|part| part.contains('/'))?;
    let (current, total) = pair.split_once('/')?;
    let total = parse_transfer_size(total)?;
    if total <= 0.0 {
        return None;
    }
    Some((parse_transfer_size(current)? / total).clamp(0.0, 1.0))
}

fn parse_transfer_size(value: &str) -> Option<f64> {
    let split = value.find(|ch: char| !ch.is_ascii_digit() && ch != '.')?;
    let number = value[..split].parse::<f64>().ok()?;
    let unit = value[split..].trim().to_ascii_lowercase();
    let multiplier = match unit.as_str() {
        "b" => 1.0,
        "kb" | "kib" => 1024.0,
        "mb" | "mib" => 1024.0 * 1024.0,
        "gb" | "gib" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some(number * multiplier)
}

async fn stream_docker_output<R>(
    reader: R,
    app: AppHandle,
    tracker: Arc<Mutex<DockerPullProgress>>,
    tail: Arc<Mutex<VecDeque<String>>>,
) where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().trim_matches('\r');
        if line.is_empty() {
            continue;
        }
        let progress = tracker
            .lock()
            .map(|mut state| state.observe(line))
            .unwrap_or(0.0);
        if let Ok(mut entries) = tail.lock() {
            if entries.len() == 20 {
                entries.pop_front();
            }
            entries.push_back(line.to_owned());
        }
        emit(&app, "pull", line, progress);
    }
}

#[derive(Debug, Serialize)]
pub struct DockerStatus {
    pub available: bool,
    pub version: Option<String>,
    pub daemon_running: bool,
}

pub(crate) async fn resolve_docker_bin() -> Result<String, String> {
    let detected = platform::detect_path("docker");
    if !detected.is_empty()
        && tokio::process::Command::new(&detected)
            .arg("--version")
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false)
    {
        return Ok(detected);
    }

    let configured = platform::bin_name("docker");
    if tokio::process::Command::new(&configured)
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        return Ok(configured);
    }

    let mut candidates: Vec<PathBuf> = vec![
        "/usr/local/bin/docker".into(),
        "/opt/homebrew/bin/docker".into(),
        "/usr/bin/docker".into(),
        "/bin/docker".into(),
    ];

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(".docker").join("bin").join("docker"));
    }

    #[cfg(windows)]
    {
        if let Ok(program_files) = std::env::var("ProgramFiles") {
            candidates.push(
                PathBuf::from(program_files)
                    .join("Docker")
                    .join("Docker")
                    .join("resources")
                    .join("bin")
                    .join("docker.exe"),
            );
        }
        if let Ok(program_files_x86) = std::env::var("ProgramFiles(x86)") {
            candidates.push(
                PathBuf::from(program_files_x86)
                    .join("Docker")
                    .join("Docker")
                    .join("resources")
                    .join("bin")
                    .join("docker.exe"),
            );
        }
    }

    for candidate in candidates {
        if candidate.exists()
            && tokio::process::Command::new(&candidate)
                .arg("--version")
                .output()
                .await
                .map(|o| o.status.success())
                .unwrap_or(false)
        {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    if !cfg!(windows) {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        if let Ok(output) = tokio::process::Command::new(shell)
            .args(["-lc", "command -v docker"])
            .output()
            .await
        {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Ok(path);
                }
            }
        }
    }

    Err("Docker CLI not found".to_string())
}

async fn inspect_named_container(
    docker_bin: &str,
    mapping: &RuntimePathMapping,
) -> Result<ContainerPresence, String> {
    let output = tokio::process::Command::new(docker_bin)
        .args(["container", "inspect", OPENCLAW_CONTAINER_NAME])
        .output()
        .await
        .map_err(|error| format!("Failed to inspect Docker container: {}", error))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let normalized = stderr.to_ascii_lowercase();
        if normalized.contains("no such container") || normalized.contains("no such object") {
            return Ok(ContainerPresence::Absent);
        }
        return Err(format!("docker inspect failed: {}", stderr));
    }
    let value = serde_json::from_slice::<serde_json::Value>(&output.stdout)
        .map_err(|error| format!("Failed to parse docker inspect output: {}", error))?;
    let presence = classify_container_inspection(&value)?;
    if presence == ContainerPresence::Foreign && legacy_container_matches_layout(&value, mapping) {
        let running = value
            .as_array()
            .and_then(|items| items.first())
            .and_then(|container| container.pointer("/State/Running"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false);
        return Ok(ContainerPresence::LegacyManaged { running });
    }
    Ok(presence)
}

fn foreign_container_error() -> String {
    format!(
        "Docker container '{}' already exists without JunQi ownership labels; remove or rename it manually",
        OPENCLAW_CONTAINER_NAME
    )
}

async fn assert_named_container_is_not_foreign(
    docker_bin: &str,
    mapping: &RuntimePathMapping,
) -> Result<(), String> {
    match inspect_named_container(docker_bin, mapping).await? {
        ContainerPresence::Foreign => Err(foreign_container_error()),
        ContainerPresence::Absent
        | ContainerPresence::Managed { .. }
        | ContainerPresence::LegacyManaged { .. } => Ok(()),
    }
}

async fn remove_named_container(docker_bin: &str) -> Result<(), String> {
    let output = tokio::process::Command::new(docker_bin)
        .args(["rm", "-f", OPENCLAW_CONTAINER_NAME])
        .output()
        .await
        .map_err(|error| format!("Failed to remove managed Docker container: {}", error))?;
    if !output.status.success() {
        return Err(format!(
            "docker rm failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

async fn remove_managed_container_for_recreate(
    docker_bin: &str,
    mapping: &RuntimePathMapping,
) -> Result<bool, String> {
    match inspect_named_container(docker_bin, mapping).await? {
        ContainerPresence::Absent => Ok(false),
        ContainerPresence::Foreign => Err(foreign_container_error()),
        ContainerPresence::Managed { .. } | ContainerPresence::LegacyManaged { .. } => {
            remove_named_container(docker_bin).await?;
            Ok(true)
        }
    }
}

async fn stop_managed_container_if_present(
    docker_bin: &str,
    mapping: &RuntimePathMapping,
) -> Result<bool, String> {
    match inspect_named_container(docker_bin, mapping).await? {
        ContainerPresence::Absent => Ok(false),
        ContainerPresence::Foreign => Err(foreign_container_error()),
        ContainerPresence::Managed { running: false, .. } => Ok(false),
        ContainerPresence::Managed { running: true, .. } => {
            let output = tokio::process::Command::new(docker_bin)
                .args(["stop", OPENCLAW_CONTAINER_NAME])
                .output()
                .await
                .map_err(|error| format!("Failed to stop managed Docker container: {}", error))?;
            if !output.status.success() {
                return Err(format!(
                    "docker stop failed: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ));
            }
            Ok(true)
        }
        // Containers created before the ownership-label contract are removed
        // after their full image/env/mount identity matches the active layout.
        // This performs a one-time safe upgrade and prevents a stopped legacy
        // container from blocking a later storage migration.
        ContainerPresence::LegacyManaged { running } => {
            remove_named_container(docker_bin).await?;
            Ok(running)
        }
    }
}

pub(crate) fn docker_gateway_configured_port() -> u16 {
    let path = paths::docker_config_path();
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|config| crate::commands::config::gateway_port_from_config(&config))
        .unwrap_or_else(crate::commands::config::default_gateway_port)
}

/// Release only the foreground Gateway child owned by this desktop process
/// before Docker binds the same local port. External services stay untouched.
pub(crate) async fn release_managed_native_gateway_for_docker(
    state: &crate::state::GatewayProcess,
    port: u16,
) -> Result<bool, String> {
    let mut released = false;
    let native_child = {
        let mut child = state.child.lock().map_err(|error| error.to_string())?;
        child.take()
    };
    if let Some(mut child) = native_child {
        crate::commands::gateway_supervisor::terminate_owned_gateway(&mut child).await;
        released = true;
    }

    // Runtime mode is persisted before this function runs, so resolve the
    // Native config explicitly instead of accidentally inspecting Docker's
    // container config. Only a service whose state/config identity matches
    // JunQi's selected Native layout may be stopped.
    let native_state = paths::desktop_dir();
    let native_config = paths::config_path();
    if let Some(binary) = crate::commands::system::resolve_openclaw_binary_async().await {
        if let Ok(runtime) =
            crate::commands::system::compatible_native_openclaw_runtime(binary).await
        {
            let identity = crate::commands::gateway_service::GatewayServiceIdentity::for_runtime(
                &native_state,
                &native_config,
                &runtime,
            );
            let search_path = crate::commands::system::openclaw_search_path();
            let inspection = crate::commands::gateway_service::inspect_gateway_service_state(
                &runtime,
                &identity,
                Some(&search_path),
            )
            .await;
            if inspection.is_ok_and(|inspection| {
                crate::commands::gateway_service::belongs_to_selected_state(inspection.ownership)
                    && inspection.installed
                    && inspection.running
            }) {
                crate::commands::gateway_service::stop_selected_gateway_service(
                    &runtime,
                    &native_state,
                    &native_config,
                    Some(&search_path),
                )
                .await?;
                released = true;
            }
        }
    }
    if released {
        crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await?;
    }
    Ok(released)
}

/// Stop JunQi's named Docker container before the selected Native runtime
/// reclaims its port. The container name is owned by JunQi, so this never
/// targets arbitrary user containers.
pub(crate) async fn release_managed_docker_gateway_for_native(port: u16) -> Result<bool, String> {
    let docker_bin = match resolve_docker_bin().await {
        Ok(binary) => binary,
        Err(_) => return Ok(false),
    };
    let mapping = RuntimePathMapping::from_active_layout()?;
    let stopped = stop_managed_container_if_present(&docker_bin, &mapping).await?;
    if stopped {
        crate::commands::gateway_supervisor::wait_for_port_free(port, 30_000).await?;
    }
    Ok(stopped)
}

/// Check if Docker CLI is installed and the daemon is running.
#[tauri::command]
pub async fn check_docker() -> Result<DockerStatus, String> {
    // Check if docker CLI exists
    let docker_bin = match resolve_docker_bin().await {
        Ok(bin) => bin,
        Err(_) => {
            return Ok(DockerStatus {
                available: false,
                version: None,
                daemon_running: false,
            });
        }
    };
    let version_output = tokio::process::Command::new(&docker_bin)
        .args(["version", "--format", "{{.Server.Version}}"])
        .output()
        .await;

    match version_output {
        Ok(output) if output.status.success() => {
            let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(DockerStatus {
                available: true,
                version: if version.is_empty() {
                    None
                } else {
                    Some(version)
                },
                daemon_running: true,
            })
        }
        Ok(_output) => {
            // Docker CLI exists but daemon might not be running
            // Try just `docker --version` to confirm CLI is there
            let cli_check = tokio::process::Command::new(&docker_bin)
                .args(["--version"])
                .output()
                .await;
            match cli_check {
                Ok(o) if o.status.success() => {
                    let raw = String::from_utf8_lossy(&o.stdout).trim().to_string();
                    // Extract version from "Docker version 24.0.7, build ..."
                    let version = raw
                        .strip_prefix("Docker version ")
                        .and_then(|s| s.split(',').next())
                        .map(|s| s.to_string());
                    Ok(DockerStatus {
                        available: true,
                        version,
                        daemon_running: false,
                    })
                }
                _ => Ok(DockerStatus {
                    available: false,
                    version: None,
                    daemon_running: false,
                }),
            }
        }
        Err(_) => Ok(DockerStatus {
            available: false,
            version: None,
            daemon_running: false,
        }),
    }
}

/// Pull the official OpenClaw Docker image.
#[tauri::command]
pub async fn pull_openclaw_image(app: AppHandle, tag: Option<String>) -> Result<String, String> {
    paths::validate_runtime_mode(paths::OpenClawRuntimeMode::Docker)?;
    let tag = tag.unwrap_or_else(|| "latest".to_string());
    let image = format!("{}:{}", OPENCLAW_IMAGE, tag);

    emit(&app, "pull", &format!("Pulling {}...", image), 0.0);

    let docker_bin = resolve_docker_bin().await?;
    let mut command = tokio::process::Command::new(&docker_bin);
    command
        .args(["pull", &image])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    platform::configure_background_command(&mut command);
    let mut child = command.spawn().map_err(|error| {
        let message = format!("Failed to run docker pull: {}", error);
        emit_error(&app, "pull", &message, Some(0.0));
        message
    })?;
    let tracker = Arc::new(Mutex::new(DockerPullProgress::default()));
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let stdout_task = child.stdout.take().map(|stdout| {
        tokio::spawn(stream_docker_output(
            stdout,
            app.clone(),
            Arc::clone(&tracker),
            Arc::clone(&tail),
        ))
    });
    let stderr_task = child.stderr.take().map(|stderr| {
        tokio::spawn(stream_docker_output(
            stderr,
            app.clone(),
            Arc::clone(&tracker),
            Arc::clone(&tail),
        ))
    });
    let status = match child.wait().await {
        Ok(status) => status,
        Err(error) => {
            let message = format!("docker pull process failed: {}", error);
            emit_error(&app, "pull", &message, None);
            return Err(message);
        }
    };
    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }
    if !status.success() {
        let detail = tail
            .lock()
            .map(|entries| entries.iter().cloned().collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        let message = format!("docker pull failed: {}", detail);
        emit_error(&app, "pull", &message, None);
        return Err(message);
    }

    emit(&app, "pull", "Image pulled successfully", 1.0);
    Ok(format!("Pulled {}", image))
}

/// Start OpenClaw in a Docker container with bind-mounted config and workspace.
#[tauri::command]
pub async fn start_docker_gateway(
    app: AppHandle,
    state: State<'_, crate::state::GatewayProcess>,
    port: Option<u16>,
    tag: Option<String>,
) -> Result<GatewayStatus, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    paths::validate_runtime_mode(paths::OpenClawRuntimeMode::Docker)?;
    let target_port = port.unwrap_or_else(docker_gateway_configured_port);
    // A mode switch must release JunQi's own native child before Docker binds
    // the selected port. Do not touch an unknown external service here: a
    // subsequent `docker run` will surface a precise port-conflict error.
    release_managed_native_gateway_for_docker(&state, target_port).await?;
    state.transition(
        Some(crate::state::gateway_process::GatewayLifecycle::Starting),
        None,
        None,
        "start_docker_gateway: starting container",
    );
    let result = start_docker_gateway_locked(app, Some(target_port), tag).await;
    match &result {
        Ok(_) => state.transition(
            Some(crate::state::gateway_process::GatewayLifecycle::Running),
            Some(crate::state::gateway_process::GatewayRuntimeMode::Docker),
            None,
            "start_docker_gateway: container healthy",
        ),
        Err(_) => state.transition(
            Some(crate::state::gateway_process::GatewayLifecycle::Error),
            Some(crate::state::gateway_process::GatewayRuntimeMode::None),
            None,
            "start_docker_gateway: container failed",
        ),
    }
    result
}

/// Docker start implementation for callers that already own `operation_gate`.
pub(crate) async fn start_docker_gateway_locked(
    app: AppHandle,
    port: Option<u16>,
    tag: Option<String>,
) -> Result<GatewayStatus, String> {
    paths::validate_runtime_mode(paths::OpenClawRuntimeMode::Docker)?;
    let container_port = docker_gateway_configured_port();
    let port = port.unwrap_or(container_port);
    let tag = tag.unwrap_or_else(|| "latest".to_string());
    let image = format!("{}:{}", OPENCLAW_IMAGE, tag);
    let mapping = RuntimePathMapping::from_active_layout()?;
    let config_path = mapping.host_config_path.clone();
    let config_dir = mapping.host_config_dir()?.to_path_buf();
    let docker_bin = resolve_docker_bin().await?;

    // Detect a same-name collision before touching it, then repeat the check
    // immediately before removal to close the destructive-operation race.
    assert_named_container_is_not_foreign(&docker_bin, &mapping).await?;
    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create config dir: {}", e))?;
    std::fs::create_dir_all(&mapping.host_workspace)
        .map_err(|e| format!("Failed to create workspace dir: {}", e))?;

    let token = ensure_config_with_token(&config_path, container_port, "lan")?;
    mapping.normalize_config()?;
    let contract = ManagedContainerContract::for_mapping(&mapping);
    remove_managed_container_for_recreate(&docker_bin, &mapping).await?;

    emit(&app, "container", "Starting Docker container...", 0.15);

    let config_mount = format!(
        "{}:{}",
        config_dir.to_str().ok_or("Invalid config dir path")?,
        mapping.runtime_state_dir
    );
    let workspace_mount = format!(
        "{}:{}",
        mapping
            .host_workspace
            .to_str()
            .ok_or("Invalid workspace dir path")?,
        mapping.runtime_workspace
    );
    // Bind to the configured loopback host so the port is not exposed to the LAN.
    let port_mapping = format!(
        "{}:{}:{}",
        crate::commands::config::default_gateway_host(),
        port,
        container_port
    );
    let token_env = format!("OPENCLAW_GATEWAY_TOKEN={}", token);
    let state_dir_env = format!("OPENCLAW_STATE_DIR={}", mapping.runtime_state_dir);
    let config_path_env = format!("OPENCLAW_CONFIG_PATH={}", mapping.runtime_config_path);

    let mut run_args = vec![
        "run".to_string(),
        "-d".to_string(),
        "--name".to_string(),
        OPENCLAW_CONTAINER_NAME.to_string(),
    ];
    run_args.extend(contract.run_label_args());
    run_args.extend([
        "-p".to_string(),
        port_mapping,
        "-e".to_string(),
        token_env,
        "-e".to_string(),
        "OPENCLAW_GATEWAY_BIND=lan".to_string(),
        "-e".to_string(),
        state_dir_env,
        "-e".to_string(),
        config_path_env,
        "-v".to_string(),
        config_mount,
        "-v".to_string(),
        workspace_mount,
        "--restart".to_string(),
        "unless-stopped".to_string(),
        image,
    ]);
    let output = tokio::process::Command::new(&docker_bin)
        .args(&run_args)
        .output()
        .await
        .map_err(|e| format!("Failed to start Docker container: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = format!("docker run failed: {}", stderr);
        emit_error(&app, "container", &message, Some(0.2));
        return Err(message);
    }

    // Wait for the gateway to be ready (TCP connect check, up to 30s)
    // Use the same readiness contract as native mode: the mapped local port
    // must accept a TCP connection.
    emit(
        &app,
        "container",
        "Waiting for gateway to be ready...",
        0.55,
    );
    let addr = format!(
        "{}:{}",
        crate::commands::config::default_gateway_host(),
        port
    );
    let mut healthy = false;
    for attempt in 0..30 {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        if tokio::net::TcpStream::connect(&addr).await.is_ok() {
            healthy = true;
            break;
        }
        emit(
            &app,
            "container",
            &format!("Waiting for gateway health check ({}/30)...", attempt + 1),
            0.55 + (attempt as f64 / 30.0) * 0.4,
        );
    }

    if !healthy {
        // Check if container is still running
        let inspect = tokio::process::Command::new(&docker_bin)
            .args([
                "inspect",
                "--format",
                "{{.State.Running}}",
                OPENCLAW_CONTAINER_NAME,
            ])
            .output()
            .await;

        let container_running = inspect
            .map(|o| String::from_utf8_lossy(&o.stdout).trim() == "true")
            .unwrap_or(false);

        if !container_running {
            // Get container logs for debugging
            let logs = tokio::process::Command::new(&docker_bin)
                .args(["logs", "--tail", "20", OPENCLAW_CONTAINER_NAME])
                .output()
                .await;
            let log_text = logs
                .map(|o| {
                    let stdout = String::from_utf8_lossy(&o.stdout);
                    let stderr = String::from_utf8_lossy(&o.stderr);
                    format!("{}{}", stdout, stderr)
                })
                .unwrap_or_default();

            let message = format!("Container exited unexpectedly. Logs:\n{}", log_text);
            emit_error(&app, "container", &message, Some(0.95));
            return Err(message);
        }

        let message = "Gateway health check timed out after 30s";
        emit_error(&app, "container", message, Some(0.95));
        return Err(message.into());
    }

    emit(&app, "container", "Gateway is ready", 1.0);

    // SPEC M10: tail the container's log stream into the Rust-side circular
    // buffer so the Settings → Storage panel can show what just happened.
    // Detached from this command's lifetime — runs until the container exits
    // or the desktop process exits.
    spawn_docker_log_tailer(app.clone());

    Ok(GatewayStatus {
        running: true,
        port,
        pid: None, // Docker manages the PID
        token: Some(token),
    })
}

/// Spawn `docker logs -f --tail 50` for JunQi's managed container and pipe its lines into
/// the 200-entry circular buffer. Runs as a detached tokio task; logs are
/// tagged as `DockerStdout` / `DockerStderr` so the frontend can distinguish
/// them from native child logs.
fn spawn_docker_log_tailer(app: AppHandle) {
    use crate::state::gateway_process::{push_log, LogLevel, LogSource};
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    tokio::spawn(async move {
        let docker_bin = match resolve_docker_bin().await {
            Ok(bin) => bin,
            Err(e) => {
                eprintln!("docker log tailer resolve failed: {}", e);
                return;
            }
        };
        let mut cmd = Command::new(&docker_bin);
        cmd.args(["logs", "-f", "--tail", "50", OPENCLAW_CONTAINER_NAME])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("docker log tailer spawn failed: {}", e);
                return;
            }
        };

        let app_out = app.clone();
        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = crate::commands::diagnostic_output::sanitize_diagnostic_line(&line);
                    if line.is_empty() {
                        continue;
                    }
                    let _ = app_out.emit("gateway-log", &line);
                    let state = app_out.state::<crate::state::GatewayProcess>();
                    push_log(&state.logs, LogSource::DockerStdout, LogLevel::Info, line);
                }
            });
        }
        let app_err = app.clone();
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let line = crate::commands::diagnostic_output::sanitize_diagnostic_line(&line);
                    if line.is_empty() {
                        continue;
                    }
                    let _ = app_err.emit("gateway-log", &line);
                    let state = app_err.state::<crate::state::GatewayProcess>();
                    push_log(&state.logs, LogSource::DockerStderr, LogLevel::Warn, line);
                }
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        classify_container_inspection, legacy_container_matches_layout,
        normalize_docker_config_runtime_paths, parse_docker_layer_phase, parse_transfer_size,
        state_identity, transfer_ratio, ContainerPresence, DockerLayerPhase, DockerPullProgress,
        ManagedContainerContract, RuntimePathMapping, CONTAINER_OWNER, CONTAINER_OWNER_LABEL,
        CONTAINER_ROLE, CONTAINER_ROLE_LABEL, CONTAINER_SCHEMA, CONTAINER_SCHEMA_LABEL,
        CONTAINER_STATE_LABEL, OPENCLAW_CONTAINER_CONFIG_PATH, OPENCLAW_CONTAINER_STATE_DIR,
        OPENCLAW_CONTAINER_WORKSPACE_DIR,
    };
    use std::path::PathBuf;

    #[test]
    fn parses_docker_transfer_sizes_and_ratios() {
        assert_eq!(parse_transfer_size("1kB"), Some(1024.0));
        assert_eq!(parse_transfer_size("2MB"), Some(2.0 * 1024.0 * 1024.0));
        assert_eq!(transfer_ratio("Downloading 1MB/2MB"), Some(0.5));
    }

    #[test]
    fn docker_layer_progress_is_monotonic() {
        let mut tracker = DockerPullProgress::default();
        let first = tracker.observe("abc123: Downloading 1MB/2MB");
        let second = tracker.observe("abc123: Extracting 1MB/2MB");
        let delayed_layer = tracker.observe("def456: Pulling fs layer");
        let complete = tracker.observe("abc123: Pull complete");
        assert!(second > first);
        assert!(delayed_layer >= second);
        assert!(complete >= delayed_layer);
        assert!(complete <= 0.98);
    }

    #[test]
    fn docker_output_maps_to_explicit_layer_phases() {
        assert_eq!(
            parse_docker_layer_phase("Downloading 1MB/2MB"),
            Some(DockerLayerPhase::Downloading(0.5))
        );
        assert_eq!(
            parse_docker_layer_phase("Extracting 2MB/2MB"),
            Some(DockerLayerPhase::Extracting(1.0))
        );
        assert_eq!(
            parse_docker_layer_phase("Pull complete"),
            Some(DockerLayerPhase::Complete)
        );
        assert_eq!(parse_docker_layer_phase("Digest: sha256:abc"), None);
    }

    #[test]
    fn runtime_path_mapping_keeps_host_and_container_domains_separate() {
        let host_state = std::env::temp_dir().join("junqi-docker-state");
        let host_workspace = std::env::temp_dir().join("junqi-external-workspace");
        let mapping =
            RuntimePathMapping::for_layout(host_state.clone(), host_workspace.clone()).unwrap();

        assert_eq!(mapping.host_state_dir, host_state.clone());
        assert_eq!(
            mapping.host_config_path,
            host_state.join("docker/openclaw.json")
        );
        assert_eq!(mapping.host_workspace, host_workspace);
        assert_eq!(mapping.runtime_state_dir, OPENCLAW_CONTAINER_STATE_DIR);
        assert_eq!(mapping.runtime_config_path, OPENCLAW_CONTAINER_CONFIG_PATH);
        assert_eq!(mapping.runtime_workspace, OPENCLAW_CONTAINER_WORKSPACE_DIR);
        assert_ne!(
            PathBuf::from(mapping.runtime_workspace),
            mapping.host_workspace
        );
    }

    #[test]
    fn docker_config_normalization_replaces_host_workspace_with_runtime_path() {
        let root =
            std::env::temp_dir().join(format!("junqi-docker-config-{}", uuid::Uuid::new_v4()));
        let config_path = root.join("openclaw.json");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            &config_path,
            serde_json::json!({
                "agents": { "defaults": { "workspace": "X:\\CustomData\\workspace" } },
                "gateway": { "port": 18789 }
            })
            .to_string(),
        )
        .unwrap();

        normalize_docker_config_runtime_paths(&config_path).unwrap();
        let normalized: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
        assert_eq!(
            normalized["agents"]["defaults"]["workspace"],
            OPENCLAW_CONTAINER_WORKSPACE_DIR
        );
        assert_eq!(normalized["gateway"]["port"], 18789);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_container_contract_requires_complete_ownership_labels() {
        let state = std::env::temp_dir().join("junqi-owned-state");
        let state_id = state_identity(&state);
        let managed = serde_json::json!([{
            "Config": { "Labels": {
                CONTAINER_OWNER_LABEL: CONTAINER_OWNER,
                CONTAINER_ROLE_LABEL: CONTAINER_ROLE,
                CONTAINER_SCHEMA_LABEL: CONTAINER_SCHEMA,
                CONTAINER_STATE_LABEL: state_id,
            } },
            "State": { "Running": true }
        }]);
        assert_eq!(
            classify_container_inspection(&managed).unwrap(),
            ContainerPresence::Managed {
                running: true,
                state_id: state_identity(&state),
            }
        );

        let unlabelled = serde_json::json!([{
            "Config": { "Labels": null },
            "State": { "Running": true }
        }]);
        assert_eq!(
            classify_container_inspection(&unlabelled).unwrap(),
            ContainerPresence::Foreign
        );
    }

    #[test]
    fn legacy_container_upgrade_requires_matching_image_environment_and_mounts() {
        let state = std::env::temp_dir().join("junqi-legacy-state");
        let workspace = std::env::temp_dir().join("junqi-legacy-workspace");
        let mapping = RuntimePathMapping::for_layout(state.clone(), workspace.clone()).unwrap();
        let legacy = serde_json::json!([{
            "Config": {
                "Image": "ghcr.io/openclaw/openclaw:latest",
                "Env": [
                    "OPENCLAW_STATE_DIR=/home/node/.openclaw",
                    "OPENCLAW_CONFIG_PATH=/home/node/.openclaw/openclaw.json"
                ],
                "Labels": { "org.opencontainers.image.title": "openclaw" }
            },
            "Mounts": [
                {
                    "Type": "bind",
                    "Source": state.join("docker"),
                    "Destination": "/home/node/.openclaw"
                },
                {
                    "Type": "bind",
                    "Source": workspace,
                    "Destination": "/home/node/.openclaw/workspace"
                }
            ],
            "State": { "Running": false }
        }]);
        assert!(legacy_container_matches_layout(&legacy, &mapping));

        let wrong_layout = RuntimePathMapping::for_layout(
            std::env::temp_dir().join("another-state"),
            std::env::temp_dir().join("another-workspace"),
        )
        .unwrap();
        assert!(!legacy_container_matches_layout(&legacy, &wrong_layout));
    }

    #[test]
    fn state_identity_is_bound_to_selected_host_state_not_workspace() {
        let state = std::env::temp_dir().join("junqi-state-identity");
        let first = RuntimePathMapping::for_layout(
            state.clone(),
            std::env::temp_dir().join("workspace-one"),
        )
        .unwrap();
        let second =
            RuntimePathMapping::for_layout(state, std::env::temp_dir().join("workspace-two"))
                .unwrap();
        let moved = RuntimePathMapping::for_layout(
            std::env::temp_dir().join("junqi-state-moved"),
            std::env::temp_dir().join("workspace-two"),
        )
        .unwrap();

        assert_eq!(
            ManagedContainerContract::for_mapping(&first),
            ManagedContainerContract::for_mapping(&second)
        );
        assert_ne!(
            ManagedContainerContract::for_mapping(&first),
            ManagedContainerContract::for_mapping(&moved)
        );
    }
}

/// Stop the OpenClaw Docker container (without removing it).
#[tauri::command]
pub async fn stop_docker_gateway(
    state: State<'_, crate::state::GatewayProcess>,
) -> Result<String, String> {
    let operation_gate = state.operation_gate.clone();
    let _operation_guard = operation_gate.lock_owned().await;
    let result = stop_docker_gateway_locked().await;
    if result.is_ok() {
        state.transition(
            Some(crate::state::gateway_process::GatewayLifecycle::Stopped),
            Some(crate::state::gateway_process::GatewayRuntimeMode::None),
            None,
            "stop_docker_gateway: container stopped",
        );
    }
    result
}

pub(crate) async fn stop_docker_gateway_locked() -> Result<String, String> {
    let docker_bin = resolve_docker_bin().await?;
    let mapping = RuntimePathMapping::from_active_layout()?;
    stop_managed_container_if_present(&docker_bin, &mapping).await?;
    Ok("Docker gateway stopped".into())
}

/// Check if the Docker container is running.
#[tauri::command]
pub async fn docker_gateway_status(port: Option<u16>) -> Result<GatewayStatus, String> {
    let port = port.unwrap_or_else(docker_gateway_configured_port);
    let docker_bin = match resolve_docker_bin().await {
        Ok(bin) => bin,
        Err(_) => {
            return Ok(GatewayStatus {
                running: false,
                port,
                pid: None,
                token: None,
            });
        }
    };

    let mapping = RuntimePathMapping::from_active_layout()?;
    let contract = ManagedContainerContract::for_mapping(&mapping);
    match inspect_named_container(&docker_bin, &mapping).await? {
        ContainerPresence::Absent => Ok(GatewayStatus {
            running: false,
            port,
            pid: None,
            token: None,
        }),
        ContainerPresence::Foreign => Err(foreign_container_error()),
        ContainerPresence::LegacyManaged { running } => Ok(GatewayStatus {
            running,
            port,
            pid: None,
            token: None,
        }),
        ContainerPresence::Managed { running, state_id } => Ok(GatewayStatus {
            // A JunQi container from a migrated state root is safe to replace,
            // but it is not the Gateway selected by the current bootstrap.
            running: running && state_id == contract.state_id,
            port,
            pid: None,
            token: None,
        }),
    }
}
