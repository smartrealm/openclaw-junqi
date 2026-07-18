//! 集中的路径辅助函数：应用内所有文件系统路径的单一来源。
//!
//! 任何模块需要路径时都应从这里导入，不要在业务代码里临时拼路径。

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

const STORAGE_BOOTSTRAP_VERSION: u32 = 12;

/// The OpenClaw runtime selected by the user during setup.
///
/// This belongs beside the storage bootstrap instead of a frontend cache: the
/// active Gateway configuration must survive a desktop restart and be shared by
/// setup, Gateway recovery, and the configuration UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum OpenClawRuntimeMode {
    #[default]
    Native,
    Docker,
}

/// A durable memento of the complete storage/runtime layout. Runtime mode
/// switches only need the prior mode; changing Node, Git, or npm locations
/// needs every related path to be restored as one unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct StorageLayoutSnapshot {
    state_dir: PathBuf,
    config_path: PathBuf,
    workspace_dir: PathBuf,
    runtime_dir: PathBuf,
    npm_cache_dir: Option<PathBuf>,
    npm_prefix: Option<PathBuf>,
    node_runtime_dir: Option<PathBuf>,
    git_runtime_dir: Option<PathBuf>,
    openclaw_relocation_required: bool,
    terminal_integration: bool,
    runtime_mode: OpenClawRuntimeMode,
    runtime_switch_rollback_mode: Option<OpenClawRuntimeMode>,
    gateway_service_rebind_required: bool,
    gateway_service_was_running: bool,
}

impl StorageLayoutSnapshot {
    fn capture(layout: &StorageBootstrap) -> Self {
        Self {
            state_dir: layout.state_dir.clone(),
            config_path: layout.config_path.clone(),
            workspace_dir: layout.workspace_dir.clone(),
            runtime_dir: layout.runtime_dir.clone(),
            npm_cache_dir: layout.npm_cache_dir.clone(),
            npm_prefix: layout.npm_prefix.clone(),
            node_runtime_dir: layout.node_runtime_dir.clone(),
            git_runtime_dir: layout.git_runtime_dir.clone(),
            openclaw_relocation_required: layout.openclaw_relocation_required,
            terminal_integration: layout.terminal_integration,
            runtime_mode: layout.runtime_mode,
            runtime_switch_rollback_mode: layout.runtime_switch_rollback_mode,
            gateway_service_rebind_required: layout.gateway_service_rebind_required,
            gateway_service_was_running: layout.gateway_service_was_running,
        }
    }

    fn restore(&self) -> StorageBootstrap {
        StorageBootstrap {
            version: STORAGE_BOOTSTRAP_VERSION,
            state_dir: self.state_dir.clone(),
            config_path: self.config_path.clone(),
            workspace_dir: self.workspace_dir.clone(),
            runtime_dir: self.runtime_dir.clone(),
            npm_cache_dir: self.npm_cache_dir.clone(),
            npm_prefix: self.npm_prefix.clone(),
            node_runtime_dir: self.node_runtime_dir.clone(),
            git_runtime_dir: self.git_runtime_dir.clone(),
            openclaw_relocation_required: self.openclaw_relocation_required,
            terminal_integration: self.terminal_integration,
            runtime_mode: self.runtime_mode,
            runtime_switch_rollback_mode: self.runtime_switch_rollback_mode,
            gateway_service_rebind_required: self.gateway_service_rebind_required,
            gateway_service_was_running: self.gateway_service_was_running,
            pending_runtime_reconfiguration: None,
        }
    }

    fn matches_runtime_identity(&self, layout: &StorageBootstrap) -> bool {
        paths_refer_to_same_location(&self.state_dir, &layout.state_dir)
            && paths_refer_to_same_location(&self.config_path, &layout.config_path)
            && paths_refer_to_same_location(&self.workspace_dir, &layout.workspace_dir)
            && paths_refer_to_same_location(&self.runtime_dir, &layout.runtime_dir)
            && optional_paths_refer_to_same_location(
                self.npm_cache_dir.as_deref(),
                layout.npm_cache_dir.as_deref(),
            )
            && optional_paths_refer_to_same_location(
                self.npm_prefix.as_deref(),
                layout.npm_prefix.as_deref(),
            )
            && optional_paths_refer_to_same_location(
                self.node_runtime_dir.as_deref(),
                layout.node_runtime_dir.as_deref(),
            )
            && optional_paths_refer_to_same_location(
                self.git_runtime_dir.as_deref(),
                layout.git_runtime_dir.as_deref(),
            )
            && self.terminal_integration == layout.terminal_integration
            && self.runtime_mode == layout.runtime_mode
    }
}

/// The former Gateway ownership projected into a durable runtime transaction.
/// It intentionally records behavior rather than process IDs: desktop child
/// IDs cannot survive an application restart, while the selected runtime and
/// service ownership can be restored deterministically.
/// A verified native service launch plan retained only while a runtime
/// reconfiguration is pending. It lets recovery stop an existing Windows
/// Scheduled Task even when the candidate npm prefix or portable Node runtime
/// is intentionally incomplete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct NativeGatewayServiceLaunchContract {
    #[serde(default)]
    pub node: Option<PathBuf>,
    #[serde(default)]
    pub entry: Option<PathBuf>,
    #[serde(default)]
    pub executable: Option<PathBuf>,
    #[serde(default)]
    pub package_dir: Option<PathBuf>,
    #[serde(default)]
    pub npm_prefix: Option<PathBuf>,
}

impl NativeGatewayServiceLaunchContract {
    fn is_valid(&self) -> bool {
        let node_script = self
            .node
            .as_ref()
            .zip(self.entry.as_ref())
            .is_some_and(|(node, entry)| node.is_absolute() && entry.is_absolute())
            && self.executable.is_none();
        let executable = self
            .executable
            .as_ref()
            .is_some_and(|program| program.is_absolute())
            && self.node.is_none()
            && self.entry.is_none();
        (node_script || executable)
            && self
                .package_dir
                .as_ref()
                .is_none_or(|path| path.is_absolute())
            && self
                .npm_prefix
                .as_ref()
                .is_none_or(|path| path.is_absolute())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PendingGatewayRecovery {
    pub selected_runtime: OpenClawRuntimeMode,
    pub port: u16,
    pub selected_runtime_was_running: bool,
    pub selected_service_installed: bool,
    pub selected_service_was_running: bool,
    #[serde(default)]
    pub(crate) native_service_launch: Option<NativeGatewayServiceLaunchContract>,
}

impl PendingGatewayRecovery {
    pub(crate) fn native_service_launch(&self) -> Option<&NativeGatewayServiceLaunchContract> {
        self.native_service_launch.as_ref()
    }

    fn is_valid(&self) -> bool {
        self.port != 0
            && self
                .native_service_launch
                .as_ref()
                .is_none_or(NativeGatewayServiceLaunchContract::is_valid)
    }
}

/// Durable phase of a runtime-location rollback. Keeping the recovery phase in
/// the same memento prevents a failed service restore from losing the work
/// needed to resume it after the next desktop launch.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RuntimeReconfigurationRecoveryStage {
    #[default]
    CandidateActive,
    PreviousLayoutRestored,
}

/// Persistent two-phase transaction for a same-location runtime relocation.
/// The candidate layout remains active while setup installs/verifies its
/// dependencies. It must be explicitly committed after Gateway health is
/// proven; otherwise the old layout is recovered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct PendingRuntimeReconfiguration {
    previous: StorageLayoutSnapshot,
    candidate: StorageLayoutSnapshot,
    gateway: PendingGatewayRecovery,
    /// The durable marker is written before the old Gateway is stopped. This
    /// records whether the later storage transaction is allowed to mutate the
    /// Native workspace field, so crash recovery never rewrites a config for
    /// a Node/Git/npm-only change.
    #[serde(default)]
    native_workspace_written: bool,
    #[serde(default)]
    recovery_stage: RuntimeReconfigurationRecoveryStage,
    #[serde(default)]
    recovery_error: Option<String>,
}

impl PendingRuntimeReconfiguration {
    pub(crate) fn previous_layout(&self) -> StorageBootstrap {
        self.previous.restore()
    }

    pub(crate) fn gateway_recovery(&self) -> PendingGatewayRecovery {
        self.gateway.clone()
    }

    pub(crate) fn native_workspace_was_written(&self) -> bool {
        self.native_workspace_written
    }

    pub(crate) fn previous_layout_is_restored(&self) -> bool {
        self.recovery_is_pending()
    }

    fn recovery_is_pending(&self) -> bool {
        matches!(
            self.recovery_stage,
            RuntimeReconfigurationRecoveryStage::PreviousLayoutRestored
        )
    }

    fn recovery_error(&self) -> Option<&str> {
        self.recovery_error.as_deref()
    }

    fn matches_candidate(&self, layout: &StorageBootstrap) -> bool {
        self.candidate.matches_runtime_identity(layout)
    }

    fn validate_candidate(&self, layout: &StorageBootstrap) -> Result<(), String> {
        if !matches!(
            self.recovery_stage,
            RuntimeReconfigurationRecoveryStage::CandidateActive
        ) {
            return Err(
                "The prior runtime layout is already restored; resume its Gateway recovery instead of stopping a new candidate"
                    .to_string(),
            );
        }
        if self.matches_candidate(layout) {
            Ok(())
        } else {
            Err(
                "The active runtime locations changed while setup was running; refusing to recover an unrelated reconfiguration"
                    .to_string(),
            )
        }
    }

    fn validate_previous_layout(&self, layout: &StorageBootstrap) -> Result<(), String> {
        if !self.recovery_is_pending() {
            return Err(
                "The runtime reconfiguration is still active; the candidate must be stopped before restoring the previous Gateway"
                    .to_string(),
            );
        }
        if self.previous.matches_runtime_identity(layout) {
            Ok(())
        } else {
            Err(
                "The restored runtime locations changed before Gateway recovery completed; refusing to alter an unrelated runtime"
                    .to_string(),
            )
        }
    }

    fn mark_previous_layout_restored(&mut self) {
        self.recovery_stage = RuntimeReconfigurationRecoveryStage::PreviousLayoutRestored;
        self.recovery_error = None;
    }

    fn record_recovery_error(&mut self, error: String) {
        self.recovery_error = Some(error);
    }

    fn is_valid(&self) -> bool {
        self.previous.restore().paths_are_absolute()
            && self.candidate.restore().paths_are_absolute()
            && self.gateway.is_valid()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageBootstrap {
    pub version: u32,
    pub state_dir: PathBuf,
    pub config_path: PathBuf,
    pub workspace_dir: PathBuf,
    pub runtime_dir: PathBuf,
    /// An explicitly user-selected npm cache directory. `None` leaves cache
    /// resolution to npm for the current system user.
    pub npm_cache_dir: Option<PathBuf>,
    pub npm_prefix: Option<PathBuf>,
    /// An explicitly user-selected portable Node.js root. `None` means use
    /// the operating-system installation discovered at runtime.
    pub node_runtime_dir: Option<PathBuf>,
    /// An explicitly user-selected portable Git root. `None` means use the
    /// operating-system installation discovered at runtime.
    pub git_runtime_dir: Option<PathBuf>,
    /// A changed npm prefix requires OpenClaw to be installed and verified at
    /// the new location before the migrated runtime can be considered ready.
    pub openclaw_relocation_required: bool,
    pub terminal_integration: bool,
    pub runtime_mode: OpenClawRuntimeMode,
    pub runtime_switch_rollback_mode: Option<OpenClawRuntimeMode>,
    pub gateway_service_rebind_required: bool,
    pub gateway_service_was_running: bool,
    /// A pending Node/Git/npm location change is a distinct durable
    /// transaction from a Native/Docker mode switch. It contains the previous
    /// layout and Gateway ownership until the candidate runtime is healthy.
    pub(crate) pending_runtime_reconfiguration: Option<PendingRuntimeReconfiguration>,
}

/// The effective host-side locations used by a managed OpenClaw process.
///
/// Environment variables are process-level configuration and therefore take
/// precedence over the persisted bootstrap.  Resolving them as one value
/// prevents a state directory from coming from one installation while Node,
/// Git, or npm silently comes from another.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveRuntimeLocations {
    pub state_dir: PathBuf,
    pub config_path: PathBuf,
    pub node_runtime_dir: Option<PathBuf>,
    pub git_runtime_dir: Option<PathBuf>,
    pub npm_prefix: Option<PathBuf>,
    pub npm_cache_dir: Option<PathBuf>,
    pub openclaw_git_dir: Option<PathBuf>,
}

/// Process-scoped path overrides understood by JunQi and npm.
///
/// Keeping these values together prevents setup, migration, and process
/// launch from assigning different meanings to the same environment.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct RuntimeLocationOverrides {
    pub openclaw_home: Option<PathBuf>,
    pub state_dir: Option<PathBuf>,
    pub config_path: Option<PathBuf>,
    pub node_runtime_dir: Option<PathBuf>,
    pub git_runtime_dir: Option<PathBuf>,
    pub npm_prefix: Option<PathBuf>,
    pub npm_cache_dir: Option<PathBuf>,
    pub openclaw_git_dir: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedStorageBootstrap {
    version: u32,
    state_dir: PathBuf,
    config_path: PathBuf,
    workspace_dir: PathBuf,
    #[serde(default)]
    runtime_dir: Option<PathBuf>,
    #[serde(default)]
    npm_cache_dir: Option<PathBuf>,
    #[serde(default)]
    npm_prefix: Option<PathBuf>,
    #[serde(default)]
    node_runtime_dir: Option<PathBuf>,
    #[serde(default)]
    git_runtime_dir: Option<PathBuf>,
    #[serde(default)]
    openclaw_relocation_required: bool,
    #[serde(default)]
    terminal_integration: bool,
    #[serde(default)]
    runtime_mode: OpenClawRuntimeMode,
    #[serde(default)]
    runtime_switch_rollback_mode: Option<OpenClawRuntimeMode>,
    #[serde(default)]
    gateway_service_rebind_required: bool,
    #[serde(default)]
    gateway_service_was_running: bool,
    #[serde(default)]
    pending_runtime_reconfiguration: Option<PendingRuntimeReconfiguration>,
}

impl StorageBootstrap {
    pub fn for_state_dir(state_dir: PathBuf, workspace_dir: Option<PathBuf>) -> Self {
        let config_path = state_dir.join("openclaw.json");
        let workspace_dir = workspace_dir.unwrap_or_else(|| state_dir.join("workspace"));
        Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            runtime_dir: state_dir.clone(),
            state_dir,
            config_path,
            workspace_dir,
            npm_cache_dir: None,
            npm_prefix: None,
            node_runtime_dir: None,
            git_runtime_dir: None,
            openclaw_relocation_required: false,
            terminal_integration: false,
            runtime_mode: OpenClawRuntimeMode::Native,
            runtime_switch_rollback_mode: None,
            gateway_service_rebind_required: false,
            gateway_service_was_running: false,
            pending_runtime_reconfiguration: None,
        }
    }

    pub fn with_locations(
        state_dir: PathBuf,
        workspace_dir: PathBuf,
        runtime_dir: PathBuf,
        npm_cache_dir: Option<PathBuf>,
        npm_prefix: Option<PathBuf>,
        terminal_integration: bool,
    ) -> Self {
        Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            config_path: state_dir.join("openclaw.json"),
            state_dir,
            workspace_dir,
            runtime_dir,
            npm_cache_dir,
            npm_prefix,
            node_runtime_dir: None,
            git_runtime_dir: None,
            openclaw_relocation_required: false,
            terminal_integration,
            runtime_mode: OpenClawRuntimeMode::Native,
            runtime_switch_rollback_mode: None,
            gateway_service_rebind_required: false,
            gateway_service_was_running: false,
            pending_runtime_reconfiguration: None,
        }
    }

    fn from_persisted(value: PersistedStorageBootstrap) -> Option<Self> {
        if value.version == 0 || value.version > STORAGE_BOOTSTRAP_VERSION {
            return None;
        }
        let persisted_version = value.version;
        let PersistedStorageBootstrap {
            state_dir,
            config_path,
            workspace_dir,
            runtime_dir,
            npm_cache_dir,
            npm_prefix,
            node_runtime_dir,
            git_runtime_dir,
            openclaw_relocation_required,
            terminal_integration,
            runtime_mode,
            runtime_switch_rollback_mode,
            gateway_service_rebind_required,
            gateway_service_was_running,
            pending_runtime_reconfiguration,
            ..
        } = value;
        let runtime_dir = runtime_dir.unwrap_or_else(|| state_dir.clone());
        let node_runtime_dir = node_runtime_dir.map(normalize_node_runtime_root);
        let git_runtime_dir = git_runtime_dir.map(normalize_git_runtime_root);
        // Preserve explicit portable-runtime selections even when an older
        // bootstrap placed one inside the data tree. Storage validation will
        // surface the overlap and require a deliberate correction; silently
        // dropping it here would make the next launch mix system and portable
        // runtimes without telling the user.
        // Version 8 briefly persisted Docker's derived container config in the
        // bootstrap `config_path` field. That made a later Docker -> Native
        // switch launch the container-only file on the host. Bootstrap owns
        // the Native config location now; migrate only the exact old derived
        // path and preserve every explicit external config path.
        let config_path = if persisted_version < STORAGE_BOOTSTRAP_VERSION
            && matches!(runtime_mode, OpenClawRuntimeMode::Docker)
            && paths_refer_to_same_location(
                &config_path,
                &config_path_for_runtime(&state_dir, OpenClawRuntimeMode::Docker),
            ) {
            state_dir.join("openclaw.json")
        } else {
            config_path
        };
        let normalized = Self {
            version: STORAGE_BOOTSTRAP_VERSION,
            state_dir,
            config_path,
            workspace_dir,
            runtime_dir,
            npm_cache_dir,
            npm_prefix,
            node_runtime_dir,
            git_runtime_dir,
            openclaw_relocation_required,
            terminal_integration,
            runtime_mode,
            runtime_switch_rollback_mode,
            gateway_service_rebind_required,
            gateway_service_was_running,
            pending_runtime_reconfiguration,
        };
        (normalized.paths_are_absolute()
            && normalized
                .pending_runtime_reconfiguration
                .as_ref()
                .is_none_or(PendingRuntimeReconfiguration::is_valid))
        .then_some(normalized)
    }

    fn to_persisted(&self) -> PersistedStorageBootstrap {
        PersistedStorageBootstrap {
            version: STORAGE_BOOTSTRAP_VERSION,
            state_dir: self.state_dir.clone(),
            config_path: self.config_path.clone(),
            workspace_dir: self.workspace_dir.clone(),
            runtime_dir: Some(self.runtime_dir.clone()),
            npm_cache_dir: self.npm_cache_dir.clone(),
            npm_prefix: self.npm_prefix.clone(),
            node_runtime_dir: self.node_runtime_dir.clone(),
            git_runtime_dir: self.git_runtime_dir.clone(),
            openclaw_relocation_required: self.openclaw_relocation_required,
            terminal_integration: self.terminal_integration,
            runtime_mode: self.runtime_mode,
            runtime_switch_rollback_mode: self.runtime_switch_rollback_mode,
            gateway_service_rebind_required: self.gateway_service_rebind_required,
            gateway_service_was_running: self.gateway_service_was_running,
            pending_runtime_reconfiguration: self.pending_runtime_reconfiguration.clone(),
        }
    }

    fn paths_are_absolute(&self) -> bool {
        absolute_non_root(&self.state_dir)
            && absolute_non_root(&self.config_path)
            && absolute_non_root(&self.workspace_dir)
            && absolute_non_root(&self.runtime_dir)
            && self
                .npm_cache_dir
                .as_ref()
                .is_none_or(|path| absolute_non_root(path))
            && self
                .npm_prefix
                .as_ref()
                .is_none_or(|path| absolute_non_root(path))
            && self
                .node_runtime_dir
                .as_ref()
                .is_none_or(|path| absolute_non_root(path))
            && self
                .git_runtime_dir
                .as_ref()
                .is_none_or(|path| absolute_non_root(path))
    }
}

fn absolute_non_root(path: &Path) -> bool {
    path.is_absolute() && path.parent().is_some_and(|parent| parent != path)
}

fn path_has_parent_traversal(path: &Path) -> bool {
    path.components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn explicit_absolute_env_path(key: &str, label: &str) -> Result<Option<PathBuf>, String> {
    let Some(value) = std::env::var_os(key).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let path = PathBuf::from(value);
    if !absolute_non_root(&path) {
        return Err(format!(
            "{label} override {key} must be an absolute non-root path"
        ));
    }
    if path_has_parent_traversal(&path) {
        return Err(format!(
            "{label} override {key} cannot contain parent-directory traversal"
        ));
    }
    Ok(Some(path))
}

fn equivalent_env_paths(
    label: &str,
    candidates: impl IntoIterator<Item = (&'static str, Option<PathBuf>)>,
) -> Result<Option<PathBuf>, String> {
    let mut selected: Option<(&str, PathBuf)> = None;
    for (key, value) in candidates {
        let Some(value) = value else { continue };
        if let Some((selected_key, selected_path)) = &selected {
            if !paths_refer_to_same_location(selected_path, &value) {
                return Err(format!(
                    "{label} overrides {selected_key} ({}) and {key} ({}) conflict",
                    selected_path.display(),
                    value.display()
                ));
            }
        } else {
            selected = Some((key, value));
        }
    }
    Ok(selected.map(|(_, path)| path))
}

pub(crate) fn runtime_location_overrides() -> Result<RuntimeLocationOverrides, String> {
    if let Some(profile) = std::env::var_os("OPENCLAW_PROFILE").filter(|value| !value.is_empty()) {
        let profile = profile.to_string_lossy();
        if !profile.eq_ignore_ascii_case("default") {
            return Err(format!(
                "OPENCLAW_PROFILE={profile} is not supported by JunQi's managed Gateway; use explicit OPENCLAW_STATE_DIR and OPENCLAW_CONFIG_PATH for this instance"
            ));
        }
    }
    let openclaw_home = explicit_absolute_env_path("OPENCLAW_HOME", "OpenClaw home")?;
    let explicit_state = explicit_absolute_env_path("OPENCLAW_STATE_DIR", "OpenClaw state")?;
    let junqi_npm_prefix = explicit_absolute_env_path("JUNQI_NPM_PREFIX", "npm prefix")?;
    let npm_prefix_lower = explicit_absolute_env_path("npm_config_prefix", "npm prefix")?;
    let npm_prefix_upper = explicit_absolute_env_path("NPM_CONFIG_PREFIX", "npm prefix")?;
    let npm_prefix = equivalent_env_paths(
        "npm prefix",
        [
            ("JUNQI_NPM_PREFIX", junqi_npm_prefix),
            ("npm_config_prefix", npm_prefix_lower),
            ("NPM_CONFIG_PREFIX", npm_prefix_upper),
        ],
    )?;
    let npm_cache_dir = equivalent_env_paths(
        "npm cache",
        [
            (
                "npm_config_cache",
                explicit_absolute_env_path("npm_config_cache", "npm cache")?,
            ),
            (
                "NPM_CONFIG_CACHE",
                explicit_absolute_env_path("NPM_CONFIG_CACHE", "npm cache")?,
            ),
        ],
    )?;
    Ok(RuntimeLocationOverrides {
        openclaw_home: openclaw_home.clone(),
        state_dir: explicit_state.or_else(|| openclaw_home.map(|home| home.join(".openclaw"))),
        config_path: explicit_absolute_env_path("OPENCLAW_CONFIG_PATH", "OpenClaw config")?,
        node_runtime_dir: explicit_absolute_env_path("JUNQI_NODE_RUNTIME_DIR", "Node.js runtime")?
            .map(normalize_node_runtime_root),
        git_runtime_dir: explicit_absolute_env_path("JUNQI_GIT_RUNTIME_DIR", "Git runtime")?
            .map(normalize_git_runtime_root),
        npm_prefix,
        npm_cache_dir,
        openclaw_git_dir: explicit_absolute_env_path("OPENCLAW_GIT_DIR", "OpenClaw Git checkout")?,
    })
}

fn load_storage_bootstrap_checked() -> Result<Option<StorageBootstrap>, String> {
    let path = storage_bootstrap_path();
    if !path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&path).map_err(|error| {
        format!(
            "Failed to read storage bootstrap {}: {error}",
            path.display()
        )
    })?;
    let persisted: PersistedStorageBootstrap = serde_json::from_str(&raw).map_err(|error| {
        format!(
            "Storage bootstrap {} is invalid JSON: {error}",
            path.display()
        )
    })?;
    let layout = StorageBootstrap::from_persisted(persisted).ok_or_else(|| {
        format!(
            "Storage bootstrap {} contains unsupported or non-absolute paths",
            path.display()
        )
    })?;
    validate_persisted_runtime_locations(&layout)?;
    Ok(Some(layout))
}

fn validate_persisted_runtime_locations(layout: &StorageBootstrap) -> Result<(), String> {
    let fields = [
        ("state directory", layout.state_dir.as_path()),
        ("config path", layout.config_path.as_path()),
        ("workspace directory", layout.workspace_dir.as_path()),
        ("OpenClaw runtime directory", layout.runtime_dir.as_path()),
    ];
    for (label, path) in fields {
        if !absolute_non_root(path) || path_has_parent_traversal(path) {
            return Err(format!(
                "Persisted {label} must be an absolute non-root path without traversal"
            ));
        }
    }
    let optional = [
        ("npm cache directory", layout.npm_cache_dir.as_deref()),
        ("npm global prefix", layout.npm_prefix.as_deref()),
        ("custom Node.js runtime", layout.node_runtime_dir.as_deref()),
        ("custom Git runtime", layout.git_runtime_dir.as_deref()),
    ];
    for (label, path) in optional {
        if let Some(path) = path {
            if !absolute_non_root(path) || path_has_parent_traversal(path) {
                return Err(format!(
                    "Persisted {label} must be an absolute non-root path without traversal"
                ));
            }
        }
    }
    for (label, path) in [
        ("npm global prefix", layout.npm_prefix.as_deref()),
        ("custom Node.js runtime", layout.node_runtime_dir.as_deref()),
        ("custom Git runtime", layout.git_runtime_dir.as_deref()),
    ] {
        if path.is_some_and(|path| paths_overlap(path, &layout.state_dir)) {
            return Err(format!(
                "Persisted {label} overlaps the OpenClaw state directory"
            ));
        }
    }
    for (index, (left_label, left)) in optional.iter().enumerate() {
        let Some(left) = left else { continue };
        for (right_label, right) in optional.iter().skip(index + 1) {
            let Some(right) = right else { continue };
            if paths_overlap(left, right) {
                return Err(format!(
                    "Persisted {left_label} and {right_label} directories overlap"
                ));
            }
        }
    }
    Ok(())
}

/// Resolve and validate every process-level runtime override before a command
/// is allowed to inspect or mutate OpenClaw. Invalid explicit values fail fast;
/// they never fall back to a different machine-wide installation.
pub fn effective_runtime_locations() -> Result<EffectiveRuntimeLocations, String> {
    let overrides = runtime_location_overrides()?;
    let state_override = overrides.state_dir;
    let config_override = overrides.config_path;
    let bootstrap = load_storage_bootstrap_checked()?;
    let state_is_overridden = state_override.is_some();
    let state_dir = state_override
        .or_else(|| bootstrap.as_ref().map(|layout| layout.state_dir.clone()))
        .unwrap_or_else(legacy_default_state_dir);
    let config_path = config_override
        .or_else(|| {
            (!state_is_overridden)
                .then(|| bootstrap.as_ref().map(|layout| layout.config_path.clone()))
                .flatten()
        })
        .unwrap_or_else(|| state_dir.join("openclaw.json"));

    if !absolute_non_root(&state_dir) || path_has_parent_traversal(&state_dir) {
        return Err(
            "OpenClaw state directory must be an absolute non-root path without traversal".into(),
        );
    }
    if !absolute_non_root(&config_path) || path_has_parent_traversal(&config_path) {
        return Err(
            "OpenClaw config path must be an absolute non-root path without traversal".into(),
        );
    }

    let node_runtime_dir = overrides.node_runtime_dir.or_else(|| {
        bootstrap
            .as_ref()
            .and_then(|layout| layout.node_runtime_dir.clone())
    });
    let git_runtime_dir = overrides.git_runtime_dir.or_else(|| {
        bootstrap
            .as_ref()
            .and_then(|layout| layout.git_runtime_dir.clone())
    });
    let npm_prefix = overrides.npm_prefix.or_else(|| {
        bootstrap
            .as_ref()
            .and_then(|layout| layout.npm_prefix.clone())
    });
    let npm_cache_dir = overrides.npm_cache_dir.or_else(|| {
        bootstrap
            .as_ref()
            .and_then(|layout| layout.npm_cache_dir.clone())
    });
    let openclaw_git_dir = overrides.openclaw_git_dir;
    if openclaw_git_dir.is_some() && npm_prefix.is_some() {
        return Err(
            "OPENCLAW_GIT_DIR and an npm global prefix select different OpenClaw installation sources; configure only one"
                .into(),
        );
    }
    if openclaw_git_dir.is_some()
        && bootstrap
            .as_ref()
            .is_some_and(|layout| layout.openclaw_relocation_required)
    {
        return Err(
            "An npm relocation is pending while OPENCLAW_GIT_DIR selects a Git checkout; finish or cancel the storage relocation first"
                .into(),
        );
    }

    let dependencies = [
        ("Node.js runtime", node_runtime_dir.as_deref()),
        ("Git runtime", git_runtime_dir.as_deref()),
        ("npm prefix", npm_prefix.as_deref()),
        ("OpenClaw Git checkout", openclaw_git_dir.as_deref()),
    ];
    for (label, path) in dependencies {
        if let Some(path) = path {
            if paths_overlap(path, &state_dir) {
                return Err(format!(
                    "{label} must be outside the OpenClaw state directory"
                ));
            }
        }
    }
    for (index, (left_label, left)) in dependencies.iter().enumerate() {
        let Some(left) = left else { continue };
        for (right_label, right) in dependencies.iter().skip(index + 1) {
            let Some(right) = right else { continue };
            if paths_overlap(left, right) {
                return Err(format!(
                    "{left_label} and {right_label} directories must be separate"
                ));
            }
        }
    }

    Ok(EffectiveRuntimeLocations {
        state_dir,
        config_path,
        node_runtime_dir,
        git_runtime_dir,
        npm_prefix,
        npm_cache_dir,
        openclaw_git_dir,
    })
}

pub fn validate_runtime_overrides() -> Result<(), String> {
    effective_runtime_locations().map(|_| ())
}

/// Validate only process-level overrides. Storage setup uses this narrower
/// contract so a damaged legacy bootstrap can still be repaired through the
/// storage gate instead of being needed to load successfully first.
pub fn validate_explicit_runtime_overrides() -> Result<(), String> {
    let overrides = runtime_location_overrides()?;
    if overrides.openclaw_git_dir.is_some() && overrides.npm_prefix.is_some() {
        return Err("OPENCLAW_GIT_DIR and an npm global prefix cannot both select OpenClaw".into());
    }
    let state = overrides.state_dir.unwrap_or_else(|| {
        load_storage_bootstrap()
            .map(|layout| layout.state_dir)
            .unwrap_or_else(legacy_default_state_dir)
    });
    let dependencies = [
        ("Node.js runtime", overrides.node_runtime_dir.as_deref()),
        ("Git runtime", overrides.git_runtime_dir.as_deref()),
        ("npm prefix", overrides.npm_prefix.as_deref()),
        (
            "OpenClaw Git checkout",
            overrides.openclaw_git_dir.as_deref(),
        ),
    ];
    for (label, path) in dependencies {
        if path.is_some_and(|path| paths_overlap(path, &state)) {
            return Err(format!(
                "{label} must be outside the OpenClaw state directory"
            ));
        }
    }
    for (index, (left_label, left)) in dependencies.iter().enumerate() {
        let Some(left) = left else { continue };
        for (right_label, right) in dependencies.iter().skip(index + 1) {
            let Some(right) = right else { continue };
            if paths_overlap(left, right) {
                return Err(format!(
                    "{left_label} and {right_label} directories must be separate"
                ));
            }
        }
    }
    Ok(())
}

/// Return an explicitly supplied config path without applying the bootstrap
/// fallback. Docker uses this to reject a host config override it cannot mount
/// under the selected container contract.
pub fn explicit_config_path_override() -> Result<Option<PathBuf>, String> {
    Ok(runtime_location_overrides()?.config_path)
}

pub fn validate_runtime_mode(mode: OpenClawRuntimeMode) -> Result<(), String> {
    let locations = effective_runtime_locations()?;
    if matches!(mode, OpenClawRuntimeMode::Docker) {
        if let Some(config) = explicit_config_path_override()? {
            let expected =
                config_path_for_runtime(&locations.state_dir, OpenClawRuntimeMode::Docker);
            if !paths_refer_to_same_location(&config, &expected) {
                return Err(format!(
                    "Docker runtime requires OPENCLAW_CONFIG_PATH to be {}, but {} was selected",
                    expected.display(),
                    config.display()
                ));
            }
        }
    }
    Ok(())
}

// ── 应用状态根目录 ────────────────────────────────────────────

fn home_dir_or_fallback() -> PathBuf {
    dirs::home_dir()
        .or_else(dirs::data_local_dir)
        .unwrap_or_else(|| std::env::temp_dir().join("junqi"))
}

/// Stable location that is never stored inside the movable OpenClaw state dir.
pub fn app_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| home_dir_or_fallback().join(".config"))
        .join("com.junqi.junqidesktop")
}

pub fn storage_bootstrap_path() -> PathBuf {
    app_config_dir().join("bootstrap.json")
}

pub fn legacy_default_state_dir() -> PathBuf {
    home_dir_or_fallback().join(".openclaw")
}

pub fn load_storage_bootstrap() -> Option<StorageBootstrap> {
    let raw = std::fs::read_to_string(storage_bootstrap_path()).ok()?;
    let persisted: PersistedStorageBootstrap = serde_json::from_str(&raw).ok()?;
    StorageBootstrap::from_persisted(persisted)
}

pub fn save_storage_bootstrap(bootstrap: &StorageBootstrap) -> Result<(), String> {
    if !bootstrap.paths_are_absolute() {
        return Err("Storage paths must be absolute".to_string());
    }
    validate_persisted_runtime_locations(bootstrap)?;
    let path = storage_bootstrap_path();
    write_storage_bootstrap(&path, bootstrap)
}

fn write_storage_bootstrap(path: &Path, bootstrap: &StorageBootstrap) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(&bootstrap.to_persisted())
        .map_err(|e| format!("Failed to serialize bootstrap: {}", e))?;
    atomic_write_text(path, &raw).map_err(|error| format!("Failed to write bootstrap: {}", error))
}

pub(crate) fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid atomic write path")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let tmp = parent.join(format!(
        ".{}-{}-{}.tmp",
        file_name,
        std::process::id(),
        suffix
    ));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to write temporary file: {}", error));
    }
    if let Err(error) = replace_file(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to replace destination: {}", error));
    }
    Ok(())
}

fn normalize_existing_path_prefix(path: &Path) -> PathBuf {
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

fn path_identity_key(path: &Path) -> String {
    let value = normalize_existing_path_prefix(path)
        .to_string_lossy()
        .to_string();
    if cfg!(windows) {
        normalize_windows_identity_text(&value)
    } else {
        value
    }
}

fn normalize_windows_identity_text(value: &str) -> String {
    let mut normalized = value.replace('/', "\\");
    let folded = normalized.to_ascii_lowercase();
    if folded.starts_with("\\\\?\\unc\\") {
        normalized = format!("\\\\{}", &normalized[8..]);
    } else if folded.starts_with("\\\\?\\") || folded.starts_with("\\??\\") {
        normalized = normalized[4..].to_string();
    }
    while normalized.ends_with('\\') && !is_windows_drive_root(&normalized) {
        normalized.pop();
    }
    normalized.to_lowercase()
}

fn is_windows_drive_root(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
}

pub(crate) fn paths_refer_to_same_location(left: &Path, right: &Path) -> bool {
    path_identity_key(left) == path_identity_key(right)
}

pub(crate) fn optional_paths_refer_to_same_location(
    left: Option<&Path>,
    right: Option<&Path>,
) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => paths_refer_to_same_location(left, right),
        (None, None) => true,
        _ => false,
    }
}

pub(crate) fn paths_overlap(left: &Path, right: &Path) -> bool {
    let left = path_identity_key(left);
    let right = path_identity_key(right);
    let separator = if cfg!(windows) { '\\' } else { '/' };
    if left == right {
        return true;
    }
    let left_prefix = format!("{}{}", left.trim_end_matches(separator), separator);
    let right_prefix = format!("{}{}", right.trim_end_matches(separator), separator);
    left.starts_with(&right_prefix) || right.starts_with(&left_prefix)
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::rename(source, target)
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let moved = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

pub fn remove_storage_bootstrap() -> Result<(), String> {
    let path = storage_bootstrap_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove bootstrap: {}", e))?;
    }
    Ok(())
}

/// Return the selected OpenClaw state root. Explicit environment overrides
/// win, followed by JunQi's stable bootstrap, then the legacy default.
pub fn desktop_dir() -> PathBuf {
    runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.state_dir)
        .or_else(|| load_storage_bootstrap().map(|b| b.state_dir))
        .unwrap_or_else(legacy_default_state_dir)
}

// ── 配置 ───────────────────────────────────────────────────────

/// 返回标准 OpenClaw 配置路径：`~/.openclaw/openclaw.json`。
pub fn config_path() -> PathBuf {
    if let Some(path) = std::env::var_os("OPENCLAW_CONFIG_PATH")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return path;
    }
    if runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.state_dir)
        .is_some()
    {
        return desktop_dir().join("openclaw.json");
    }
    load_storage_bootstrap()
        .map(|bootstrap| bootstrap.config_path)
        .unwrap_or_else(|| desktop_dir().join("openclaw.json"))
}

/// Resolve the configuration location inside a state root for a specific
/// runtime. Storage migration uses this instead of assuming that every active
/// configuration is the Native `openclaw.json` file.
pub fn config_path_for_runtime(state_dir: &Path, mode: OpenClawRuntimeMode) -> PathBuf {
    match mode {
        OpenClawRuntimeMode::Native => state_dir.join("openclaw.json"),
        OpenClawRuntimeMode::Docker => state_dir.join("docker").join("openclaw.json"),
    }
}

/// The isolated configuration mounted into the OpenClaw Docker container.
pub fn docker_config_path() -> PathBuf {
    config_path_for_runtime(&desktop_dir(), OpenClawRuntimeMode::Docker)
}

/// The runtime selected during setup. Legacy bootstrap files remain native by
/// default so upgrading JunQi never changes an existing user's runtime.
pub fn active_runtime_mode() -> OpenClawRuntimeMode {
    load_storage_bootstrap()
        .map(|layout| layout.runtime_mode)
        .unwrap_or_default()
}

/// Resolve the authoritative OpenClaw configuration for the selected runtime.
/// Native-only process commands must continue to call `config_path()` directly.
pub fn active_config_path() -> PathBuf {
    match active_runtime_mode() {
        OpenClawRuntimeMode::Native => config_path(),
        OpenClawRuntimeMode::Docker => docker_config_path(),
    }
}

/// The cwd contract shared by every JunQi-managed OpenClaw process and by
/// storage's interpretation of relative workspace paths. It is intentionally
/// independent from the selected state/config directory so a drive root can
/// never become Node's current-directory token on Windows.
pub(crate) fn stable_openclaw_working_dir() -> Option<PathBuf> {
    let candidates = [
        dirs::home_dir(),
        dirs::data_local_dir(),
        Some(std::env::temp_dir().join("junqi-openclaw")),
    ];
    for path in candidates.into_iter().flatten() {
        if path.parent().is_none_or(|parent| parent == path) {
            continue;
        }
        if path.is_dir() {
            return Some(path);
        }
        if path.starts_with(std::env::temp_dir()) && std::fs::create_dir_all(&path).is_ok() {
            return Some(path);
        }
    }
    None
}

/// Persist an explicit runtime choice. Runtime selection is only valid after
/// storage setup, which guarantees that the choice has a stable home.
pub fn begin_active_runtime_mode_switch(mode: OpenClawRuntimeMode) -> Result<(), String> {
    let mut layout = load_storage_bootstrap()
        .ok_or("Storage setup must be completed before selecting an OpenClaw runtime")?;
    if let Some(pending) = layout.pending_runtime_reconfiguration.as_ref() {
        pending.validate_candidate(&layout)?;
        if layout.runtime_mode != mode {
            return Err(
                "A Native runtime location change is still pending. Recover or complete it before selecting a different runtime"
                    .to_string(),
            );
        }
    }
    if let Some(previous) = layout.runtime_switch_rollback_mode {
        if layout.runtime_mode == mode {
            return Ok(());
        }
        return Err(format!(
            "A runtime switch from {previous:?} to {:?} is already pending",
            layout.runtime_mode
        ));
    }
    if layout.runtime_mode == mode {
        return Ok(());
    }
    layout.runtime_switch_rollback_mode = Some(layout.runtime_mode);
    layout.runtime_mode = mode;
    save_storage_bootstrap(&layout)
}

pub fn commit_active_runtime_mode_switch(expected: OpenClawRuntimeMode) -> Result<(), String> {
    let mut layout = load_storage_bootstrap()
        .ok_or("Storage setup must be completed before committing an OpenClaw runtime")?;
    if layout.runtime_mode != expected {
        return Err("The active runtime changed before setup could commit it".into());
    }
    layout.runtime_switch_rollback_mode = None;
    save_storage_bootstrap(&layout)
}

pub fn rollback_active_runtime_mode_switch(expected: OpenClawRuntimeMode) -> Result<(), String> {
    let mut layout = load_storage_bootstrap()
        .ok_or("Storage setup must be completed before rolling back an OpenClaw runtime")?;
    if layout.runtime_mode != expected {
        return Err("The active runtime changed before setup could roll it back".into());
    }
    if let Some(previous) = layout.runtime_switch_rollback_mode.take() {
        layout.runtime_mode = previous;
        save_storage_bootstrap(&layout)?;
    }
    Ok(())
}

/// Recover a mode selection interrupted by process exit. Runtime resources are
/// reconciled lazily by the selected mode's normal startup path, which only
/// stops JunQi-owned containers/processes.
pub fn recover_interrupted_runtime_mode_switch() -> Result<bool, String> {
    let Some(mut layout) = load_storage_bootstrap() else {
        return Ok(false);
    };
    let Some(previous) = layout.runtime_switch_rollback_mode.take() else {
        return Ok(false);
    };
    layout.runtime_mode = previous;
    save_storage_bootstrap(&layout)?;
    Ok(true)
}

/// Stage a same-location Node/Git/npm relocation before any existing Gateway
/// is stopped. The caller persists `candidate` as the active layout while the
/// setup flow installs dependencies, then must explicitly commit or roll it
/// back. Nested transactions are rejected because their recovery order would
/// be ambiguous after a desktop restart.
pub(crate) fn begin_runtime_reconfiguration(
    previous: &StorageBootstrap,
    candidate: &mut StorageBootstrap,
    gateway: PendingGatewayRecovery,
    native_workspace_written: bool,
) -> Result<(), String> {
    if previous.pending_runtime_reconfiguration.is_some()
        || candidate.pending_runtime_reconfiguration.is_some()
    {
        return Err(
            "A runtime location reconfiguration is already pending; finish or recover it before changing locations again"
                .to_string(),
        );
    }
    if gateway.port == 0 {
        return Err("A runtime location reconfiguration requires a valid Gateway port".to_string());
    }
    candidate.pending_runtime_reconfiguration = Some(PendingRuntimeReconfiguration {
        previous: StorageLayoutSnapshot::capture(previous),
        candidate: StorageLayoutSnapshot::capture(candidate),
        gateway,
        native_workspace_written,
        recovery_stage: RuntimeReconfigurationRecoveryStage::CandidateActive,
        recovery_error: None,
    });
    Ok(())
}

/// Read the active candidate layout and verify that it is still the exact
/// layout captured by the durable reconfiguration memento. Callers must run
/// this before mutating configuration or stopping a candidate Gateway during
/// rollback; otherwise a stale marker could act on paths selected later by
/// the user.
pub(crate) fn preflight_runtime_reconfiguration_rollback(
) -> Result<Option<(StorageBootstrap, PendingRuntimeReconfiguration)>, String> {
    let Some(layout) = load_storage_bootstrap_checked()? else {
        return Ok(None);
    };
    let Some(pending) = layout.pending_runtime_reconfiguration.clone() else {
        return Ok(None);
    };
    pending.validate_candidate(&layout)?;
    Ok(Some((layout, pending)))
}

/// Return the durable reconfiguration in whichever recovery phase it reached.
/// Candidate operations and previous-layout operations validate different
/// identities, so this is intentionally separate from the destructive
/// candidate preflight above.
pub(crate) fn preflight_runtime_reconfiguration_recovery(
) -> Result<Option<(StorageBootstrap, PendingRuntimeReconfiguration)>, String> {
    let Some(layout) = load_storage_bootstrap_checked()? else {
        return Ok(None);
    };
    let Some(pending) = layout.pending_runtime_reconfiguration.clone() else {
        return Ok(None);
    };
    match pending.recovery_stage {
        RuntimeReconfigurationRecoveryStage::CandidateActive => {
            pending.validate_candidate(&layout)?
        }
        RuntimeReconfigurationRecoveryStage::PreviousLayoutRestored => {
            pending.validate_previous_layout(&layout)?
        }
    }
    Ok(Some((layout, pending)))
}

/// Persist the previous runtime layout but retain the memento until its
/// Gateway service and terminal integration have also been restored.
pub(crate) fn stage_runtime_reconfiguration_previous_layout(
) -> Result<Option<PendingRuntimeReconfiguration>, String> {
    let Some((_, mut pending)) = preflight_runtime_reconfiguration_rollback()? else {
        return Ok(None);
    };
    pending.mark_previous_layout_restored();
    let mut previous = pending.previous_layout();
    previous.pending_runtime_reconfiguration = Some(pending.clone());
    save_storage_bootstrap(&previous)?;
    Ok(Some(pending))
}

/// Complete recovery only after the previous Gateway/service contract is back
/// in place. A later startup can resume this exact phase if that work fails.
pub(crate) fn complete_runtime_reconfiguration_recovery(
) -> Result<Option<PendingRuntimeReconfiguration>, String> {
    let Some(mut layout) = load_storage_bootstrap_checked()? else {
        return Ok(None);
    };
    let Some(pending) = layout.pending_runtime_reconfiguration.take() else {
        return Ok(None);
    };
    pending.validate_previous_layout(&layout)?;
    save_storage_bootstrap(&layout)?;
    Ok(Some(pending))
}

/// Keep a recovery marker visible and retryable when restoration fails after
/// the old layout has already been made active.
pub(crate) fn record_runtime_reconfiguration_recovery_error(error: String) -> Result<(), String> {
    let Some(mut layout) = load_storage_bootstrap_checked()? else {
        return Ok(());
    };
    let Some(mut pending) = layout.pending_runtime_reconfiguration.take() else {
        return Ok(());
    };
    match pending.recovery_stage {
        RuntimeReconfigurationRecoveryStage::CandidateActive => {
            pending.validate_candidate(&layout)?
        }
        RuntimeReconfigurationRecoveryStage::PreviousLayoutRestored => {
            pending.validate_previous_layout(&layout)?
        }
    }
    pending.record_recovery_error(error);
    layout.pending_runtime_reconfiguration = Some(pending);
    save_storage_bootstrap(&layout)
}

/// A nonempty value means a durable runtime recovery is incomplete. It is
/// surfaced to setup rather than silently treating either a candidate or a
/// restored layout as healthy.
pub(crate) fn runtime_reconfiguration_recovery_error() -> Result<Option<String>, String> {
    let Some(layout) = load_storage_bootstrap_checked()? else {
        return Ok(None);
    };
    Ok(layout
        .pending_runtime_reconfiguration
        .as_ref()
        .map(|pending| {
            pending.recovery_error().unwrap_or(
                "OpenClaw runtime recovery is incomplete; restore the previous runtime before setup can continue",
            )
            .to_string()
        }))
}

/// Commit the candidate layout only when it still identifies the exact
/// runtime that was originally staged. Mutable completion markers (service
/// rebind / package relocation) deliberately do not participate in this
/// identity check because they are expected to change during setup. Runtime
/// mode does participate: a Native dependency transaction must never commit
/// through Docker's derived configuration contract.
pub(crate) fn commit_runtime_reconfiguration(
) -> Result<Option<PendingRuntimeReconfiguration>, String> {
    let Some(mut layout) = load_storage_bootstrap_checked()? else {
        return Ok(None);
    };
    let Some(pending) = layout.pending_runtime_reconfiguration.take() else {
        return Ok(None);
    };
    pending.validate_candidate(&layout).map_err(|_| {
        "The active runtime locations changed while setup was running; refusing to commit an unrelated reconfiguration"
            .to_string()
    })?;
    save_storage_bootstrap(&layout)?;
    Ok(Some(pending))
}

// ── Node.js ────────────────────────────────────────────────────

/// Returns a user-selected portable Node.js root. Without an explicit
/// selection, JunQi uses the operating-system installation.
pub fn configured_node_runtime_dir() -> Option<PathBuf> {
    runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.node_runtime_dir)
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.node_runtime_dir))
}

pub(crate) fn normalize_node_runtime_root(path: PathBuf) -> PathBuf {
    if !path.is_file() {
        return path;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if name.eq_ignore_ascii_case("node.exe") || name.eq_ignore_ascii_case("node") {
        let parent = path.parent();
        if !cfg!(windows)
            && parent
                .and_then(Path::file_name)
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("bin"))
        {
            return parent
                .and_then(Path::parent)
                .map(Path::to_path_buf)
                .unwrap_or(path);
        }
        return parent.map(Path::to_path_buf).unwrap_or(path);
    }
    path
}

/// Resolve the Node.js executable that belongs to an explicit runtime root.
/// Storage validation and process launch both use this mapping so a candidate
/// portable runtime is never probed through an unrelated PATH installation.
pub(crate) fn node_binary_for_runtime_dir(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("node.exe")
    } else {
        root.join("bin").join("node")
    }
}

/// The explicit portable Node.js executable, if the user opted into one.
pub fn configured_node_path() -> Option<PathBuf> {
    configured_node_runtime_dir().map(|root| node_binary_for_runtime_dir(&root))
}

/// Return an npm cache override only when the user explicitly selected one.
/// Otherwise npm owns its platform-native cache path and can react to changes
/// in the user's own Node.js/npm configuration.
pub fn configured_npm_cache_dir() -> Option<PathBuf> {
    runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.npm_cache_dir)
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.npm_cache_dir))
}

pub fn configured_npm_prefix() -> Option<PathBuf> {
    runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.npm_prefix)
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.npm_prefix))
}

pub fn openclaw_relocation_required() -> bool {
    load_storage_bootstrap().is_some_and(|layout| layout.openclaw_relocation_required)
}

pub fn pending_gateway_service_rebind() -> Option<bool> {
    load_storage_bootstrap().and_then(|layout| {
        layout
            .gateway_service_rebind_required
            .then_some(layout.gateway_service_was_running)
    })
}

pub fn complete_gateway_service_rebind() -> Result<(), String> {
    let Some(mut layout) = load_storage_bootstrap() else {
        return Ok(());
    };
    layout.gateway_service_rebind_required = false;
    layout.gateway_service_was_running = false;
    save_storage_bootstrap(&layout)
}

pub fn complete_openclaw_relocation(expected_npm_prefix: Option<&Path>) -> Result<(), String> {
    let Some(mut layout) = load_storage_bootstrap() else {
        return Ok(());
    };
    if !layout.openclaw_relocation_required {
        return Ok(());
    }
    if !optional_paths_refer_to_same_location(layout.npm_prefix.as_deref(), expected_npm_prefix) {
        return Err(
            "The selected npm prefix changed while OpenClaw was being installed; retry migration for the current location"
                .into(),
        );
    }
    layout.openclaw_relocation_required = false;
    save_storage_bootstrap(&layout)
}

pub fn terminal_integration_requested() -> bool {
    load_storage_bootstrap()
        .map(|layout| layout.terminal_integration)
        .unwrap_or(false)
}

pub fn terminal_launcher_dir() -> PathBuf {
    app_config_dir().join("bin")
}

/// 返回全局 prefix 下的可执行 shim 目录：
/// Unix 是 `<prefix>/bin`，Windows 是 `<prefix>`，因为 npm 会把
/// `openclaw.cmd` 放在 `node_modules` 旁边。
pub fn npm_bin_dir_for_prefix(prefix: &Path) -> PathBuf {
    if cfg!(windows) {
        prefix.to_path_buf()
    } else {
        prefix.join("bin")
    }
}

/// 从 `~/.npmrc` 读取用户自己的 npm 全局 prefix。
///
/// 这样安装位置和用户在终端执行 `npm i -g openclaw` 完全一致：
/// 同一个 prefix、同一个可执行目录、同一个 `package.json`。
/// 用户之后也可以继续用自己的 npm 命令管理，不会被 JunQi 的平行安装覆盖。
///
/// 当 `~/.npmrc` 不存在、不可读或没有定义 `prefix` 时返回 `None`，
/// 调用方应查询 npm 的实际有效配置或要求用户明确选择前缀。
pub fn user_npm_prefix() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let npmrc = home.join(".npmrc");
    let content = std::fs::read_to_string(&npmrc).ok()?;
    user_npm_prefix_from_npmrc(&content, &home)
}

fn user_npm_prefix_from_npmrc(content: &str, home: &Path) -> Option<PathBuf> {
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some(value) = line
            .strip_prefix("prefix=")
            .or_else(|| line.strip_prefix("prefix ="))
        else {
            continue;
        };
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        if value.is_empty() {
            continue;
        }
        let value = value
            .replace("${HOME}", &home.to_string_lossy())
            .replace("$HOME", &home.to_string_lossy())
            .replace("%USERPROFILE%", &home.to_string_lossy())
            .replace("%HOME%", &home.to_string_lossy());
        let path = if value == "~" {
            home.to_path_buf()
        } else if value.starts_with("~/") || value.starts_with("~\\") {
            home.join(value[2..].trim_start_matches(['/', '\\']))
        } else {
            PathBuf::from(value)
        };
        return path.is_absolute().then_some(path);
    }
    None
}

/// 返回用户执行 `npm i -g` 时可执行 shim 会写入的目录：
/// Unix 是 `<prefix>/bin`，Windows 是 prefix 本身，因为
/// `openclaw.cmd` shim 就在 prefix 目录里。
pub fn user_npm_bin_dir() -> Option<PathBuf> {
    let prefix = user_npm_prefix()?;
    Some(npm_bin_dir_for_prefix(&prefix))
}

/// 保存安装/检测过程中选定的 OpenClaw 二进制。
/// 后续 Gateway 启动优先使用这个精确路径，避免在用户全局 npm、
/// 内置 wrapper、JunQi 管理安装之间漂移。
pub fn openclaw_binary_selection_path() -> PathBuf {
    load_storage_bootstrap()
        .map(|layout| layout.runtime_dir.join("openclaw-binary.json"))
        .unwrap_or_else(legacy_openclaw_binary_selection_path)
}

/// Selection files written before `runtime_dir` became an active storage
/// contract remain readable until the next successful installation persists
/// the selection in its configured runtime directory.
pub(crate) fn openclaw_binary_selection_read_paths() -> Vec<PathBuf> {
    let selected = openclaw_binary_selection_path();
    let legacy = legacy_openclaw_binary_selection_path();
    if selected == legacy {
        vec![selected]
    } else {
        vec![selected, legacy]
    }
}

fn legacy_openclaw_binary_selection_path() -> PathBuf {
    desktop_dir().join("runtime").join("openclaw-binary.json")
}

// ── Git ────────────────────────────────────────────────────────

/// Returns a user-selected portable Git root. This selection is supported on
/// Windows; macOS and Linux discover Git from the operating system and PATH.
pub fn configured_git_runtime_dir() -> Option<PathBuf> {
    runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.git_runtime_dir)
        .or_else(|| load_storage_bootstrap().and_then(|layout| layout.git_runtime_dir))
}

pub(crate) fn normalize_git_runtime_root(path: PathBuf) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if path.is_file() && (name.eq_ignore_ascii_case("git.exe") || name.eq_ignore_ascii_case("git"))
    {
        return path
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or(path);
    }
    if name.eq_ignore_ascii_case("cmd") && path.join("git.exe").is_file() {
        return path.parent().map(Path::to_path_buf).unwrap_or(path);
    }
    path
}

fn git_binary_in(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("cmd").join("git.exe")
    } else {
        root.join("bin").join("git")
    }
}

pub fn configured_git_path() -> Option<PathBuf> {
    configured_git_runtime_dir().map(|root| git_binary_in(&root))
}

// ── 工作区 ─────────────────────────────────────────────────────

/// 默认工作区目录；用户未配置工作区时使用。
pub fn default_workspace_dir() -> PathBuf {
    if runtime_location_overrides()
        .ok()
        .and_then(|overrides| overrides.state_dir)
        .is_some()
    {
        if let Ok(locations) = effective_runtime_locations() {
            return read_workspace_from_config(&locations.config_path)
                .unwrap_or_else(|| locations.state_dir.join("workspace"));
        }
    }
    load_storage_bootstrap()
        .map(|b| b.workspace_dir)
        .unwrap_or_else(|| desktop_dir().join("workspace"))
}

fn normalize_absolute_path(path: &Path) -> PathBuf {
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
}

fn resolve_openclaw_user_path_from(raw: &str, home: &Path, cwd: &Path) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("OpenClaw path cannot be empty".to_string());
    }

    let expanded = if trimmed == "~" {
        home.to_path_buf()
    } else if trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        home.join(trimmed[2..].trim_start_matches(['/', '\\']))
    } else {
        PathBuf::from(trimmed)
    };
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    };
    Ok(normalize_absolute_path(&absolute))
}

/// Match OpenClaw's `resolveUserPath`: trim, expand `~`, then resolve relative
/// paths from JunQi's stable managed cwd without requiring the path to exist.
pub fn resolve_openclaw_user_path(raw: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve the user home directory")?;
    let cwd = stable_openclaw_working_dir()
        .ok_or("Unable to resolve a stable OpenClaw working directory")?;
    resolve_openclaw_user_path_from(raw, &home, &cwd)
}

/// 从 openclaw.json 读取并解析用户配置的工作区路径。
/// 配置不存在、无效或未指定工作区时返回 None。
pub fn read_workspace_from_config(config_path: &std::path::Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config = crate::commands::config::parse_openclaw_config(&raw).ok()?;
    let workspace = config
        .get("agents")?
        .get("defaults")?
        .get("workspace")?
        .as_str()?;
    resolve_openclaw_user_path(workspace).ok()
}

/// Read a workspace path against the same stable cwd used by every managed
/// OpenClaw command. A GUI launch from `C:\` or another drive therefore cannot
/// make migration and runtime execution resolve the same relative value to
/// different directories.
pub fn read_workspace_from_config_relative_to(config_path: &std::path::Path) -> Option<PathBuf> {
    let raw = std::fs::read_to_string(config_path).ok()?;
    let config = crate::commands::config::parse_openclaw_config(&raw).ok()?;
    let workspace = config
        .get("agents")?
        .get("defaults")?
        .get("workspace")?
        .as_str()?;
    let home = dirs::home_dir()?;
    let cwd = stable_openclaw_working_dir()?;
    resolve_openclaw_user_path_from(workspace, &home, &cwd).ok()
}

// ── 设备 ───────────────────────────────────────────────────────

/// 返回保存配对状态的设备目录。
#[allow(dead_code)]
pub fn devices_dir() -> PathBuf {
    desktop_dir().join("devices")
}

#[cfg(test)]
mod storage_bootstrap_tests {
    use super::*;

    #[test]
    fn bug_st01_layout_keeps_bootstrap_outside_state_dir() {
        let state = legacy_default_state_dir();
        assert!(!storage_bootstrap_path().starts_with(&state));
    }

    #[test]
    fn bug_st01_layout_derives_config_and_workspace() {
        let state = PathBuf::from("/tmp/junqi-storage-test");
        let layout = StorageBootstrap::for_state_dir(state.clone(), None);
        assert_eq!(layout.config_path, state.join("openclaw.json"));
        assert_eq!(layout.workspace_dir, state.join("workspace"));
    }

    #[test]
    fn runtime_reconfiguration_memento_restores_the_complete_prior_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-runtime-reconfiguration-memento-{}",
            uuid::Uuid::new_v4()
        ));
        let previous = StorageBootstrap::with_locations(
            root.join("state"),
            root.join("workspace-old"),
            root.join("runtime-old"),
            Some(root.join("cache-old")),
            Some(root.join("prefix-old")),
            true,
        );
        let mut candidate = previous.clone();
        candidate.workspace_dir = root.join("workspace-new");
        candidate.runtime_dir = root.join("runtime-new");
        candidate.node_runtime_dir = Some(root.join("node-new"));
        candidate.git_runtime_dir = Some(root.join("git-new"));
        candidate.npm_prefix = Some(root.join("prefix-new"));
        candidate.openclaw_relocation_required = true;

        begin_runtime_reconfiguration(
            &previous,
            &mut candidate,
            PendingGatewayRecovery {
                selected_runtime: OpenClawRuntimeMode::Native,
                port: 18_789,
                selected_runtime_was_running: true,
                selected_service_installed: true,
                selected_service_was_running: false,
                native_service_launch: None,
            },
            true,
        )
        .unwrap();
        let pending = candidate.pending_runtime_reconfiguration.clone().unwrap();

        let restored = pending.previous_layout();
        assert_eq!(restored, previous);
        candidate.openclaw_relocation_required = false;
        candidate.gateway_service_rebind_required = false;
        assert!(pending.matches_candidate(&candidate));
        candidate.runtime_mode = OpenClawRuntimeMode::Docker;
        assert!(!pending.matches_candidate(&candidate));
        assert_eq!(pending.gateway_recovery().port, 18_789);
        assert!(pending.native_workspace_was_written());
    }

    #[test]
    fn runtime_reconfiguration_rejects_nested_mementos() {
        let root = std::env::temp_dir().join(format!(
            "junqi-runtime-reconfiguration-nested-{}",
            uuid::Uuid::new_v4()
        ));
        let previous = StorageBootstrap::for_state_dir(root.join("state"), None);
        let mut candidate = previous.clone();
        candidate.node_runtime_dir = Some(root.join("node"));
        let recovery = PendingGatewayRecovery {
            selected_runtime: OpenClawRuntimeMode::Native,
            port: 18_789,
            selected_runtime_was_running: false,
            selected_service_installed: false,
            selected_service_was_running: false,
            native_service_launch: None,
        };
        begin_runtime_reconfiguration(&previous, &mut candidate, recovery.clone(), false).unwrap();

        let mut nested = candidate.clone();
        nested.git_runtime_dir = Some(root.join("git"));
        assert!(begin_runtime_reconfiguration(&candidate, &mut nested, recovery, false).is_err());
    }

    #[test]
    fn runtime_reconfiguration_recovery_keeps_the_memento_until_service_restore_completes() {
        let root = std::env::temp_dir().join(format!(
            "junqi-runtime-reconfiguration-recovery-stage-{}",
            uuid::Uuid::new_v4()
        ));
        let previous = StorageBootstrap::for_state_dir(root.join("state"), None);
        let mut candidate = previous.clone();
        candidate.node_runtime_dir = Some(root.join("node"));
        begin_runtime_reconfiguration(
            &previous,
            &mut candidate,
            PendingGatewayRecovery {
                selected_runtime: OpenClawRuntimeMode::Native,
                port: 18_789,
                selected_runtime_was_running: true,
                selected_service_installed: true,
                selected_service_was_running: true,
                native_service_launch: None,
            },
            false,
        )
        .unwrap();

        let mut pending = candidate.pending_runtime_reconfiguration.clone().unwrap();
        assert!(pending.validate_candidate(&candidate).is_ok());
        assert!(!pending.previous_layout_is_restored());

        pending.mark_previous_layout_restored();
        pending.record_recovery_error("Scheduled Task restart failed".to_string());
        let mut restored = pending.previous_layout();
        restored.pending_runtime_reconfiguration = Some(pending.clone());

        assert!(pending.previous_layout_is_restored());
        assert_eq!(
            pending.recovery_error(),
            Some("Scheduled Task restart failed")
        );
        assert!(pending.validate_previous_layout(&restored).is_ok());
        assert!(pending.validate_candidate(&restored).is_err());
    }

    #[test]
    fn native_gateway_service_launch_contract_requires_one_complete_launch_form() {
        let root = std::env::temp_dir().join(format!(
            "junqi-native-gateway-launch-contract-{}",
            uuid::Uuid::new_v4()
        ));
        let node = root.join("node");
        let entry = root.join("openclaw.mjs");
        let executable = root.join("openclaw");
        let node_script = NativeGatewayServiceLaunchContract {
            node: Some(node.clone()),
            entry: Some(entry.clone()),
            executable: None,
            package_dir: Some(root.join("package")),
            npm_prefix: Some(root.join("prefix")),
        };
        assert!(node_script.is_valid());

        let ambiguous = NativeGatewayServiceLaunchContract {
            executable: Some(executable),
            ..node_script
        };
        assert!(!ambiguous.is_valid());
    }

    #[test]
    fn runtime_reconfiguration_identity_accepts_equivalent_path_representations() {
        let root = std::env::temp_dir().join(format!(
            "junqi-runtime-reconfiguration-identity-{}",
            uuid::Uuid::new_v4()
        ));
        let state = root.join("state");
        let workspace = root.join("workspace");
        let runtime = root.join("runtime");
        let cache = root.join("cache");
        let prefix = root.join("prefix");
        let node = root.join("node");
        let git = root.join("git");
        for path in [&state, &workspace, &runtime, &cache, &prefix, &node, &git] {
            std::fs::create_dir_all(path).unwrap();
        }
        std::fs::write(state.join("openclaw.json"), "{}").unwrap();

        let previous = StorageBootstrap::with_locations(
            state.clone(),
            workspace.clone(),
            runtime.clone(),
            Some(cache.clone()),
            Some(prefix.clone()),
            true,
        );
        let mut candidate = previous.clone();
        candidate.node_runtime_dir = Some(node.clone());
        candidate.git_runtime_dir = Some(git.clone());
        begin_runtime_reconfiguration(
            &previous,
            &mut candidate,
            PendingGatewayRecovery {
                selected_runtime: OpenClawRuntimeMode::Native,
                port: 18_789,
                selected_runtime_was_running: false,
                selected_service_installed: false,
                selected_service_was_running: false,
                native_service_launch: None,
            },
            false,
        )
        .unwrap();
        let pending = candidate.pending_runtime_reconfiguration.clone().unwrap();

        candidate.state_dir = state.join(".");
        candidate.config_path = state.join(".").join("openclaw.json");
        candidate.workspace_dir = workspace.join(".");
        candidate.runtime_dir = runtime.join(".");
        candidate.npm_cache_dir = Some(cache.join("."));
        candidate.npm_prefix = Some(prefix.join("."));
        candidate.node_runtime_dir = Some(node.join("."));
        candidate.git_runtime_dir = Some(git.join("."));

        assert!(pending.matches_candidate(&candidate));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn npmrc_prefix_parser_continues_past_unrelated_settings() {
        let home = std::env::temp_dir().join("junqi-npmrc-prefix-home");
        let expected = home.join("custom-npm-prefix");
        let content = format!(
            "registry=https://registry.npmmirror.com\nstrict-ssl=false\nprefix = {}\n",
            expected.display()
        );
        assert_eq!(user_npm_prefix_from_npmrc(&content, &home), Some(expected));
    }

    #[test]
    fn custom_dependency_runtime_dirs_are_explicit_and_survive_bootstrap_round_trip() {
        let root = std::env::temp_dir().join("junqi-runtime-selection-test");
        let state = root.join("state");
        let node = root.join("selected-node");
        let git = root.join("selected-git");
        let mut layout = StorageBootstrap::for_state_dir(state, None);
        layout.node_runtime_dir = Some(node.clone());
        layout.git_runtime_dir = Some(git.clone());
        layout.openclaw_relocation_required = true;

        let restored = StorageBootstrap::from_persisted(layout.to_persisted()).unwrap();
        assert_eq!(restored.node_runtime_dir, Some(node));
        assert_eq!(restored.git_runtime_dir, Some(git));
        assert!(restored.openclaw_relocation_required);
        assert_ne!(
            restored.node_runtime_dir,
            Some(restored.runtime_dir.join("node"))
        );
        assert_ne!(
            restored.git_runtime_dir,
            Some(restored.runtime_dir.join("git"))
        );
    }

    #[test]
    fn fresh_bootstrap_only_records_explicit_dependency_locations() {
        let state = std::env::temp_dir().join("junqi-system-runtime-default");
        let layout = StorageBootstrap::for_state_dir(state, None);

        assert_eq!(layout.node_runtime_dir, None);
        assert_eq!(layout.git_runtime_dir, None);
        assert_eq!(layout.npm_cache_dir, None);
    }

    #[test]
    fn persisted_runtime_children_of_openclaw_data_are_preserved_for_explicit_repair() {
        let state = std::env::temp_dir().join("junqi-stale-private-runtime");
        let raw = serde_json::json!({
            "version": 6,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace"),
            "runtime_dir": state.join("runtime"),
            "node_runtime_dir": state.join("node"),
            "git_runtime_dir": state.join("git")
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();

        assert_eq!(layout.node_runtime_dir, Some(state.join("node")));
        assert_eq!(layout.git_runtime_dir, Some(state.join("git")));
    }

    #[test]
    fn persisted_runtime_paths_overlapping_npm_locations_are_preserved_for_explicit_repair() {
        let root = std::env::temp_dir().join("junqi-stale-runtime-npm-overlap");
        let state = root.join("state");
        let cache = root.join("cache");
        let prefix = root.join("prefix");
        let raw = serde_json::json!({
            "version": 6,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace"),
            "runtime_dir": state.join("runtime"),
            "npm_cache_dir": cache,
            "npm_prefix": prefix,
            "node_runtime_dir": cache,
            "git_runtime_dir": prefix
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();

        assert_eq!(layout.node_runtime_dir, Some(cache));
        assert_eq!(layout.git_runtime_dir, Some(prefix));
    }

    #[test]
    fn bug_wrm_05_relocation_prefix_comparison_rejects_a_changed_selection() {
        let root = std::env::temp_dir().join("junqi-relocation-prefix-comparison");
        let first = root.join("first");
        let second = root.join("second");
        let nested = first.join("nested");
        std::fs::create_dir_all(&first).unwrap();

        assert!(optional_paths_refer_to_same_location(
            Some(&first),
            Some(&first.join("."))
        ));
        assert!(!optional_paths_refer_to_same_location(
            Some(&first),
            Some(&second)
        ));
        assert!(optional_paths_refer_to_same_location(None, None));
        assert!(!optional_paths_refer_to_same_location(Some(&first), None));
        assert!(paths_overlap(&first, &nested));
        assert!(!paths_overlap(&first, &second));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn bug_st06_bootstrap_replaces_an_existing_layout() {
        let root = std::env::temp_dir().join(format!(
            "junqi-bootstrap-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("bootstrap.json");
        let first = StorageBootstrap::for_state_dir(root.join("first"), None);
        let second = StorageBootstrap::for_state_dir(root.join("second"), None);

        write_storage_bootstrap(&path, &first).unwrap();
        write_storage_bootstrap(&path, &second).unwrap();

        let saved_record: PersistedStorageBootstrap =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let saved = StorageBootstrap::from_persisted(saved_record).unwrap();
        assert_eq!(saved, second);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn v1_bootstrap_moves_legacy_cache_marker_back_to_npm_default() {
        let state = std::env::temp_dir().join("junqi-v1-layout");
        let raw = serde_json::json!({
            "version": 1,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace")
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();
        assert_eq!(layout.runtime_dir, state);
        assert_eq!(layout.npm_cache_dir, None);
        assert_eq!(layout.npm_prefix, None);
        assert!(!layout.terminal_integration);
        assert_eq!(layout.runtime_mode, OpenClawRuntimeMode::Native);
    }

    #[test]
    fn fresh_bootstrap_does_not_persist_an_npm_cache_override() {
        let state = std::env::temp_dir().join("junqi-native-npm-cache-default");
        let layout = StorageBootstrap::for_state_dir(state, None);

        assert_eq!(layout.npm_cache_dir, None);
        assert_eq!(layout.to_persisted().npm_cache_dir, None);
    }

    #[test]
    fn v4_custom_npm_cache_survives_the_native_default_migration() {
        let state = std::env::temp_dir().join("junqi-v4-layout");
        let custom_cache = state.with_file_name("custom-npm-cache");
        let raw = serde_json::json!({
            "version": 4,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace"),
            "runtime_dir": state.join("runtime"),
            "npm_cache_dir": custom_cache
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();
        assert_eq!(layout.npm_cache_dir, Some(custom_cache));
    }

    #[test]
    fn v5_explicit_state_local_npm_cache_survives_v6_upgrade() {
        let state = std::env::temp_dir().join("junqi-v5-layout");
        let custom_cache = state.join("npm-cache");
        let raw = serde_json::json!({
            "version": 5,
            "state_dir": state,
            "config_path": state.join("openclaw.json"),
            "workspace_dir": state.join("workspace"),
            "runtime_dir": state.join("runtime"),
            "npm_cache_dir": custom_cache
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();

        assert_eq!(layout.npm_cache_dir, Some(custom_cache));
    }

    #[test]
    fn bug_rt01_runtime_selection_survives_bootstrap_round_trip() {
        let state = std::env::temp_dir().join("junqi-runtime-selection");
        let mut layout = StorageBootstrap::for_state_dir(state, None);
        layout.runtime_mode = OpenClawRuntimeMode::Docker;

        let restored = StorageBootstrap::from_persisted(layout.to_persisted()).unwrap();
        assert_eq!(restored.runtime_mode, OpenClawRuntimeMode::Docker);
        assert_eq!(
            restored.config_path,
            restored.state_dir.join("openclaw.json")
        );
        assert_eq!(
            config_path_for_runtime(&restored.state_dir, OpenClawRuntimeMode::Docker),
            restored.state_dir.join("docker").join("openclaw.json")
        );
    }

    #[test]
    fn bug_rt02_legacy_docker_config_path_migrates_to_native_bootstrap_path() {
        let state = std::env::temp_dir().join("junqi-legacy-docker-config");
        let raw = serde_json::json!({
            "version": 8,
            "state_dir": state,
            "config_path": state.join("docker").join("openclaw.json"),
            "workspace_dir": state.join("workspace"),
            "runtime_dir": state.join("runtime"),
            "runtime_mode": "docker"
        });
        let persisted: PersistedStorageBootstrap = serde_json::from_value(raw).unwrap();
        let layout = StorageBootstrap::from_persisted(persisted).unwrap();

        assert_eq!(layout.config_path, layout.state_dir.join("openclaw.json"));
        assert_eq!(
            config_path_for_runtime(&layout.state_dir, OpenClawRuntimeMode::Docker),
            layout.state_dir.join("docker").join("openclaw.json")
        );
    }

    #[test]
    fn bug_st06_failed_bootstrap_activation_removes_temporary_file() {
        let root = std::env::temp_dir().join(format!(
            "junqi-bootstrap-failure-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let path = root.join("bootstrap.json");
        std::fs::create_dir_all(&path).unwrap();
        let layout = StorageBootstrap::for_state_dir(root.join("state"), None);

        assert!(write_storage_bootstrap(&path, &layout).is_err());
        let entries = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();
        assert_eq!(entries, vec![std::ffi::OsString::from("bootstrap.json")]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn bug_st07_workspace_paths_match_openclaw_resolution() {
        let home = Path::new("/users/tester");
        let cwd = Path::new("/work/junqi");

        assert_eq!(
            resolve_openclaw_user_path_from(" ~/agents/main ", home, cwd).unwrap(),
            home.join("agents/main")
        );
        assert_eq!(
            resolve_openclaw_user_path_from("./workspace/../agent-data", home, cwd).unwrap(),
            cwd.join("agent-data")
        );
    }

    #[test]
    fn relative_workspace_uses_the_managed_openclaw_cwd_contract() {
        let root =
            std::env::temp_dir().join(format!("junqi-relative-workspace-{}", uuid::Uuid::new_v4()));
        let config = root.join("state").join("openclaw.json");
        std::fs::create_dir_all(config.parent().unwrap()).unwrap();
        std::fs::write(
            &config,
            r#"
            // OpenClaw accepts JSON5, including comments and trailing commas.
            {
              agents: {
                defaults: {
                  workspace: "workspace",
                },
              },
            }
            "#,
        )
        .unwrap();
        let cwd = stable_openclaw_working_dir().unwrap();

        assert_eq!(
            read_workspace_from_config_relative_to(&config),
            Some(cwd.join("workspace"))
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
