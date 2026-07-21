use crate::commands::docker::OPENCLAW_CONTAINER_NAME;
use crate::commands::openclaw_cli::{
    output_diagnostic, parse_json_with_warnings, run_openclaw_cli, OpenClawCliLimits,
    OpenClawCliOutput, PinnedOpenClawCliTarget,
};
use crate::commands::system;
use crate::state::collaboration_control::{
    validate_bootstrap_operation_id, BootstrapHealthSnapshot, BootstrapJournalStatus,
    BootstrapOperationKind, BootstrapPackageSnapshot, BootstrapPluginSnapshot,
    BootstrapTargetSnapshot, CollaborationBootstrapJournal, CollaborationControlState,
    BOOTSTRAP_JOURNAL_VERSION,
};
use crate::state::runtime_identity::{
    RuntimeDeploymentKind, RuntimeIdentity, RuntimeIdentityState, RuntimeInstallTarget,
    RuntimeOwnership, RuntimePersistence,
};
use crate::state::GatewayProcess;
use flate2::read::GzDecoder;
use flate2::{Compression, GzBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
#[cfg(unix)]
use std::ffi::{CString, OsStr};
use std::io::Read;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncRead, AsyncReadExt};

const PLUGIN_ID: &str = "junqi-collab";
const PLUGIN_PACKAGE_NAME: &str = "@junqi/openclaw-collaboration";
const MAX_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_CONFIG_BACKUP_BYTES: u64 = 8 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 4_096;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const BUNDLED_METADATA_RESOURCE: &str = "collaboration/metadata.json";
const BUNDLED_ARCHIVE_RESOURCE: &str = "collaboration/junqi-collab.tgz";
const BUNDLED_METADATA_JSON: &str = include_str!("../../resources/collaboration/metadata.json");
const MAX_ABANDONED_BOOTSTRAP_ARCHIVES: usize = 8;
const REQUIRED_COLLABORATION_FEATURES: [&str; 10] = [
    "SQLITE_AUTHORITY",
    "COMMAND_OUTBOX",
    "TASK_RECONCILE",
    "EXACT_TRANSCRIPT_DELIVERY",
    "EXACT_TRANSCRIPT_IDENTITY",
    "PLUGIN_SUBAGENT_TASK_LOOKUP",
    "PLUGIN_SUBAGENT_TASK_CANCEL",
    "EVENT_CURSOR",
    "SESSION_DELETE_CAS",
    "WRITE_INSTANCE_FENCE",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapTargetClass {
    NativeManaged,
    SystemService,
    Docker,
    ExternalLocal,
    ExternalRemote,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DurableCollaborationState {
    Absent,
    Present,
    Corrupt,
    Unknown,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapProbeParams {
    #[serde(default)]
    pub target_fingerprint: Option<String>,
    #[serde(default)]
    pub expected_connection_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapApplyParams {
    pub target_fingerprint: String,
    pub expected_connection_id: String,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BootstrapRecoveryStrategy {
    Resume,
    Rollback,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRecoverParams {
    pub target_fingerprint: String,
    pub expected_connection_id: String,
    pub strategy: BootstrapRecoveryStrategy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapAbandonParams {
    pub operation_id: String,
    pub orphan_target_fingerprint: String,
    pub current_target_fingerprint: String,
    pub expected_connection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapConfirmHealthParams {
    pub operation_id: String,
    pub target_fingerprint: String,
    pub expected_connection_id: String,
    pub collaboration_instance_id: String,
    pub plugin_version: String,
    pub schema_version: u32,
    pub durable_state: bool,
    #[serde(default)]
    pub durable_runtime: bool,
    #[serde(default)]
    pub durable_runtime_supported: bool,
    #[serde(default)]
    pub feature_evidence_kind: String,
    #[serde(default)]
    pub feature_evidence_behavior_verified: bool,
    #[serde(default)]
    pub feature_evidence_required_behavior_gate: String,
    #[serde(default)]
    pub feature_evidence_plugin_service_started: bool,
    #[serde(default)]
    pub feature_evidence_database_integrity: String,
    #[serde(default)]
    pub features: HashMap<String, bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapRestartParams {
    pub operation_id: String,
    pub target_fingerprint: String,
    pub expected_connection_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapConfigureParams {
    pub target_fingerprint: String,
    pub expected_connection_id: String,
    pub coordinator_agent_id: String,
    pub allowed_agent_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapProbe {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub target_fingerprint: Option<String>,
    pub connection_id: Option<String>,
    pub target_class: BootstrapTargetClass,
    pub deployment_kind: Option<String>,
    pub ownership: Option<String>,
    pub gateway_version: Option<String>,
    pub durable_runtime: bool,
    pub mutation_allowed: bool,
    pub manual_install_required: bool,
    pub binary_path: Option<String>,
    pub state_dir: Option<String>,
    pub config_path: Option<String>,
    pub plugin: BootstrapPluginSnapshot,
    pub warnings: Vec<String>,
    pub manual_install_instructions: Option<String>,
    pub busy: bool,
    pub recovery_required: bool,
    pub durable_collaboration_state: DurableCollaborationState,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapStatus {
    pub busy: bool,
    pub recovery_required: bool,
    pub recoverable: bool,
    pub target_fingerprint: Option<String>,
    pub journal: Option<CollaborationBootstrapJournal>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapResult {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub operation_id: Option<String>,
    pub target_fingerprint: Option<String>,
    pub action: Option<String>,
    pub plugin: Option<BootstrapPluginSnapshot>,
    pub restart_required: bool,
    pub health_pending: bool,
    pub recoverable: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapAbandonResult {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub operation_id: Option<String>,
    pub orphan_target_fingerprint: Option<String>,
    pub current_target_fingerprint: Option<String>,
    pub evidence_retained: bool,
    pub apply_unblocked: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapRestartResult {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub operation_id: Option<String>,
    pub target_fingerprint: Option<String>,
    pub previous_connection_id: Option<String>,
    pub target_class: BootstrapTargetClass,
    pub restart_requested: bool,
    pub reconnect_required: bool,
    pub health_pending: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollaborationBootstrapConfigureResult {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub target_fingerprint: Option<String>,
    pub connection_id: Option<String>,
    pub coordinator_agent_id: Option<String>,
    pub allowed_agent_ids: Vec<String>,
    pub configured_agent_ids: Vec<String>,
    pub coordinator_policy_updated: bool,
    pub reload_expected: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct VerifiedPackage {
    source_path: PathBuf,
    host_path: PathBuf,
    cli_path: PathBuf,
    sha256: String,
    plugin_version: String,
}

#[derive(Debug)]
struct ExactPluginBackup {
    cli_path: String,
    host_path: String,
    archive_sha256: String,
    content_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BundledPackageMetadata {
    format_version: u32,
    plugin_id: String,
    package_name: String,
    plugin_version: String,
    schema_version: u32,
    sha256: String,
    archive_file: String,
    resource_path: String,
}

#[derive(Debug)]
struct MutationTarget {
    identity: RuntimeIdentity,
    class: BootstrapTargetClass,
    cli: PinnedOpenClawCliTarget,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentRegistryEntry {
    id: String,
    list_index: usize,
    allow_agents: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct AgentRegistry {
    entries: HashMap<String, AgentRegistryEntry>,
    configured_ids: Vec<String>,
    default_allow_agents: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidatedAgentConfiguration {
    coordinator_agent_id: String,
    allowed_agent_ids: Vec<String>,
    configured_agent_ids: Vec<String>,
    coordinator_policy_path: Option<String>,
    coordinator_allow_agents_update: Option<Vec<String>>,
}

fn deployment_name(kind: RuntimeDeploymentKind) -> &'static str {
    match kind {
        RuntimeDeploymentKind::External => "external",
        RuntimeDeploymentKind::SystemService => "system_service",
        RuntimeDeploymentKind::ManagedChild => "managed_child",
        RuntimeDeploymentKind::Docker => "docker",
    }
}

fn ownership_name(ownership: RuntimeOwnership) -> &'static str {
    match ownership {
        RuntimeOwnership::JunqiManaged => "junqi_managed",
        RuntimeOwnership::UserManaged => "user_managed",
        RuntimeOwnership::Remote => "remote",
    }
}

fn target_class(identity: &RuntimeIdentity) -> BootstrapTargetClass {
    match (identity.deployment_kind, identity.ownership) {
        (RuntimeDeploymentKind::ManagedChild, RuntimeOwnership::JunqiManaged) => {
            BootstrapTargetClass::NativeManaged
        }
        (RuntimeDeploymentKind::SystemService, RuntimeOwnership::JunqiManaged) => {
            BootstrapTargetClass::SystemService
        }
        (RuntimeDeploymentKind::Docker, RuntimeOwnership::JunqiManaged) => {
            BootstrapTargetClass::Docker
        }
        (RuntimeDeploymentKind::External, RuntimeOwnership::Remote) => {
            BootstrapTargetClass::ExternalRemote
        }
        (RuntimeDeploymentKind::External, _) => BootstrapTargetClass::ExternalLocal,
        _ => BootstrapTargetClass::Unknown,
    }
}

fn is_durable(class: BootstrapTargetClass) -> bool {
    matches!(
        class,
        BootstrapTargetClass::SystemService
            | BootstrapTargetClass::Docker
            | BootstrapTargetClass::ExternalLocal
            | BootstrapTargetClass::ExternalRemote
    )
}

fn current_identity(state: &RuntimeIdentityState) -> Result<Option<RuntimeIdentity>, String> {
    state.current()
}

fn validate_fingerprint(identity: &RuntimeIdentity, expected: &str) -> Result<(), String> {
    if expected.trim().is_empty() {
        return Err("TARGET_FINGERPRINT_REQUIRED".to_string());
    }
    if identity.target_fingerprint != expected.trim() {
        return Err("TARGET_CHANGED".to_string());
    }
    Ok(())
}

fn validate_probe_identity(
    identity: &RuntimeIdentity,
    params: &BootstrapProbeParams,
) -> Result<(), (&'static str, &'static str)> {
    match (
        params.target_fingerprint.as_deref(),
        params.expected_connection_id.as_deref(),
    ) {
        (None, None) if identity.verified => Err((
            "PROBE_IDENTITY_INCOMPLETE",
            "A verified Gateway probe must include target fingerprint and expected connection id",
        )),
        (None, None) => Ok(()),
        (Some(fingerprint), Some(connection_id)) => {
            if fingerprint.trim().is_empty() || connection_id.trim().is_empty() {
                return Err((
                    "PROBE_IDENTITY_REQUIRED",
                    "Target fingerprint and connection id must both be non-empty",
                ));
            }
            if identity.target_fingerprint != fingerprint.trim() {
                return Err((
                    "TARGET_CHANGED",
                    "The active Gateway target changed; refresh before continuing",
                ));
            }
            if identity.connection_id != connection_id.trim() {
                return Err((
                    "CONNECTION_CHANGED",
                    "The active Gateway connection changed; refresh before continuing",
                ));
            }
            Ok(())
        }
        _ => Err((
            "PROBE_IDENTITY_INCOMPLETE",
            "Target fingerprint and expected connection id must be supplied together",
        )),
    }
}

fn same_probe_identity(left: &RuntimeIdentity, right: &RuntimeIdentity) -> bool {
    left.verified
        && right.verified
        && left.target_fingerprint == right.target_fingerprint
        && left.connection_id == right.connection_id
        && left.endpoint == right.endpoint
        && left.state_dir == right.state_dir
        && left.config_path == right.config_path
        && left.deployment_kind == right.deployment_kind
        && left.ownership == right.ownership
        && left.persistence == right.persistence
        && left.install_target == right.install_target
        && left.endpoint_attestation == right.endpoint_attestation
        && left.path_attestation == right.path_attestation
        && left.local_state_dir == right.local_state_dir
        && left.local_config_path == right.local_config_path
}

#[cfg(unix)]
fn inspect_durable_collaboration_state(local_state_dir: &Path) -> DurableCollaborationState {
    inspect_durable_collaboration_state_with_observers(local_state_dir, || {}, || {})
}

#[cfg(unix)]
fn inspect_durable_collaboration_state_with_observers<F, G>(
    local_state_dir: &Path,
    after_state_directory_opened: F,
    after_collaboration_directory_lookup: G,
) -> DurableCollaborationState
where
    F: FnOnce(),
    G: FnOnce(),
{
    if !local_state_dir.is_absolute() {
        return DurableCollaborationState::Unknown;
    }

    let state_directory = match DescriptorDirectory::open_absolute_for_probe(
        local_state_dir,
        "OpenClaw durable state directory",
    ) {
        Ok(directory) => directory,
        Err(error) => return error.durable_state_for_authority(),
    };
    after_state_directory_opened();

    let collaboration_directory = state_directory.open_child_directory_for_probe(
        OsStr::new(PLUGIN_ID),
        "collaboration durable state directory",
    );
    after_collaboration_directory_lookup();
    let collaboration_directory = match collaboration_directory {
        Ok(Some(directory)) => directory,
        Ok(None) => {
            let current_state_directory =
                match revalidate_durable_state_authority(local_state_dir, &state_directory) {
                    Ok(directory) => directory,
                    Err(state) => return state,
                };
            return match current_state_directory.open_child_directory_for_probe(
                OsStr::new(PLUGIN_ID),
                "collaboration durable state directory",
            ) {
                Ok(None) => DurableCollaborationState::Absent,
                Ok(Some(_)) => DurableCollaborationState::Unknown,
                Err(error) => error.durable_state_for_child(),
            };
        }
        Err(error) => return error.durable_state_for_child(),
    };

    let observed_state =
        match collaboration_directory.has_any_entry("collaboration durable state directory") {
            Ok(true) => DurableCollaborationState::Present,
            Ok(false) => DurableCollaborationState::Absent,
            Err(_) => return DurableCollaborationState::Unknown,
        };

    let current_state_directory =
        match revalidate_durable_state_authority(local_state_dir, &state_directory) {
            Ok(directory) => directory,
            Err(state) => return state,
        };
    let current_collaboration_directory = match current_state_directory
        .open_child_directory_for_probe(
            OsStr::new(PLUGIN_ID),
            "collaboration durable state directory",
        ) {
        Ok(Some(directory)) => directory,
        Ok(None) => return DurableCollaborationState::Unknown,
        Err(error) => return error.durable_state_for_child(),
    };
    match collaboration_directory.same_directory_identity(
        &current_collaboration_directory,
        "collaboration durable state directory",
    ) {
        Ok(true) => observed_state,
        Ok(false) | Err(_) => DurableCollaborationState::Unknown,
    }
}

#[cfg(unix)]
fn revalidate_durable_state_authority(
    local_state_dir: &Path,
    expected: &DescriptorDirectory,
) -> Result<DescriptorDirectory, DurableCollaborationState> {
    let current = DescriptorDirectory::open_absolute_for_probe(
        local_state_dir,
        "OpenClaw durable state directory",
    )
    .map_err(|error| error.durable_state_for_authority())?;
    match expected.same_directory_identity(&current, "OpenClaw durable state directory") {
        Ok(true) => Ok(current),
        Ok(false) | Err(_) => Err(DurableCollaborationState::Unknown),
    }
}

// Non-Unix targets retain the conservative path-level fallback until the platform
// exposes an equivalent reparse-point-safe, descriptor-relative directory API.
#[cfg(not(unix))]
fn inspect_durable_collaboration_state(local_state_dir: &Path) -> DurableCollaborationState {
    if !local_state_dir.is_absolute() {
        return DurableCollaborationState::Unknown;
    }
    match std::fs::symlink_metadata(local_state_dir) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => {}
        Ok(_) => return DurableCollaborationState::Corrupt,
        Err(_) => return DurableCollaborationState::Unknown,
    }
    let collaboration_dir = local_state_dir.join(PLUGIN_ID);
    let before = match std::fs::symlink_metadata(&collaboration_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return DurableCollaborationState::Absent;
        }
        Err(_) => return DurableCollaborationState::Unknown,
    };
    if before.file_type().is_symlink() || !before.is_dir() {
        return DurableCollaborationState::Corrupt;
    }

    let mut entries = match std::fs::read_dir(&collaboration_dir) {
        Ok(entries) => entries,
        Err(_) => return DurableCollaborationState::Unknown,
    };
    match entries.next() {
        Some(Ok(_)) => DurableCollaborationState::Present,
        Some(Err(_)) => DurableCollaborationState::Unknown,
        None => match std::fs::symlink_metadata(&collaboration_dir) {
            Ok(after) if !after.file_type().is_symlink() && after.is_dir() => {
                DurableCollaborationState::Absent
            }
            Ok(_) => DurableCollaborationState::Corrupt,
            Err(_) => DurableCollaborationState::Unknown,
        },
    }
}

async fn resolve_mutation_target(
    identity: RuntimeIdentity,
    expected_fingerprint: &str,
) -> Result<MutationTarget, (String, String)> {
    validate_fingerprint(&identity, expected_fingerprint).map_err(|code| {
        let message = if code == "TARGET_CHANGED" {
            "The active Gateway target changed; probe it again before installing the plugin"
        } else {
            "A target fingerprint is required"
        };
        (code, message.to_string())
    })?;
    let class = target_class(&identity);
    if matches!(
        class,
        BootstrapTargetClass::ExternalLocal | BootstrapTargetClass::ExternalRemote
    ) {
        return Err((
            "EXTERNAL_TARGET_READ_ONLY".to_string(),
            "JunQi will not mutate an external or remote OpenClaw runtime; install the pinned plugin on that runtime manually"
                .to_string(),
        ));
    }
    if class == BootstrapTargetClass::Unknown {
        return Err((
            "TARGET_UNSUPPORTED".to_string(),
            "The active Gateway deployment could not be classified safely".to_string(),
        ));
    }
    if !identity.verified || !identity.desktop_mutation_allowed {
        return Err((
            "TARGET_NOT_ATTESTED".to_string(),
            "The active Gateway identity or runtime paths are not attested for Desktop mutation"
                .to_string(),
        ));
    }
    if identity.ownership != RuntimeOwnership::JunqiManaged {
        return Err((
            "TARGET_NOT_OWNED".to_string(),
            "JunQi only installs plugins into runtimes it explicitly manages".to_string(),
        ));
    }

    let binary = system::resolve_openclaw_binary_async()
        .await
        .ok_or_else(|| {
            (
                "OPENCLAW_BINARY_MISSING".to_string(),
                "The selected OpenClaw executable is unavailable".to_string(),
            )
        })?;
    let cli = if class == BootstrapTargetClass::Docker {
        PinnedOpenClawCliTarget::verified_container(
            binary,
            Path::new(&identity.local_state_dir),
            Path::new(&identity.local_config_path),
            OPENCLAW_CONTAINER_NAME,
        )
    } else {
        PinnedOpenClawCliTarget::verified(
            binary,
            Path::new(&identity.local_state_dir),
            Path::new(&identity.local_config_path),
        )
    }
    .map_err(|message| ("OPENCLAW_BINARY_INVALID".to_string(), message))?;
    Ok(MutationTarget {
        identity,
        class,
        cli,
    })
}

fn mutation_error(
    code: impl Into<String>,
    message: impl Into<String>,
    target_fingerprint: Option<String>,
    operation_id: Option<String>,
    recoverable: bool,
) -> CollaborationBootstrapResult {
    CollaborationBootstrapResult {
        ok: false,
        code: code.into(),
        message: message.into(),
        operation_id,
        target_fingerprint,
        action: None,
        plugin: None,
        restart_required: false,
        health_pending: false,
        recoverable,
        warnings: Vec::new(),
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the constructor mirrors the stable restart response contract"
)]
fn restart_result(
    ok: bool,
    code: impl Into<String>,
    message: impl Into<String>,
    operation_id: Option<String>,
    target_fingerprint: Option<String>,
    previous_connection_id: Option<String>,
    target_class: BootstrapTargetClass,
    restart_requested: bool,
    health_pending: bool,
) -> CollaborationBootstrapRestartResult {
    CollaborationBootstrapRestartResult {
        ok,
        code: code.into(),
        message: message.into(),
        operation_id,
        target_fingerprint,
        previous_connection_id,
        target_class,
        restart_requested,
        reconnect_required: restart_requested,
        health_pending,
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "the constructor mirrors the stable bootstrap response contract"
)]
fn configuration_result(
    ok: bool,
    code: impl Into<String>,
    message: impl Into<String>,
    target_fingerprint: Option<String>,
    connection_id: Option<String>,
    configuration: Option<&ValidatedAgentConfiguration>,
    reload_expected: bool,
    warnings: Vec<String>,
) -> CollaborationBootstrapConfigureResult {
    CollaborationBootstrapConfigureResult {
        ok,
        code: code.into(),
        message: message.into(),
        target_fingerprint,
        connection_id,
        coordinator_agent_id: configuration.map(|value| value.coordinator_agent_id.clone()),
        allowed_agent_ids: configuration
            .map(|value| value.allowed_agent_ids.clone())
            .unwrap_or_default(),
        configured_agent_ids: configuration
            .map(|value| value.configured_agent_ids.clone())
            .unwrap_or_default(),
        coordinator_policy_updated: configuration
            .is_some_and(|value| value.coordinator_allow_agents_update.is_some()),
        reload_expected,
        warnings,
    }
}

fn validate_expected_connection(
    identity: &RuntimeIdentity,
    expected_connection_id: &str,
) -> Result<(), (String, String)> {
    let expected = expected_connection_id.trim();
    if expected.is_empty() {
        return Err((
            "CONNECTION_ID_REQUIRED".to_string(),
            "The current Gateway connection id is required".to_string(),
        ));
    }
    if identity.connection_id != expected {
        return Err((
            "CONNECTION_CHANGED".to_string(),
            "The active Gateway connection changed; refresh its identity before mutating it"
                .to_string(),
        ));
    }
    Ok(())
}

fn validate_durable_identity(
    identity: &RuntimeIdentity,
    class: BootstrapTargetClass,
) -> Result<(), (String, String)> {
    if !matches!(
        class,
        BootstrapTargetClass::SystemService | BootstrapTargetClass::Docker
    ) || !identity.verified
        || !identity.desktop_mutation_allowed
        || identity.ownership != RuntimeOwnership::JunqiManaged
        || identity.persistence != RuntimePersistence::DesktopIndependent
        || !identity.desktop_exit_continuity
        || !matches!(
            (class, identity.install_target),
            (
                BootstrapTargetClass::SystemService,
                RuntimeInstallTarget::NativeCli
            ) | (
                BootstrapTargetClass::Docker,
                RuntimeInstallTarget::DockerExec
            )
        )
    {
        return Err((
            "DURABLE_TARGET_REQUIRED".to_string(),
            "Collaboration mutations require an exact JunQi-owned System Service or Docker Gateway"
                .to_string(),
        ));
    }
    Ok(())
}

fn validate_durable_mutation_target(target: &MutationTarget) -> Result<(), (String, String)> {
    validate_durable_identity(&target.identity, target.class)
}

fn validate_current_operation_identity(
    expected: &RuntimeIdentity,
    current: Option<&RuntimeIdentity>,
) -> Result<(), (String, String)> {
    let Some(current) = current else {
        return Err((
            "RUNTIME_IDENTITY_UNAVAILABLE".to_string(),
            "The Gateway disconnected during collaboration mutation preflight".to_string(),
        ));
    };
    if !same_probe_identity(expected, current) {
        return Err((
            "TARGET_CHANGED".to_string(),
            "The verified Gateway target, connection, deployment, or local runtime paths changed during collaboration mutation preflight; no mutation was started"
                .to_string(),
        ));
    }
    Ok(())
}

fn normalize_agent_id(value: &str) -> String {
    let mut normalized = String::with_capacity(value.len());
    let mut previous_hyphen = false;
    for character in value.trim().to_ascii_lowercase().chars() {
        let accepted = character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '_' | '-');
        if accepted {
            normalized.push(character);
            previous_hyphen = character == '-';
        } else if !normalized.is_empty() && !previous_hyphen {
            normalized.push('-');
            previous_hyphen = true;
        }
    }
    normalized.trim_matches('-').to_string()
}

fn parse_allow_agents(
    container: Option<&Value>,
    label: &str,
) -> Result<Option<Vec<String>>, String> {
    let Some(container) = container else {
        return Ok(None);
    };
    let object = container
        .as_object()
        .ok_or_else(|| format!("{label} must be an object"))?;
    let Some(value) = object.get("allowAgents") else {
        return Ok(None);
    };
    let list = value
        .as_array()
        .ok_or_else(|| format!("{label}.allowAgents must be an array"))?;
    let mut result = Vec::with_capacity(list.len());
    for entry in list {
        let value = entry
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("{label}.allowAgents contains an invalid agent id"))?;
        result.push(value.to_string());
    }
    Ok(Some(result))
}

fn parse_agent_registry(value: &Value) -> Result<AgentRegistry, String> {
    let agents = value
        .as_object()
        .ok_or_else(|| "OpenClaw agents config must be an object".to_string())?;
    let defaults = agents
        .get("defaults")
        .and_then(Value::as_object)
        .and_then(|value| value.get("subagents"));
    let default_allow_agents = parse_allow_agents(defaults, "agents.defaults.subagents")?;
    let list = agents
        .get("list")
        .and_then(Value::as_array)
        .ok_or_else(|| "OpenClaw agents.list must be an explicit array".to_string())?;
    if list.is_empty() {
        return Err("OpenClaw agents.list must contain at least one configured agent".to_string());
    }

    let mut entries = HashMap::new();
    for (index, value) in list.iter().enumerate() {
        let object = value
            .as_object()
            .ok_or_else(|| format!("agents.list[{index}] must be an object"))?;
        let raw_id = object
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("agents.list[{index}].id is required"))?;
        let id = normalize_agent_id(raw_id);
        if id.is_empty() {
            return Err(format!("agents.list[{index}].id is invalid"));
        }
        let allow_agents = parse_allow_agents(
            object.get("subagents"),
            &format!("agents.list[{index}].subagents"),
        )?;
        if entries
            .insert(
                id.clone(),
                AgentRegistryEntry {
                    id: id.clone(),
                    list_index: index,
                    allow_agents,
                },
            )
            .is_some()
        {
            return Err(format!(
                "agents.list contains duplicate normalized agent id {id}"
            ));
        }
    }
    let mut configured_ids = entries.keys().cloned().collect::<Vec<_>>();
    configured_ids.sort();
    Ok(AgentRegistry {
        entries,
        configured_ids,
        default_allow_agents,
    })
}

fn normalize_requested_agent_ids(values: &[String]) -> Result<Vec<String>, (String, String)> {
    if values.is_empty() {
        return Err((
            "ALLOWED_AGENTS_REQUIRED".to_string(),
            "Select at least one explicit collaboration agent".to_string(),
        ));
    }
    if values.len() > 64 {
        return Err((
            "TOO_MANY_ALLOWED_AGENTS".to_string(),
            "At most 64 collaboration agents can be configured".to_string(),
        ));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        let trimmed = value.trim();
        if trimmed == "*" {
            return Err((
                "WILDCARD_AGENT_FORBIDDEN".to_string(),
                "Collaboration requires explicit allowed agent ids; wildcard authorization is forbidden"
                    .to_string(),
            ));
        }
        let id = normalize_agent_id(trimmed);
        if id.is_empty() || id.len() > 128 {
            return Err((
                "AGENT_ID_INVALID".to_string(),
                "Every allowed agent id must be a valid OpenClaw agent id".to_string(),
            ));
        }
        if !seen.insert(id.clone()) {
            return Err((
                "DUPLICATE_AGENT_ID".to_string(),
                format!("Agent {id} appears more than once after OpenClaw normalization"),
            ));
        }
        normalized.push(id);
    }
    Ok(normalized)
}

fn validate_agent_configuration(
    params: &BootstrapConfigureParams,
    registry: &AgentRegistry,
) -> Result<ValidatedAgentConfiguration, (String, String)> {
    let coordinator_agent_id = normalize_agent_id(&params.coordinator_agent_id);
    if coordinator_agent_id.is_empty() || coordinator_agent_id.len() > 128 {
        return Err((
            "COORDINATOR_AGENT_INVALID".to_string(),
            "A valid coordinator agent id is required".to_string(),
        ));
    }
    let Some(coordinator) = registry.entries.get(&coordinator_agent_id) else {
        return Err((
            "COORDINATOR_AGENT_NOT_CONFIGURED".to_string(),
            format!(
                "Coordinator agent {coordinator_agent_id} is not present in OpenClaw agents.list"
            ),
        ));
    };
    let allowed_agent_ids = normalize_requested_agent_ids(&params.allowed_agent_ids)?;
    if !allowed_agent_ids
        .iter()
        .any(|agent_id| agent_id == &coordinator_agent_id)
    {
        return Err((
            "COORDINATOR_NOT_ALLOWED".to_string(),
            "The coordinator must be included in the explicit plugin allowlist".to_string(),
        ));
    }
    let missing = allowed_agent_ids
        .iter()
        .filter(|agent_id| !registry.entries.contains_key(*agent_id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err((
            "ALLOWED_AGENT_NOT_CONFIGURED".to_string(),
            format!(
                "The following agents are not present in OpenClaw agents.list: {}",
                missing.join(", ")
            ),
        ));
    }

    let effective_policy = coordinator
        .allow_agents
        .as_ref()
        .or(registry.default_allow_agents.as_ref());
    let policy_allows_all =
        effective_policy.is_some_and(|entries| entries.iter().any(|entry| entry.trim() == "*"));
    let policy_ids = effective_policy
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry.trim() != "*")
                .map(|entry| normalize_agent_id(entry))
                .filter(|entry| registry.entries.contains_key(entry))
                .collect::<HashSet<_>>()
        })
        .unwrap_or_else(|| HashSet::from([coordinator.id.clone()]));
    let denied = allowed_agent_ids
        .iter()
        .filter(|agent_id| !policy_allows_all && !policy_ids.contains(*agent_id))
        .cloned()
        .collect::<Vec<_>>();
    let (coordinator_policy_path, coordinator_allow_agents_update) = if denied.is_empty() {
        (None, None)
    } else {
        // An entry-level policy overrides defaults. Seed it from the effective
        // policy so creating that override never narrows existing permissions.
        let mut expanded = effective_policy
            .cloned()
            .unwrap_or_else(|| vec![coordinator.id.clone()]);
        let mut expanded_ids = expanded
            .iter()
            .filter(|entry| entry.trim() != "*")
            .map(|entry| normalize_agent_id(entry))
            .collect::<HashSet<_>>();
        for agent_id in &allowed_agent_ids {
            if expanded_ids.insert(agent_id.clone()) {
                expanded.push(agent_id.clone());
            }
        }
        (
            Some(format!(
                "agents.list[{}].subagents.allowAgents",
                coordinator.list_index
            )),
            Some(expanded),
        )
    };
    Ok(ValidatedAgentConfiguration {
        coordinator_agent_id,
        allowed_agent_ids,
        configured_agent_ids: registry.configured_ids.clone(),
        coordinator_policy_path,
        coordinator_allow_agents_update,
    })
}

fn cli_limits(timeout_seconds: u64) -> OpenClawCliLimits {
    OpenClawCliLimits {
        timeout: Duration::from_secs(timeout_seconds),
        stdout_bytes: 2 * 1024 * 1024,
        stderr_bytes: 512 * 1024,
    }
}

fn sanitized_cli_warnings(warnings: Vec<String>, target: &PinnedOpenClawCliTarget) -> Vec<String> {
    warnings
        .into_iter()
        .map(|mut warning| {
            for path in [&target.binary, &target.state_dir, &target.config_path] {
                let value = path.to_string_lossy();
                if !value.is_empty() {
                    warning = warning.replace(value.as_ref(), "[path]");
                }
            }
            warning
        })
        .collect()
}

async fn read_agent_registry(
    target: &PinnedOpenClawCliTarget,
) -> Result<(AgentRegistry, Vec<String>), String> {
    let output = run_openclaw_cli(
        target,
        ["config", "get", "agents", "--json"],
        cli_limits(60),
    )
    .await?;
    if !output.status.success() {
        let diagnostic = output_diagnostic(
            &output,
            &[&target.binary, &target.state_dir, &target.config_path],
        );
        return Err(format!(
            "OpenClaw agents config read failed with exit code {}{}",
            output.status.code().unwrap_or(-1),
            if diagnostic.is_empty() {
                String::new()
            } else {
                format!(": {diagnostic}")
            }
        ));
    }
    let parsed = parse_json_with_warnings(&output.stdout)?;
    let registry = parse_agent_registry(&parsed.value)?;
    Ok((registry, sanitized_cli_warnings(parsed.warnings, target)))
}

fn collaboration_config_batch_json(
    configuration: &ValidatedAgentConfiguration,
) -> Result<String, String> {
    let mut operations = vec![
        serde_json::json!(
        {
            "path": "plugins.entries.junqi-collab.config.coordinatorAgentId",
            "value": configuration.coordinator_agent_id,
        }),
        serde_json::json!(
        {
            "path": "plugins.entries.junqi-collab.config.allowedAgentIds",
            "value": configuration.allowed_agent_ids,
        }),
    ];
    if let (Some(path), Some(allow_agents)) = (
        configuration.coordinator_policy_path.as_deref(),
        configuration.coordinator_allow_agents_update.as_ref(),
    ) {
        operations.push(serde_json::json!({
            "path": path,
            "value": allow_agents,
        }));
    }
    serde_json::to_string(&operations)
        .map_err(|error| format!("Failed to encode collaboration config batch: {error}"))
}

async fn run_config_batch(
    target: &PinnedOpenClawCliTarget,
    batch_json: &str,
    dry_run: bool,
) -> Result<(), String> {
    let mut args = vec![
        OsString::from("config"),
        OsString::from("set"),
        OsString::from("--batch-json"),
        OsString::from(batch_json),
    ];
    if dry_run {
        args.push(OsString::from("--dry-run"));
    }
    let output = run_openclaw_cli(target, args, cli_limits(90)).await?;
    if output.status.success() {
        return Ok(());
    }
    let diagnostic = output_diagnostic(
        &output,
        &[&target.binary, &target.state_dir, &target.config_path],
    );
    Err(format!(
        "OpenClaw config {} failed with exit code {}{}",
        if dry_run { "dry-run" } else { "write" },
        output.status.code().unwrap_or(-1),
        if diagnostic.is_empty() {
            String::new()
        } else {
            format!(": {diagnostic}")
        }
    ))
}

async fn verify_collaboration_config_readback(
    target: &PinnedOpenClawCliTarget,
    expected: &ValidatedAgentConfiguration,
) -> Result<Vec<String>, String> {
    let output = run_openclaw_cli(
        target,
        [
            "config",
            "get",
            "plugins.entries.junqi-collab.config",
            "--json",
        ],
        cli_limits(60),
    )
    .await?;
    if !output.status.success() {
        let diagnostic = output_diagnostic(
            &output,
            &[&target.binary, &target.state_dir, &target.config_path],
        );
        return Err(format!(
            "OpenClaw collaboration config readback failed with exit code {}{}",
            output.status.code().unwrap_or(-1),
            if diagnostic.is_empty() {
                String::new()
            } else {
                format!(": {diagnostic}")
            }
        ));
    }
    let parsed = parse_json_with_warnings(&output.stdout)?;
    let object = parsed
        .value
        .as_object()
        .ok_or_else(|| "OpenClaw collaboration config readback was not an object".to_string())?;
    let coordinator = object
        .get("coordinatorAgentId")
        .and_then(Value::as_str)
        .map(normalize_agent_id)
        .unwrap_or_default();
    let raw_allowed = object
        .get("allowedAgentIds")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            "OpenClaw collaboration config readback omitted allowedAgentIds".to_string()
        })?
        .iter()
        .map(|value| {
            value.as_str().map(ToOwned::to_owned).ok_or_else(|| {
                "OpenClaw collaboration config readback contains an invalid agent id".to_string()
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let allowed = normalize_requested_agent_ids(&raw_allowed)
        .map_err(|(_, message)| format!("Invalid collaboration config readback: {message}"))?;
    if coordinator != expected.coordinator_agent_id || allowed != expected.allowed_agent_ids {
        return Err(
            "OpenClaw collaboration config readback does not match the requested values"
                .to_string(),
        );
    }
    Ok(sanitized_cli_warnings(parsed.warnings, target))
}

fn validate_restart_journal(
    journal: &CollaborationBootstrapJournal,
    identity: &RuntimeIdentity,
    params: &BootstrapRestartParams,
    class: BootstrapTargetClass,
) -> Result<(), (String, String)> {
    let operation_id = params.operation_id.trim();
    if let Err(message) = validate_bootstrap_operation_id(operation_id) {
        return Err(("BOOTSTRAP_OPERATION_INVALID".to_string(), message));
    }
    validate_bootstrap_operation_id(&journal.operation_id).map_err(|message| {
        (
            "BOOTSTRAP_OPERATION_INVALID".to_string(),
            format!("The bootstrap journal operation id is invalid: {message}"),
        )
    })?;
    if journal.operation_id != operation_id
        || journal.target.target_fingerprint != identity.target_fingerprint
    {
        return Err((
            "BOOTSTRAP_OPERATION_MISMATCH".to_string(),
            "The restart request does not belong to this bootstrap operation and Gateway target"
                .to_string(),
        ));
    }
    if journal.target.deployment_kind != deployment_name(identity.deployment_kind)
        || journal.target.ownership != ownership_name(identity.ownership)
        || !matches!(
            class,
            BootstrapTargetClass::SystemService | BootstrapTargetClass::Docker
        )
    {
        return Err((
            "BOOTSTRAP_TARGET_MISMATCH".to_string(),
            "The journaled deployment no longer matches the verified durable Gateway target"
                .to_string(),
        ));
    }
    if !matches!(
        journal.status,
        BootstrapJournalStatus::Completed | BootstrapJournalStatus::RolledBack
    ) || !journal.restart_required
        || !journal.health_pending
    {
        return Err((
            "BOOTSTRAP_HEALTH_NOT_PENDING".to_string(),
            "A completed bootstrap operation with pending health validation is required"
                .to_string(),
        ));
    }
    if journal.steps.iter().any(|step| {
        step.name == "gateway_restart"
            && step.status == "requested"
            && step.diagnostic.as_deref() == Some(identity.connection_id.as_str())
    }) {
        return Err((
            "GATEWAY_RESTART_ALREADY_REQUESTED".to_string(),
            "A restart was already requested for this exact Gateway connection; wait for reconnection or recover explicitly"
                .to_string(),
        ));
    }
    Ok(())
}

async fn run_bounded_external_command(
    binary: &str,
    args: &[&str],
    timeout_seconds: u64,
) -> Result<OpenClawCliOutput, String> {
    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    crate::platform::configure_background_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to execute external command: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "External command stdout was not captured".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "External command stderr was not captured".to_string())?;
    let execution = tokio::time::timeout(Duration::from_secs(timeout_seconds), async {
        tokio::try_join!(
            async {
                child
                    .wait()
                    .await
                    .map_err(|error| format!("External command wait failed: {error}"))
            },
            read_bounded_external_output(stdout, 256 * 1024, "stdout"),
            read_bounded_external_output(stderr, 256 * 1024, "stderr"),
        )
    })
    .await;
    match execution {
        Ok(Ok((status, stdout, stderr))) => Ok(OpenClawCliOutput {
            status,
            stdout,
            stderr,
        }),
        Ok(Err(error)) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(error)
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(format!(
                "External command timed out after {timeout_seconds} seconds"
            ))
        }
    }
}

async fn read_bounded_external_output<R>(
    mut reader: R,
    limit: usize,
    stream: &str,
) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8_192];
    loop {
        let count = reader
            .read(&mut chunk)
            .await
            .map_err(|error| format!("External command {stream} read failed: {error}"))?;
        if count == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(count) > limit {
            return Err(format!(
                "External command {stream} exceeded the {limit} byte limit"
            ));
        }
        output.extend_from_slice(&chunk[..count]);
    }
}

async fn inspect_managed_docker_container(
    docker_binary: &str,
    reference: &str,
) -> Result<String, String> {
    let output = run_bounded_external_command(
        docker_binary,
        &[
            "inspect",
            "--format",
            "{{.Id}}|{{.State.Running}}",
            reference,
        ],
        30,
    )
    .await?;
    if !output.status.success() {
        return Err(format!(
            "Docker inspect failed with exit code {}: {}",
            output.status.code().unwrap_or(-1),
            output_diagnostic(&output, &[])
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let (container_id, running) = text
        .trim()
        .split_once('|')
        .ok_or_else(|| "Docker inspect returned an invalid target identity".to_string())?;
    let container_id = container_id.trim();
    if container_id.len() < 12
        || container_id.len() > 128
        || !container_id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || running.trim() != "true"
    {
        return Err("The exact JunQi Docker Gateway container is not running".to_string());
    }
    Ok(container_id.to_string())
}

async fn restart_docker_target() -> Result<(), (String, String)> {
    let docker_binary = crate::commands::docker::resolve_docker_bin()
        .await
        .map_err(|message| ("DOCKER_CLI_UNAVAILABLE".to_string(), message))?;
    restart_docker_target_with_binary(&docker_binary).await
}

async fn restart_docker_target_with_binary(docker_binary: &str) -> Result<(), (String, String)> {
    let container_id = inspect_managed_docker_container(docker_binary, OPENCLAW_CONTAINER_NAME)
        .await
        .map_err(|message| ("DOCKER_TARGET_NOT_RUNNING".to_string(), message))?;
    let output = run_bounded_external_command(
        docker_binary,
        &["restart", "--time", "30", &container_id],
        60,
    )
    .await
    .map_err(|message| {
        let code = if message.contains("timed out") {
            "GATEWAY_RESTART_UNCERTAIN"
        } else {
            "DOCKER_RESTART_FAILED"
        };
        (code.to_string(), message)
    })?;
    if !output.status.success() {
        return Err((
            "DOCKER_RESTART_FAILED".to_string(),
            format!(
                "Docker restart failed with exit code {}: {}",
                output.status.code().unwrap_or(-1),
                output_diagnostic(&output, &[])
            ),
        ));
    }
    let current_id = inspect_managed_docker_container(docker_binary, &container_id)
        .await
        .map_err(|message| ("DOCKER_RESTART_UNHEALTHY".to_string(), message))?;
    if current_id != container_id {
        return Err((
            "DOCKER_TARGET_CHANGED".to_string(),
            "The Docker Gateway container identity changed during restart".to_string(),
        ));
    }
    Ok(())
}

async fn restart_system_service_target(
    target: &PinnedOpenClawCliTarget,
) -> Result<(), (String, String)> {
    let output = run_openclaw_cli(target, ["gateway", "restart", "--json"], cli_limits(120))
        .await
        .map_err(|message| {
            let code = if message.contains("timed out") {
                "GATEWAY_RESTART_UNCERTAIN"
            } else {
                "GATEWAY_RESTART_FAILED"
            };
            (code.to_string(), message)
        })?;
    if !output.status.success() {
        return Err((
            "GATEWAY_RESTART_FAILED".to_string(),
            format!(
                "OpenClaw Gateway service restart failed with exit code {}: {}",
                output.status.code().unwrap_or(-1),
                output_diagnostic(
                    &output,
                    &[&target.binary, &target.state_dir, &target.config_path]
                )
            ),
        ));
    }
    Ok(())
}

fn extract_version(text: &str) -> Option<String> {
    text.split_whitespace().find_map(|token| {
        let candidate = token.trim_matches(|character: char| {
            !character.is_ascii_alphanumeric() && character != '.' && character != '-'
        });
        let dot_count = candidate.bytes().filter(|byte| *byte == b'.').count();
        (dot_count >= 2
            && candidate
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_digit()))
        .then(|| candidate.to_string())
    })
}

async fn attest_cli_version(
    target: &PinnedOpenClawCliTarget,
    expected_gateway_version: &str,
) -> Result<(), String> {
    let output = run_openclaw_cli(target, ["--version"], cli_limits(20)).await?;
    if !output.status.success() {
        return Err(format!(
            "The selected OpenClaw CLI version probe exited with code {}",
            output.status.code().unwrap_or(-1)
        ));
    }
    let actual = extract_version(&String::from_utf8_lossy(&output.stdout))
        .ok_or_else(|| "The selected OpenClaw CLI returned an invalid version".to_string())?;
    let expected = extract_version(expected_gateway_version)
        .unwrap_or_else(|| expected_gateway_version.trim().to_string());
    if actual != expected {
        return Err(format!(
            "The selected OpenClaw CLI version ({actual}) does not match the active Gateway ({expected})"
        ));
    }
    Ok(())
}

async fn inspect_plugin(
    target: &PinnedOpenClawCliTarget,
) -> Result<(BootstrapPluginSnapshot, Vec<String>), String> {
    let output = run_openclaw_cli(
        target,
        ["plugins", "inspect", PLUGIN_ID, "--json"],
        cli_limits(60),
    )
    .await?;
    if !output.status.success() {
        let diagnostic = output_diagnostic(
            &output,
            &[&target.binary, &target.state_dir, &target.config_path],
        );
        if diagnostic.to_ascii_lowercase().contains("plugin not found") {
            return Ok((BootstrapPluginSnapshot::default(), Vec::new()));
        }
        return Err(format!(
            "OpenClaw plugin inspection failed with exit code {}{}",
            output.status.code().unwrap_or(-1),
            if diagnostic.is_empty() {
                String::new()
            } else {
                format!(": {diagnostic}")
            }
        ));
    }
    let parsed = parse_json_with_warnings(&output.stdout)?;
    let plugin = parsed
        .value
        .get("plugin")
        .and_then(Value::as_object)
        .ok_or_else(|| "OpenClaw plugin inspection omitted the plugin object".to_string())?;
    let id = plugin.get("id").and_then(Value::as_str).unwrap_or_default();
    if id != PLUGIN_ID {
        return Err("OpenClaw plugin inspection returned a different plugin id".to_string());
    }
    let snapshot = BootstrapPluginSnapshot {
        installed: true,
        enabled: plugin
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        status: plugin
            .get("status")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        version: plugin
            .get("version")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        source: plugin
            .get("source")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        root_dir: plugin
            .get("rootDir")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        install_record: parsed.value.get("install").cloned(),
    };
    let warnings = parsed
        .warnings
        .into_iter()
        .map(|warning| {
            let mut sanitized = warning;
            for path in [&target.binary, &target.state_dir, &target.config_path] {
                let value = path.to_string_lossy();
                if !value.is_empty() {
                    sanitized = sanitized.replace(value.as_ref(), "[path]");
                }
            }
            sanitized
        })
        .collect();
    Ok((snapshot, warnings))
}

fn validate_archive_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("PLUGIN_ARCHIVE_PATH_MUST_BE_ABSOLUTE".to_string());
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("PLUGIN_ARCHIVE_UNAVAILABLE: {error}"))?;
    let metadata = std::fs::metadata(&canonical)
        .map_err(|error| format!("PLUGIN_ARCHIVE_UNAVAILABLE: {error}"))?;
    if !metadata.is_file() {
        return Err("PLUGIN_ARCHIVE_NOT_FILE".to_string());
    }
    if metadata.len() == 0 || metadata.len() > MAX_PACKAGE_BYTES {
        return Err("PLUGIN_ARCHIVE_SIZE_INVALID".to_string());
    }
    if canonical
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| !extension.eq_ignore_ascii_case("tgz"))
        .unwrap_or(true)
    {
        return Err("PLUGIN_ARCHIVE_MUST_BE_TGZ".to_string());
    }
    Ok(canonical)
}

fn hash_file(path: &Path, limit: u64) -> Result<String, String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() > limit {
        return Err(format!("File exceeds the {limit} byte limit"));
    }
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn parse_archive_metadata(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open plugin archive: {error}"))?;
    let decoder = GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    let mut package_json: Option<Value> = None;
    let mut plugin_json: Option<Value> = None;
    let mut entries_seen = 0usize;
    let mut expanded_bytes = 0_u64;
    let entries = archive
        .entries()
        .map_err(|error| format!("Invalid plugin archive: {error}"))?;
    for entry in entries {
        entries_seen += 1;
        if entries_seen > MAX_ARCHIVE_ENTRIES {
            return Err("Plugin archive contains too many entries".to_string());
        }
        let mut entry = entry.map_err(|error| format!("Invalid plugin archive entry: {error}"))?;
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .ok_or_else(|| "Plugin archive expanded size overflowed".to_string())?;
        if expanded_bytes > MAX_ARCHIVE_EXPANDED_BYTES {
            return Err("Plugin archive exceeds the expanded size limit".to_string());
        }
        let entry_path = entry
            .path()
            .map_err(|error| format!("Invalid plugin archive path: {error}"))?
            .into_owned();
        if entry_path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            return Err("Plugin archive contains an unsafe path".to_string());
        }
        let normalized = entry_path.to_string_lossy().replace('\\', "/");
        if normalized != "package/package.json" && normalized != "package/openclaw.plugin.json" {
            continue;
        }
        if entry.size() > MAX_MANIFEST_BYTES {
            return Err("Plugin manifest exceeds the size limit".to_string());
        }
        let mut raw = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut raw)
            .map_err(|error| format!("Failed to read plugin manifest: {error}"))?;
        let value: Value = serde_json::from_slice(&raw)
            .map_err(|error| format!("Invalid plugin manifest JSON: {error}"))?;
        if normalized == "package/package.json" {
            package_json = Some(value);
        } else {
            plugin_json = Some(value);
        }
    }

    let package =
        package_json.ok_or_else(|| "Plugin archive is missing package.json".to_string())?;
    let manifest =
        plugin_json.ok_or_else(|| "Plugin archive is missing openclaw.plugin.json".to_string())?;
    if package.get("name").and_then(Value::as_str) != Some(PLUGIN_PACKAGE_NAME) {
        return Err("Plugin archive contains an unexpected npm package".to_string());
    }
    if manifest.get("id").and_then(Value::as_str) != Some(PLUGIN_ID) {
        return Err("Plugin archive contains an unexpected OpenClaw plugin id".to_string());
    }
    let package_version = package
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| "Plugin package version is missing".to_string())?;
    let manifest_version = manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| "OpenClaw plugin version is missing".to_string())?;
    if package_version != manifest_version {
        return Err("Plugin package and manifest versions do not match".to_string());
    }
    let extensions_valid = package
        .get("openclaw")
        .and_then(|openclaw| openclaw.get("extensions"))
        .and_then(Value::as_array)
        .map(|extensions| {
            extensions
                .iter()
                .any(|entry| entry.as_str() == Some("./dist/index.js"))
        })
        .unwrap_or(false);
    if !extensions_valid {
        return Err("Plugin archive does not declare the expected OpenClaw entry".to_string());
    }
    Ok(package_version.to_string())
}

fn validate_bundled_metadata(
    metadata: BundledPackageMetadata,
) -> Result<BundledPackageMetadata, String> {
    if metadata.format_version != 1
        || metadata.plugin_id != PLUGIN_ID
        || metadata.package_name != PLUGIN_PACKAGE_NAME
        || metadata.archive_file != "junqi-collab.tgz"
        || metadata.resource_path != BUNDLED_ARCHIVE_RESOURCE
        || metadata.schema_version == 0
        || metadata.plugin_version.trim().is_empty()
        || metadata.plugin_version.len() > 128
        || metadata.sha256.len() != 64
        || !metadata
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("The collaboration bundle metadata is invalid".to_string());
    }
    Ok(metadata)
}

fn parse_bundled_metadata(raw: &[u8]) -> Result<BundledPackageMetadata, String> {
    if raw.is_empty() || raw.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("The collaboration bundle metadata exceeds its size limit".to_string());
    }
    let metadata = serde_json::from_slice(raw)
        .map_err(|error| format!("Invalid collaboration bundle metadata: {error}"))?;
    validate_bundled_metadata(metadata)
}

fn verify_package_path(
    path: &Path,
    expected_sha256: &str,
) -> Result<VerifiedPackage, (String, String)> {
    let expected = expected_sha256.trim().to_ascii_lowercase();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err((
            "PLUGIN_SHA256_INVALID".to_string(),
            "The expected plugin SHA-256 must contain exactly 64 hexadecimal characters"
                .to_string(),
        ));
    }
    let path = validate_archive_path(path).map_err(|message| {
        (
            message
                .split(':')
                .next()
                .unwrap_or("PLUGIN_ARCHIVE_INVALID")
                .to_string(),
            message,
        )
    })?;
    let actual = hash_file(&path, MAX_PACKAGE_BYTES).map_err(|message| {
        (
            "PLUGIN_ARCHIVE_HASH_FAILED".to_string(),
            format!("Could not hash the plugin archive: {message}"),
        )
    })?;
    if actual != expected {
        return Err((
            "PLUGIN_SHA256_MISMATCH".to_string(),
            "The selected plugin archive does not match the pinned SHA-256".to_string(),
        ));
    }
    let plugin_version = parse_archive_metadata(&path)
        .map_err(|message| ("PLUGIN_ARCHIVE_INVALID".to_string(), message))?;
    Ok(VerifiedPackage {
        source_path: path.clone(),
        host_path: path.clone(),
        cli_path: path,
        sha256: actual,
        plugin_version,
    })
}

fn verify_bundled_package_paths(
    metadata_path: &Path,
    archive_path: &Path,
) -> Result<VerifiedPackage, (String, String)> {
    let compiled_metadata =
        parse_bundled_metadata(BUNDLED_METADATA_JSON.as_bytes()).map_err(|message| {
            (
                "PLUGIN_BUNDLE_EMBEDDED_METADATA_INVALID".to_string(),
                message,
            )
        })?;
    let raw = std::fs::read(metadata_path).map_err(|error| {
        (
            "PLUGIN_BUNDLE_METADATA_UNAVAILABLE".to_string(),
            format!("Could not read the bundled collaboration metadata: {error}"),
        )
    })?;
    let resource_metadata = parse_bundled_metadata(&raw)
        .map_err(|message| ("PLUGIN_BUNDLE_METADATA_INVALID".to_string(), message))?;
    if resource_metadata != compiled_metadata {
        return Err((
            "PLUGIN_BUNDLE_METADATA_MISMATCH".to_string(),
            "The installed collaboration bundle metadata does not match this JunQi binary"
                .to_string(),
        ));
    }
    let package = verify_package_path(archive_path, &compiled_metadata.sha256)?;
    if package.plugin_version != compiled_metadata.plugin_version {
        return Err((
            "PLUGIN_BUNDLE_VERSION_MISMATCH".to_string(),
            "The bundled collaboration archive version does not match its embedded metadata"
                .to_string(),
        ));
    }
    Ok(package)
}

fn verify_bundled_package(app: &AppHandle) -> Result<VerifiedPackage, (String, String)> {
    let metadata_path = app
        .path()
        .resolve(BUNDLED_METADATA_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| {
            (
                "PLUGIN_BUNDLE_RESOURCE_UNAVAILABLE".to_string(),
                format!("Could not resolve the bundled collaboration metadata: {error}"),
            )
        })?;
    let archive_path = app
        .path()
        .resolve(BUNDLED_ARCHIVE_RESOURCE, BaseDirectory::Resource)
        .map_err(|error| {
            (
                "PLUGIN_BUNDLE_RESOURCE_UNAVAILABLE".to_string(),
                format!("Could not resolve the bundled collaboration archive: {error}"),
            )
        })?;
    verify_bundled_package_paths(&metadata_path, &archive_path)
}

#[cfg(not(unix))]
fn secure_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Bootstrap artifact path cannot be a symbolic link".to_string());
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err("Bootstrap artifact path is not a directory".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to inspect bootstrap artifact directory: {error}"
            ));
        }
    }
    std::fs::create_dir_all(path)
        .map_err(|error| format!("Failed to create bootstrap artifact directory: {error}"))?;
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Failed to recheck bootstrap artifact directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(
            "Bootstrap artifact path changed to a non-directory or symbolic link".to_string(),
        );
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("Failed to secure bootstrap artifact directory: {error}"))?;
    }
    Ok(())
}

#[cfg(unix)]
#[derive(Debug)]
struct DescriptorDirectory {
    file: std::fs::File,
    display_path: PathBuf,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DescriptorDirectoryIdentity {
    device: u64,
    inode: u64,
}

#[cfg(unix)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DescriptorProbeFailureKind {
    Missing,
    UnsafeBoundary,
    Unavailable,
}

#[cfg(unix)]
#[derive(Debug)]
struct DescriptorProbeFailure {
    kind: DescriptorProbeFailureKind,
    message: String,
}

#[cfg(unix)]
impl DescriptorProbeFailure {
    fn unsafe_boundary(message: impl Into<String>) -> Self {
        Self {
            kind: DescriptorProbeFailureKind::UnsafeBoundary,
            message: message.into(),
        }
    }

    fn from_io(error: std::io::Error, context: impl Into<String>) -> Self {
        let kind = if error.kind() == std::io::ErrorKind::NotFound {
            DescriptorProbeFailureKind::Missing
        } else if error.kind() == std::io::ErrorKind::InvalidInput
            || matches!(
                error.raw_os_error(),
                Some(code) if code == libc::ELOOP || code == libc::ENOTDIR
            )
        {
            DescriptorProbeFailureKind::UnsafeBoundary
        } else {
            DescriptorProbeFailureKind::Unavailable
        };
        Self {
            kind,
            message: format!("{}: {error}", context.into()),
        }
    }

    fn durable_state_for_authority(&self) -> DurableCollaborationState {
        match self.kind {
            DescriptorProbeFailureKind::UnsafeBoundary => DurableCollaborationState::Corrupt,
            DescriptorProbeFailureKind::Missing | DescriptorProbeFailureKind::Unavailable => {
                DurableCollaborationState::Unknown
            }
        }
    }

    fn durable_state_for_child(&self) -> DurableCollaborationState {
        match self.kind {
            DescriptorProbeFailureKind::Missing => DurableCollaborationState::Absent,
            DescriptorProbeFailureKind::UnsafeBoundary => DurableCollaborationState::Corrupt,
            DescriptorProbeFailureKind::Unavailable => DurableCollaborationState::Unknown,
        }
    }
}

#[cfg(unix)]
fn descriptor_traversal_path(path: &Path, label: &str) -> Result<PathBuf, DescriptorProbeFailure> {
    if !path.is_absolute() {
        return Err(DescriptorProbeFailure::unsafe_boundary(format!(
            "{label} must be an absolute directory"
        )));
    }

    // macOS exposes a few system roots (notably /var and /tmp) as symlinks into
    // /private. Resolve only that OS-owned prefix; every application-controlled
    // component remains subject to descriptor-relative O_NOFOLLOW traversal.
    let mut traversal_path = path.to_path_buf();
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        if let Some(Component::Normal(first)) = path
            .components()
            .find(|component| !matches!(component, Component::RootDir | Component::CurDir))
        {
            let first_path = Path::new("/").join(first);
            if let Ok(metadata) = std::fs::symlink_metadata(&first_path) {
                if metadata.file_type().is_symlink() {
                    let canonical_first = std::fs::canonicalize(&first_path).map_err(|error| {
                        DescriptorProbeFailure::from_io(
                            error,
                            format!(
                                "Failed to resolve the operating-system path prefix for {label}"
                            ),
                        )
                    })?;
                    if canonical_first.parent() != Some(Path::new("/private")) {
                        return Err(DescriptorProbeFailure::unsafe_boundary(format!(
                            "{label} contains an application-controlled symbolic-link root"
                        )));
                    }
                    let mut components = path.components();
                    let _ = components.next();
                    let _ = components.next();
                    traversal_path = canonical_first;
                    for component in components {
                        traversal_path.push(component.as_os_str());
                    }
                }
            }
        }
    }
    Ok(traversal_path)
}

#[cfg(unix)]
fn descriptor_component(name: &OsStr, label: &str) -> Result<CString, String> {
    let mut components = Path::new(name).components();
    if !matches!(components.next(), Some(Component::Normal(component)) if component == name)
        || components.next().is_some()
    {
        return Err(format!("{label} contains an unsafe path component"));
    }
    CString::new(name.as_bytes()).map_err(|_| format!("{label} contains a NUL byte"))
}

#[cfg(unix)]
fn openat_file(
    directory: &std::fs::File,
    name: &OsStr,
    flags: libc::c_int,
    mode: libc::mode_t,
    label: &str,
) -> Result<std::fs::File, std::io::Error> {
    let name = descriptor_component(name, label)
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::InvalidInput, message))?;
    // SAFETY: directory is a live directory descriptor, name is a single NUL-terminated
    // component, and a successful descriptor is immediately owned by File.
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            flags,
            mode as libc::c_uint,
        )
    };
    if descriptor < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: openat returned a new descriptor owned by this call.
    Ok(unsafe { std::fs::File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
impl DescriptorDirectory {
    fn identity(&self, label: &str) -> Result<DescriptorDirectoryIdentity, String> {
        let metadata = self
            .file
            .metadata()
            .map_err(|error| format!("Failed to inspect {label} identity: {error}"))?;
        Ok(DescriptorDirectoryIdentity {
            device: metadata.dev(),
            inode: metadata.ino(),
        })
    }

    fn same_directory_identity(&self, other: &Self, label: &str) -> Result<bool, String> {
        Ok(self.identity(label)? == other.identity(label)?)
    }

    fn open_absolute(path: &Path, create: bool, mode: u32, label: &str) -> Result<Self, String> {
        let traversal_path =
            descriptor_traversal_path(path, label).map_err(|error| error.message)?;
        let mut directory = std::fs::File::open("/")
            .map_err(|error| format!("Failed to open the filesystem root for {label}: {error}"))?;
        let mut display_path = PathBuf::from("/");
        for component in traversal_path.components() {
            let Component::Normal(name) = component else {
                if component == Component::RootDir {
                    continue;
                }
                return Err(format!("{label} contains an unsafe directory component"));
            };
            let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
            let next = match openat_file(&directory, name, flags, 0, label) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
                    let name_c = descriptor_component(name, label)?;
                    // SAFETY: directory and component are validated above. mkdirat does not
                    // follow the final component and is followed by an O_NOFOLLOW open.
                    let created = unsafe {
                        libc::mkdirat(directory.as_raw_fd(), name_c.as_ptr(), mode as libc::mode_t)
                    };
                    if created < 0 {
                        let create_error = std::io::Error::last_os_error();
                        if create_error.kind() != std::io::ErrorKind::AlreadyExists {
                            return Err(format!("Failed to create {label}: {create_error}"));
                        }
                    }
                    openat_file(&directory, name, flags, 0, label).map_err(|error| {
                        format!("Failed to securely open newly created {label}: {error}")
                    })?
                }
                Err(error) => {
                    return Err(format!(
                        "Failed to securely open {label} component {:?}; it may be missing, non-directory, or symbolic link: {error}",
                        name.to_string_lossy()
                    ));
                }
            };
            directory = next;
            display_path.push(name);
        }
        Ok(Self {
            file: directory,
            display_path,
        })
    }

    fn open_absolute_for_probe(path: &Path, label: &str) -> Result<Self, DescriptorProbeFailure> {
        let traversal_path = descriptor_traversal_path(path, label)?;
        let mut directory = std::fs::File::open("/").map_err(|error| {
            DescriptorProbeFailure::from_io(
                error,
                format!("Failed to open the filesystem root for {label}"),
            )
        })?;
        let mut display_path = PathBuf::from("/");
        for component in traversal_path.components() {
            let Component::Normal(name) = component else {
                if component == Component::RootDir {
                    continue;
                }
                return Err(DescriptorProbeFailure::unsafe_boundary(format!(
                    "{label} contains an unsafe directory component"
                )));
            };
            let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
            directory = openat_file(&directory, name, flags, 0, label).map_err(|error| {
                DescriptorProbeFailure::from_io(
                    error,
                    format!(
                        "Failed to securely open {label} component {:?}",
                        name.to_string_lossy()
                    ),
                )
            })?;
            display_path.push(name);
        }
        Ok(Self {
            file: directory,
            display_path,
        })
    }

    fn open_child_directory(&self, name: &OsStr, label: &str) -> Result<Option<Self>, String> {
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        match openat_file(&self.file, name, flags, 0, label) {
            Ok(file) => Ok(Some(Self {
                file,
                display_path: self.display_path.join(name),
            })),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!(
                "Failed to securely open {label}; it may be non-directory or symbolic link: {error}"
            )),
        }
    }

    fn open_child_directory_for_probe(
        &self,
        name: &OsStr,
        label: &str,
    ) -> Result<Option<Self>, DescriptorProbeFailure> {
        let flags = libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        match openat_file(&self.file, name, flags, 0, label) {
            Ok(file) => Ok(Some(Self {
                file,
                display_path: self.display_path.join(name),
            })),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(DescriptorProbeFailure::from_io(
                error,
                format!("Failed to securely open {label}"),
            )),
        }
    }

    fn ensure_child_directory(&self, name: &OsStr, mode: u32, label: &str) -> Result<Self, String> {
        let name_c = descriptor_component(name, label)?;
        // SAFETY: the parent descriptor and single component are valid; an existing entry is
        // opened and validated with O_NOFOLLOW below.
        let created =
            unsafe { libc::mkdirat(self.file.as_raw_fd(), name_c.as_ptr(), mode as libc::mode_t) };
        if created < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(format!("Failed to create {label}: {error}"));
            }
        }
        let child = self
            .open_child_directory(name, label)?
            .ok_or_else(|| format!("{label} disappeared after creation"))?;
        // SAFETY: child.file is a live directory descriptor owned by this process.
        if unsafe { libc::fchmod(child.file.as_raw_fd(), mode as libc::mode_t) } < 0 {
            return Err(format!(
                "Failed to secure {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(child)
    }

    fn create_child_directory_new(
        &self,
        name: &OsStr,
        mode: u32,
        label: &str,
    ) -> Result<Self, String> {
        let name_c = descriptor_component(name, label)?;
        // SAFETY: parent and component are valid. mkdirat provides create-new semantics.
        if unsafe { libc::mkdirat(self.file.as_raw_fd(), name_c.as_ptr(), mode as libc::mode_t) }
            < 0
        {
            return Err(format!(
                "Failed to create {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        self.open_child_directory(name, label)?
            .ok_or_else(|| format!("{label} disappeared after creation"))
    }

    fn open_regular_file(&self, name: &OsStr, label: &str) -> Result<std::fs::File, String> {
        let flags = libc::O_RDONLY | libc::O_NONBLOCK | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        let file = openat_file(&self.file, name, flags, 0, label)
            .map_err(|error| format!("Failed to securely open {label}: {error}"))?;
        let metadata = file
            .metadata()
            .map_err(|error| format!("Failed to inspect {label}: {error}"))?;
        if !metadata.file_type().is_file() {
            return Err(format!("{label} is not a regular file"));
        }
        Ok(file)
    }

    fn create_regular_file(
        &self,
        name: &OsStr,
        mode: u32,
        label: &str,
    ) -> Result<std::fs::File, String> {
        let flags =
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC;
        openat_file(&self.file, name, flags, mode as libc::mode_t, label)
            .map_err(|error| format!("Failed to create {label}: {error}"))
    }

    fn unlink_file_if_present(&self, name: &OsStr, label: &str) -> Result<(), String> {
        let name = descriptor_component(name, label)?;
        // SAFETY: the directory and component are valid. unlinkat without AT_REMOVEDIR never
        // follows a symbolic link and cannot remove outside this pinned directory.
        if unsafe { libc::unlinkat(self.file.as_raw_fd(), name.as_ptr(), 0) } < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Failed to remove {label}: {error}"));
            }
        }
        Ok(())
    }

    fn unlink_child_directory_if_present(&self, name: &OsStr, label: &str) -> Result<(), String> {
        let name = descriptor_component(name, label)?;
        // SAFETY: the directory and component are valid. AT_REMOVEDIR removes only a directory
        // entry immediately beneath this pinned descriptor.
        if unsafe { libc::unlinkat(self.file.as_raw_fd(), name.as_ptr(), libc::AT_REMOVEDIR) } < 0 {
            let error = std::io::Error::last_os_error();
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Failed to remove {label}: {error}"));
            }
        }
        Ok(())
    }

    fn rename_child_noreplace(
        &self,
        source: &OsStr,
        destination: &OsStr,
        label: &str,
    ) -> Result<(), String> {
        let source = descriptor_component(source, label)?;
        let destination = descriptor_component(destination, label)?;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        // SAFETY: both names are validated single components beneath the same live directory.
        let result = unsafe {
            libc::renameatx_np(
                self.file.as_raw_fd(),
                source.as_ptr(),
                self.file.as_raw_fd(),
                destination.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        // SAFETY: renameat2 receives two live directory descriptors and validated components.
        let result = unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                self.file.as_raw_fd(),
                source.as_ptr(),
                self.file.as_raw_fd(),
                destination.as_ptr(),
                libc::RENAME_NOREPLACE,
            ) as libc::c_int
        };
        #[cfg(not(any(
            target_os = "macos",
            target_os = "ios",
            target_os = "linux",
            target_os = "android"
        )))]
        let result = -1;
        #[cfg(not(any(
            target_os = "macos",
            target_os = "ios",
            target_os = "linux",
            target_os = "android"
        )))]
        let unsupported = true;
        #[cfg(any(
            target_os = "macos",
            target_os = "ios",
            target_os = "linux",
            target_os = "android"
        ))]
        let unsupported = false;
        if unsupported {
            return Err(format!(
                "Failed to commit {label}: no atomic no-replace rename is available on this Unix platform"
            ));
        }
        if result < 0 {
            return Err(format!(
                "Failed to commit {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    #[allow(deprecated)]
    fn has_any_entry(&self, label: &str) -> Result<bool, String> {
        let descriptor = self
            .file
            .try_clone()
            .map_err(|error| format!("Failed to duplicate {label}: {error}"))?
            .into_raw_fd();
        // SAFETY: descriptor is a newly duplicated directory FD. fdopendir assumes ownership.
        let stream = unsafe { libc::fdopendir(descriptor) };
        if stream.is_null() {
            // SAFETY: fdopendir failed and therefore did not consume descriptor.
            unsafe { libc::close(descriptor) };
            return Err(format!(
                "Failed to enumerate {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let result = (|| {
            loop {
                let mut entry = std::mem::MaybeUninit::<libc::dirent>::zeroed();
                let mut current: *mut libc::dirent = std::ptr::null_mut();
                // SAFETY: stream is live, entry has sufficient libc::dirent storage, and current
                // is an out-pointer as required by readdir_r.
                let code = unsafe { libc::readdir_r(stream, entry.as_mut_ptr(), &mut current) };
                if code != 0 {
                    return Err(format!(
                        "Failed to enumerate {label}: {}",
                        std::io::Error::from_raw_os_error(code)
                    ));
                }
                if current.is_null() {
                    return Ok(false);
                }
                // SAFETY: readdir_r returned a populated dirent with a NUL-terminated d_name.
                let name =
                    unsafe { std::ffi::CStr::from_ptr((*current).d_name.as_ptr()).to_bytes() };
                if name != b"." && name != b".." {
                    return Ok(true);
                }
            }
        })();
        // SAFETY: stream was returned by fdopendir and has not been closed yet.
        let close_result = unsafe { libc::closedir(stream) };
        if close_result < 0 && result.is_ok() {
            return Err(format!(
                "Failed to close {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        result
    }

    #[allow(deprecated)]
    fn visible_entry_count(&self, label: &str) -> Result<usize, String> {
        let descriptor = self
            .file
            .try_clone()
            .map_err(|error| format!("Failed to duplicate {label}: {error}"))?
            .into_raw_fd();
        // SAFETY: descriptor is a newly duplicated directory FD. fdopendir assumes ownership.
        let stream = unsafe { libc::fdopendir(descriptor) };
        if stream.is_null() {
            // SAFETY: fdopendir failed and therefore did not consume descriptor.
            unsafe { libc::close(descriptor) };
            return Err(format!(
                "Failed to enumerate {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        let result = (|| {
            let mut count = 0usize;
            loop {
                let mut entry = std::mem::MaybeUninit::<libc::dirent>::zeroed();
                let mut current: *mut libc::dirent = std::ptr::null_mut();
                // SAFETY: stream is live, entry has sufficient libc::dirent storage, and current
                // is an out-pointer as required by readdir_r.
                let code = unsafe { libc::readdir_r(stream, entry.as_mut_ptr(), &mut current) };
                if code != 0 {
                    return Err(format!(
                        "Failed to enumerate {label}: {}",
                        std::io::Error::from_raw_os_error(code)
                    ));
                }
                if current.is_null() {
                    break;
                }
                // SAFETY: readdir_r returned a populated dirent with a NUL-terminated d_name.
                let name = unsafe {
                    std::ffi::CStr::from_ptr((*current).d_name.as_ptr())
                        .to_bytes()
                        .to_vec()
                };
                if name == b"." || name == b".." || name.first() == Some(&b'.') {
                    continue;
                }
                count = count
                    .checked_add(1)
                    .ok_or_else(|| format!("{label} entry count overflowed"))?;
            }
            Ok(count)
        })();
        // SAFETY: stream was returned by fdopendir and has not been closed yet.
        let close_result = unsafe { libc::closedir(stream) };
        if close_result < 0 && result.is_ok() {
            return Err(format!(
                "Failed to close {label}: {}",
                std::io::Error::last_os_error()
            ));
        }
        result
    }

    fn sync(&self, label: &str) -> Result<(), String> {
        self.file
            .sync_all()
            .map_err(|error| format!("Failed to sync {label}: {error}"))
    }
}

#[cfg(unix)]
fn open_absolute_regular_file(path: &Path, label: &str) -> Result<std::fs::File, String> {
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute path"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("{label} has no parent directory"))?;
    let name = path
        .file_name()
        .ok_or_else(|| format!("{label} has no file name"))?;
    DescriptorDirectory::open_absolute(parent, false, 0, label)?.open_regular_file(name, label)
}

// Transitional path-level boundary for bootstrap artifacts. It rejects known
// symlink/non-directory components and canonical escapes; descriptor-relative
// no-follow operations are still required to close concurrent swap races.
fn apply_directory_mode(path: &Path, mode: u32, label: &str) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
            .map_err(|error| format!("Failed to secure {label}: {error}"))?;
    }
    #[cfg(not(unix))]
    let _ = (path, mode, label);
    Ok(())
}

fn canonical_directory_anchor(
    path: &Path,
    create: bool,
    create_mode: u32,
    label: &str,
) -> Result<Option<PathBuf>, String> {
    if !path.is_absolute() {
        return Err(format!("{label} must be an absolute directory"));
    }
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!("{label} cannot be a symbolic link"));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(format!("{label} is not a directory"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut missing = Vec::new();
            let mut cursor = path;
            let existing = loop {
                match std::fs::symlink_metadata(cursor) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err(format!("{label} parent cannot be a symbolic link"));
                    }
                    Ok(metadata) if !metadata.is_dir() => {
                        return Err(format!("{label} parent is not a directory"));
                    }
                    Ok(_) => break cursor,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        let component = cursor.file_name().ok_or_else(|| {
                            format!("{label} contains an invalid directory component")
                        })?;
                        missing.push(component.to_os_string());
                        cursor = cursor
                            .parent()
                            .ok_or_else(|| format!("{label} has no existing directory ancestor"))?;
                    }
                    Err(error) => return Err(format!("Failed to inspect {label}: {error}")),
                }
            };
            let mut canonical = std::fs::canonicalize(existing)
                .map_err(|error| format!("Failed to resolve {label} ancestor: {error}"))?;
            for component in missing.iter().rev() {
                let component = component
                    .to_str()
                    .ok_or_else(|| format!("{label} contains a non-UTF-8 directory component"))?;
                canonical = ensure_directory_component(&canonical, component, create_mode, label)?;
            }
            return Ok(Some(canonical));
        }
        Err(error) => return Err(format!("Failed to inspect {label}: {error}")),
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Failed to resolve {label}: {error}"))?;
    let metadata = std::fs::symlink_metadata(&canonical)
        .map_err(|error| format!("Failed to verify {label}: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{label} did not resolve to a safe directory"));
    }
    Ok(Some(canonical))
}

fn ensure_directory_component(
    parent: &Path,
    component: &str,
    mode: u32,
    label: &str,
) -> Result<PathBuf, String> {
    let candidate = parent.join(component);
    match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(format!("{label} cannot be a symbolic link"));
        }
        Ok(metadata) if !metadata.is_dir() => {
            return Err(format!("{label} is not a directory"));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::create_dir(&candidate) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => return Err(format!("Failed to create {label}: {error}")),
            }
        }
        Err(error) => return Err(format!("Failed to inspect {label}: {error}")),
    }
    let metadata = std::fs::symlink_metadata(&candidate)
        .map_err(|error| format!("Failed to recheck {label}: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!(
            "{label} changed to a non-directory or symbolic link"
        ));
    }
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|error| format!("Failed to resolve {label}: {error}"))?;
    if canonical.parent() != Some(parent) {
        return Err(format!("{label} escaped its canonical parent"));
    }
    apply_directory_mode(&canonical, mode, label)?;
    Ok(canonical)
}

fn existing_directory_component(
    parent: &Path,
    component: &str,
    label: &str,
) -> Result<Option<PathBuf>, String> {
    let candidate = parent.join(component);
    let metadata = match std::fs::symlink_metadata(&candidate) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to inspect {label}: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(format!("{label} is not a safe directory"));
    }
    let canonical = std::fs::canonicalize(&candidate)
        .map_err(|error| format!("Failed to resolve {label}: {error}"))?;
    if canonical.parent() != Some(parent) {
        return Err(format!("{label} escaped its canonical parent"));
    }
    Ok(Some(canonical))
}

fn private_operation_dir_if_present(
    control: &CollaborationControlState,
    operation_id: &str,
) -> Result<Option<PathBuf>, String> {
    validate_bootstrap_operation_id(operation_id)?;
    let journal_parent = control
        .journal_path()
        .parent()
        .ok_or_else(|| "Invalid bootstrap journal directory".to_string())?;
    let Some(journal_parent) =
        canonical_directory_anchor(journal_parent, false, 0o700, "bootstrap journal directory")?
    else {
        return Ok(None);
    };
    let Some(backup_root) = existing_directory_component(
        &journal_parent,
        "collaboration-bootstrap-backups",
        "bootstrap backup root",
    )?
    else {
        return Ok(None);
    };
    existing_directory_component(&backup_root, operation_id, "bootstrap operation directory")
}

fn private_operation_dir(
    control: &CollaborationControlState,
    operation_id: &str,
) -> Result<PathBuf, String> {
    validate_bootstrap_operation_id(operation_id)?;
    let journal_parent = control
        .journal_path()
        .parent()
        .ok_or_else(|| "Invalid bootstrap journal directory".to_string())?;
    let journal_parent =
        canonical_directory_anchor(journal_parent, true, 0o700, "bootstrap journal directory")?
            .ok_or_else(|| "Bootstrap journal directory is unavailable".to_string())?;
    let backup_root = ensure_directory_component(
        &journal_parent,
        "collaboration-bootstrap-backups",
        0o700,
        "bootstrap backup root",
    )?;
    ensure_directory_component(
        &backup_root,
        operation_id,
        0o700,
        "bootstrap operation directory",
    )
}

fn copy_archive_verified(source: &Path, destination: &Path, expected: &str) -> Result<(), String> {
    let mut input = std::fs::File::open(source)
        .map_err(|error| format!("Failed to open the plugin archive for staging: {error}"))?;
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(destination)
        .map_err(|error| format!("Failed to create the staged plugin archive: {error}"))?;
    let result = (|| {
        use std::io::Write;
        let mut total = 0_u64;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|error| format!("Failed to read the plugin archive: {error}"))?;
            if count == 0 {
                break;
            }
            total = total
                .checked_add(count as u64)
                .ok_or_else(|| "Plugin archive size overflowed during staging".to_string())?;
            if total > MAX_PACKAGE_BYTES {
                return Err(
                    "Plugin archive changed or exceeded the size limit during staging".to_string(),
                );
            }
            hasher.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Failed to stage the plugin archive: {error}"))?;
        }
        output
            .sync_all()
            .map_err(|error| format!("Failed to persist the staged plugin archive: {error}"))?;
        let actual = format!("{:x}", hasher.finalize());
        if actual != expected {
            return Err("Plugin archive changed after verification".to_string());
        }
        parse_archive_metadata(destination)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o444))
                .map_err(|error| format!("Failed to protect the staged plugin archive: {error}"))?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(destination);
    }
    result
}

fn stage_package(
    control: &CollaborationControlState,
    target: &MutationTarget,
    operation_id: &str,
    package: VerifiedPackage,
) -> Result<VerifiedPackage, String> {
    let file_name = format!("junqi-collab-{}.tgz", package.plugin_version);
    let (host_dir, cli_dir) = target_artifact_dirs(control, target, operation_id)?;
    let host_path = host_dir.join(&file_name);
    copy_archive_verified(&package.source_path, &host_path, &package.sha256)?;
    Ok(VerifiedPackage {
        source_path: package.source_path,
        host_path,
        cli_path: cli_dir.join(file_name),
        sha256: package.sha256,
        plugin_version: package.plugin_version,
    })
}

fn target_artifact_dirs(
    control: &CollaborationControlState,
    target: &MutationTarget,
    operation_id: &str,
) -> Result<(PathBuf, PathBuf), String> {
    validate_bootstrap_operation_id(operation_id)?;
    let (host_dir, cli_dir) = if target.class == BootstrapTargetClass::Docker {
        let relative = PathBuf::from(".junqi-bootstrap").join(operation_id);
        let state_root = canonical_directory_anchor(
            &target.cli.state_dir,
            true,
            0o755,
            "Docker OpenClaw state directory",
        )?
        .ok_or_else(|| "Docker OpenClaw state directory is unavailable".to_string())?;
        let staging_root = ensure_directory_component(
            &state_root,
            ".junqi-bootstrap",
            0o755,
            "Docker bootstrap staging root",
        )?;
        (
            ensure_directory_component(
                &staging_root,
                operation_id,
                0o755,
                "Docker bootstrap operation directory",
            )?,
            PathBuf::from("/home/node/.openclaw").join(relative),
        )
    } else {
        let directory = private_operation_dir(control, operation_id)?;
        (directory.clone(), directory)
    };
    Ok((host_dir, cli_dir))
}

fn cleanup_preflight_artifacts(
    control: &CollaborationControlState,
    target: &MutationTarget,
    operation_id: &str,
) -> Result<(), String> {
    validate_bootstrap_operation_id(operation_id)?;
    let private = private_operation_dir_if_present(control, operation_id)?;
    let docker = if target.class == BootstrapTargetClass::Docker {
        let state_root = canonical_directory_anchor(
            &target.cli.state_dir,
            false,
            0o755,
            "Docker OpenClaw state directory",
        )?;
        match state_root {
            Some(state_root) => {
                let Some(staging_root) = existing_directory_component(
                    &state_root,
                    ".junqi-bootstrap",
                    "Docker bootstrap staging root",
                )?
                else {
                    return remove_preflight_artifact_directories(private, None);
                };
                existing_directory_component(
                    &staging_root,
                    operation_id,
                    "Docker bootstrap operation directory",
                )?
            }
            None => None,
        }
    } else {
        None
    };
    remove_preflight_artifact_directories(private, docker)
}

fn remove_preflight_artifact_directories(
    private: Option<PathBuf>,
    docker: Option<PathBuf>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for (path, label) in [
        (private, "private bootstrap artifacts"),
        (docker, "Docker bootstrap artifacts"),
    ] {
        let Some(path) = path else {
            continue;
        };
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                errors.push(format!("Failed to recheck {label}: {error}"));
                continue;
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            errors.push(format!("{label} changed to an unsafe directory"));
            continue;
        }
        if let Err(error) = std::fs::remove_dir_all(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                errors.push(format!("Failed to remove {label}: {error}"));
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn message_with_preflight_cleanup(
    control: &CollaborationControlState,
    target: &MutationTarget,
    operation_id: &str,
    message: impl Into<String>,
) -> String {
    let message = message.into();
    match cleanup_preflight_artifacts(control, target, operation_id) {
        Ok(()) => message,
        Err(cleanup_error) => format!(
            "{message}; some bootstrap artifacts may be retained because safe cleanup failed: {cleanup_error}"
        ),
    }
}

fn config_hash(path: &Path) -> Result<String, String> {
    if !path.exists() {
        return Ok("missing".to_string());
    }
    hash_file(path, MAX_CONFIG_BACKUP_BYTES)
        .map_err(|error| format!("Failed to hash the target OpenClaw config: {error}"))
}

fn is_valid_config_hash(value: &str) -> bool {
    value == "missing" || is_valid_sha256(value)
}

fn is_valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn verify_bootstrap_owned_config(
    journal: &CollaborationBootstrapJournal,
    config_path: &Path,
) -> Result<(), String> {
    let expected = journal
        .bootstrap_owned_config_sha256
        .as_deref()
        .ok_or_else(|| {
            "This bootstrap journal predates config ownership fencing; refusing to overwrite the OpenClaw config"
                .to_string()
        })?;
    if !is_valid_config_hash(expected) {
        return Err(
            "The bootstrap journal contains an invalid owned-config hash; refusing rollback"
                .to_string(),
        );
    }
    let actual = config_hash(config_path)?;
    if actual != expected {
        return Err(format!(
            "The OpenClaw config changed outside this bootstrap operation (expected {expected}, got {actual}); refusing to overwrite it"
        ));
    }
    Ok(())
}

fn persist_bootstrap_owned_config_hash(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    config_path: &Path,
) -> Result<String, String> {
    match config_hash(config_path) {
        Ok(hash) if is_valid_config_hash(&hash) => {
            journal.bootstrap_owned_config_sha256 = Some(hash.clone());
            control.save_journal(journal)?;
            Ok(hash)
        }
        Ok(_) => {
            let message = "The current OpenClaw config produced an invalid hash".to_string();
            journal.bootstrap_owned_config_sha256 = None;
            journal.add_diagnostic(message.clone());
            control.save_journal(journal)?;
            Err(message)
        }
        Err(message) => {
            journal.bootstrap_owned_config_sha256 = None;
            journal.add_diagnostic(format!(
                "Config ownership became unknown after a bootstrap mutation: {message}"
            ));
            control.save_journal(journal)?;
            Err(message)
        }
    }
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let parent = path
            .parent()
            .ok_or_else(|| "The OpenClaw config path has no parent directory".to_string())?;
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("Failed to sync the OpenClaw config directory: {error}"))?;
    }
    Ok(())
}

fn read_verified_config_backup(
    journal: &CollaborationBootstrapJournal,
) -> Result<Option<Vec<u8>>, String> {
    if journal.original_config_sha256 == "missing" {
        if journal.original_config_backup_path.is_some() {
            return Err(
                "The bootstrap journal has a backup for a config that was recorded as missing"
                    .to_string(),
            );
        }
        return Ok(None);
    }
    let expected = journal.original_config_sha256.as_str();
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("The bootstrap journal contains an invalid config hash".to_string());
    }
    let path = journal
        .original_config_backup_path
        .as_deref()
        .ok_or_else(|| "The pre-bootstrap OpenClaw config backup is missing".to_string())?;
    let path = Path::new(path);
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        format!("The pre-bootstrap OpenClaw config backup is unavailable: {error}")
    })?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_CONFIG_BACKUP_BYTES {
        return Err("The pre-bootstrap OpenClaw config backup is not a safe file".to_string());
    }
    let content = std::fs::read(path)
        .map_err(|error| format!("Failed to read the pre-bootstrap OpenClaw config: {error}"))?;
    if content.len() as u64 > MAX_CONFIG_BACKUP_BYTES {
        return Err("The pre-bootstrap OpenClaw config backup exceeded its limit".to_string());
    }
    let actual = format!("{:x}", Sha256::digest(&content));
    if actual != expected {
        return Err(
            "The pre-bootstrap OpenClaw config backup does not match its journaled hash"
                .to_string(),
        );
    }
    Ok(Some(content))
}

fn restore_config_bytes_atomically(
    config_path: &Path,
    content: Option<&[u8]>,
    expected_sha256: &str,
) -> Result<(), String> {
    let parent = config_path
        .parent()
        .ok_or_else(|| "The OpenClaw config path has no parent directory".to_string())?;
    if let Some(content) = content {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create the OpenClaw config directory: {error}"))?;
        let file_name = config_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("openclaw.json");
        let temporary = parent.join(format!(
            ".{file_name}.rollback-{}-{}.tmp",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let displaced = parent.join(format!(
            ".{file_name}.rollback-{}-{}.previous",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        let mut options = std::fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|error| format!("Failed to stage the restored OpenClaw config: {error}"))?;
        let write_result = {
            use std::io::Write;
            file.write_all(content)
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("Failed to persist the restored OpenClaw config: {error}"))
        };
        if let Err(error) = write_result {
            let _ = std::fs::remove_file(&temporary);
            return Err(error);
        }
        let staged_hash = config_hash(&temporary)?;
        if staged_hash != expected_sha256 {
            let _ = std::fs::remove_file(&temporary);
            return Err("The staged OpenClaw config failed hash verification".to_string());
        }

        let had_config = std::fs::symlink_metadata(config_path).is_ok();
        if had_config {
            std::fs::rename(config_path, &displaced).map_err(|error| {
                let _ = std::fs::remove_file(&temporary);
                format!("Failed to preserve the current OpenClaw config during rollback: {error}")
            })?;
        }
        if let Err(error) = std::fs::rename(&temporary, config_path) {
            if had_config {
                let _ = std::fs::rename(&displaced, config_path);
            }
            let _ = std::fs::remove_file(&temporary);
            return Err(format!(
                "Failed to activate the restored OpenClaw config: {error}"
            ));
        }
        sync_parent_directory(config_path)?;
        if config_hash(config_path)? != expected_sha256 {
            return Err("The restored OpenClaw config failed read-back verification".to_string());
        }
        if had_config {
            std::fs::remove_file(&displaced).map_err(|error| {
                format!("Failed to remove the displaced OpenClaw config after rollback: {error}")
            })?;
            sync_parent_directory(config_path)?;
        }
        return Ok(());
    }

    if std::fs::symlink_metadata(config_path).is_err() {
        return (config_hash(config_path)? == "missing")
            .then_some(())
            .ok_or_else(|| "The OpenClaw config unexpectedly exists after rollback".to_string());
    }
    let file_name = config_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("openclaw.json");
    let displaced = parent.join(format!(
        ".{file_name}.rollback-{}-{}.removed",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::rename(config_path, &displaced).map_err(|error| {
        format!("Failed to remove the bootstrap-created OpenClaw config: {error}")
    })?;
    if let Err(error) = sync_parent_directory(config_path) {
        let _ = std::fs::rename(&displaced, config_path);
        return Err(error);
    }
    if config_hash(config_path)? != "missing" {
        let _ = std::fs::rename(&displaced, config_path);
        return Err("The OpenClaw config unexpectedly exists after rollback".to_string());
    }
    std::fs::remove_file(&displaced).map_err(|error| {
        format!("Failed to remove the bootstrap-created OpenClaw config after rollback: {error}")
    })?;
    sync_parent_directory(config_path)
}

fn verify_restored_config_snapshot(
    journal: &CollaborationBootstrapJournal,
    config_path: &Path,
) -> Result<(), String> {
    let actual = config_hash(config_path)?;
    if actual != journal.original_config_sha256 {
        return Err(format!(
            "The restored OpenClaw config hash does not match the pre-bootstrap snapshot (expected {}, got {actual})",
            journal.original_config_sha256
        ));
    }
    Ok(())
}

fn restore_config_snapshot(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    config_path: &Path,
) -> Result<(), String> {
    verify_bootstrap_owned_config(journal, config_path)?;
    journal.record_step("config_restore", "started", None);
    control.save_journal(journal)?;
    let result = (|| {
        let backup = read_verified_config_backup(journal)?;
        verify_bootstrap_owned_config(journal, config_path)?;
        restore_config_bytes_atomically(
            config_path,
            backup.as_deref(),
            &journal.original_config_sha256,
        )?;
        verify_restored_config_snapshot(journal, config_path)
    })();
    let ownership_result = persist_bootstrap_owned_config_hash(control, journal, config_path);
    match (result, ownership_result) {
        (Ok(()), Ok(hash)) if hash == journal.original_config_sha256 => {
            journal.record_step("config_restore", "completed", None);
            control.save_journal(journal)
        }
        (Ok(()), Ok(hash)) => {
            let error = format!(
                "The restored OpenClaw config ownership hash is inconsistent (expected {}, got {hash})",
                journal.original_config_sha256
            );
            journal.record_step("config_restore", "failed", Some(error.clone()));
            control.save_journal(journal)?;
            Err(error)
        }
        (Ok(()), Err(error)) => {
            journal.record_step("config_restore", "failed", Some(error.clone()));
            control.save_journal(journal)?;
            Err(error)
        }
        (Err(error), Ok(_)) => {
            journal.record_step("config_restore", "failed", Some(error.clone()));
            control.save_journal(journal)?;
            Err(error)
        }
        (Err(error), Err(ownership)) => {
            let error =
                format!("{error}; config ownership update also failed after restore: {ownership}");
            journal.record_step("config_restore", "failed", Some(error.clone()));
            control.save_journal(journal)?;
            Err(error)
        }
    }
}

fn backup_config(
    control: &CollaborationControlState,
    operation_id: &str,
    config_path: &Path,
) -> Result<Option<String>, String> {
    if !config_path.exists() {
        return Ok(None);
    }
    let metadata = std::fs::metadata(config_path)
        .map_err(|error| format!("Failed to inspect the target OpenClaw config: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_CONFIG_BACKUP_BYTES {
        return Err("The target OpenClaw config cannot be backed up safely".to_string());
    }
    let root = private_operation_dir(control, operation_id)?;
    let destination = root.join("openclaw.json");
    let content = std::fs::read(config_path)
        .map_err(|error| format!("Failed to read the target OpenClaw config: {error}"))?;
    if content.len() as u64 > MAX_CONFIG_BACKUP_BYTES {
        return Err("The target OpenClaw config changed or exceeded the backup limit".to_string());
    }
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&destination)
        .map_err(|error| format!("Failed to create the config backup: {error}"))?;
    use std::io::Write;
    file.write_all(&content)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist the config backup: {error}"))?;
    Ok(Some(destination.to_string_lossy().to_string()))
}

fn install_record_text<'a>(snapshot: &'a BootstrapPluginSnapshot, key: &str) -> Option<&'a str> {
    snapshot
        .install_record
        .as_ref()?
        .as_object()?
        .get(key)?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn cli_path_to_host(target: &MutationTarget, path: &str) -> Option<PathBuf> {
    if !Path::new(path).is_absolute() {
        return None;
    }
    if target.class != BootstrapTargetClass::Docker {
        return Some(PathBuf::from(path));
    }
    let container_root = Path::new("/home/node/.openclaw");
    let source = Path::new(path);
    let relative = source.strip_prefix(container_root).ok()?;
    Some(target.cli.state_dir.join(relative))
}

fn read_plugin_manifest(path: &Path, label: &str) -> Result<Value, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("The installed plugin {label} is unavailable: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_MANIFEST_BYTES
    {
        return Err(format!(
            "The installed plugin {label} is not a safe manifest file"
        ));
    }
    let raw = std::fs::read(path)
        .map_err(|error| format!("Failed to read the installed plugin {label}: {error}"))?;
    serde_json::from_slice(&raw)
        .map_err(|error| format!("Invalid installed plugin {label}: {error}"))
}

fn validate_installed_plugin_directory(
    path: &Path,
    expected: &BootstrapPluginSnapshot,
) -> Result<(PathBuf, String), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("The installed plugin directory is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The installed plugin path is not a safe directory".to_string());
    }
    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Could not resolve the installed plugin directory: {error}"))?;
    let package = read_plugin_manifest(&canonical.join("package.json"), "package.json")?;
    let manifest = read_plugin_manifest(
        &canonical.join("openclaw.plugin.json"),
        "openclaw.plugin.json",
    )?;
    if package.get("name").and_then(Value::as_str) != Some(PLUGIN_PACKAGE_NAME)
        || manifest.get("id").and_then(Value::as_str) != Some(PLUGIN_ID)
    {
        return Err("The installed plugin directory belongs to another plugin".to_string());
    }
    if ["dependencies", "optionalDependencies"].iter().any(|key| {
        package
            .get(*key)
            .and_then(Value::as_object)
            .is_some_and(|dependencies| !dependencies.is_empty())
    }) {
        return Err(
            "The installed plugin declares runtime dependencies that cannot be restored with a guaranteed offline install"
                .to_string(),
        );
    }
    let package_version = package
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The installed plugin package version is missing".to_string())?;
    let manifest_version = manifest
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "The installed plugin manifest version is missing".to_string())?;
    if package_version != manifest_version
        || expected
            .version
            .as_deref()
            .is_some_and(|version| version != package_version)
    {
        return Err(
            "The installed plugin directory version does not match the active plugin".to_string(),
        );
    }
    Ok((canonical, package_version.to_string()))
}

fn collect_plugin_tree_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<(PathBuf, bool)>,
    expanded_bytes: &mut u64,
) -> Result<(), String> {
    let mut children = std::fs::read_dir(current)
        .map_err(|error| format!("Failed to inspect the installed plugin directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to inspect an installed plugin entry: {error}"))?;
    children.sort_by_key(|entry| entry.file_name());
    for child in children {
        if entries.len() >= MAX_ARCHIVE_ENTRIES {
            return Err("The installed plugin contains too many entries to back up".to_string());
        }
        let path = child.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to inspect an installed plugin entry: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(
                "The installed plugin contains symbolic links and cannot be backed up exactly"
                    .to_string(),
            );
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|_| "The installed plugin entry escaped its package root".to_string())?
            .to_path_buf();
        if relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
            || relative.to_str().is_none()
        {
            return Err("The installed plugin contains an unsafe entry path".to_string());
        }
        if metadata.is_dir() {
            entries.push((relative, true));
            collect_plugin_tree_entries(root, &path, entries, expanded_bytes)?;
        } else if metadata.is_file() {
            *expanded_bytes = expanded_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "The installed plugin size overflowed".to_string())?;
            if *expanded_bytes > MAX_ARCHIVE_EXPANDED_BYTES {
                return Err("The installed plugin exceeds the backup size limit".to_string());
            }
            entries.push((relative, false));
        } else {
            return Err(
                "The installed plugin contains a non-file entry that cannot be backed up"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn plugin_tree_entries(root: &Path) -> Result<Vec<(PathBuf, bool)>, String> {
    let metadata = std::fs::symlink_metadata(root)
        .map_err(|error| format!("The installed plugin root is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The installed plugin root changed during backup".to_string());
    }
    let mut entries = Vec::new();
    let mut expanded_bytes = 0_u64;
    collect_plugin_tree_entries(root, root, &mut entries, &mut expanded_bytes)?;
    Ok(entries)
}

fn hash_plugin_tree(root: &Path) -> Result<String, String> {
    let entries = plugin_tree_entries(root)?;
    let mut hasher = Sha256::new();
    for (relative, is_dir) in entries {
        let normalized = relative
            .to_str()
            .ok_or_else(|| "The installed plugin contains a non-UTF-8 path".to_string())?
            .replace('\\', "/");
        let kind: &[u8] = if is_dir { b"directory" } else { b"file" };
        hasher.update(kind);
        hasher.update((normalized.len() as u64).to_be_bytes());
        hasher.update(normalized.as_bytes());
        if is_dir {
            continue;
        }
        let path = root.join(&relative);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("Failed to recheck an installed plugin file: {error}"))?;
        if !metadata.file_type().is_file() {
            return Err("The installed plugin changed during backup".to_string());
        }
        hasher.update(metadata.len().to_be_bytes());
        let mut file = std::fs::File::open(&path)
            .map_err(|error| format!("Failed to read an installed plugin file: {error}"))?;
        let mut remaining = metadata.len();
        let mut buffer = [0_u8; 64 * 1024];
        while remaining > 0 {
            let count = file
                .read(&mut buffer)
                .map_err(|error| format!("Failed to hash an installed plugin file: {error}"))?;
            if count == 0 {
                return Err("The installed plugin changed during backup".to_string());
            }
            remaining = remaining.saturating_sub(count as u64);
            hasher.update(&buffer[..count]);
        }
        let mut trailing = [0_u8; 1];
        if file.read(&mut trailing).map_err(|error| {
            format!("Failed to finish hashing an installed plugin file: {error}")
        })? != 0
        {
            return Err("The installed plugin changed during backup".to_string());
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn archive_mode(path: &Path, is_dir: bool) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            return metadata.permissions().mode() & 0o777;
        }
    }
    if is_dir {
        0o755
    } else {
        0o644
    }
}

fn create_plugin_tree_archive(root: &Path, destination: &Path) -> Result<String, String> {
    let content_sha256 = hash_plugin_tree(root)?;
    let entries = plugin_tree_entries(root)?;
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let output = options
        .open(destination)
        .map_err(|error| format!("Failed to create the exact plugin backup: {error}"))?;
    let result = (|| {
        let encoder = GzBuilder::new().mtime(0).write(output, Compression::best());
        let mut archive = tar::Builder::new(encoder);
        archive.mode(tar::HeaderMode::Deterministic);

        let mut root_header = tar::Header::new_gnu();
        root_header.set_entry_type(tar::EntryType::Directory);
        root_header.set_size(0);
        root_header.set_mode(archive_mode(root, true));
        root_header.set_uid(0);
        root_header.set_gid(0);
        root_header.set_mtime(0);
        root_header.set_cksum();
        archive
            .append_data(&mut root_header, Path::new("package"), std::io::empty())
            .map_err(|error| format!("Failed to archive the installed plugin root: {error}"))?;

        for (relative, is_dir) in entries {
            let source = root.join(&relative);
            let archive_path = Path::new("package").join(&relative);
            let metadata = std::fs::symlink_metadata(&source)
                .map_err(|error| format!("Failed to recheck an installed plugin entry: {error}"))?;
            let mut header = tar::Header::new_gnu();
            header.set_uid(0);
            header.set_gid(0);
            header.set_mtime(0);
            header.set_mode(archive_mode(&source, is_dir));
            if is_dir {
                if !metadata.is_dir() {
                    return Err("The installed plugin changed during backup".to_string());
                }
                header.set_entry_type(tar::EntryType::Directory);
                header.set_size(0);
                header.set_cksum();
                archive
                    .append_data(&mut header, archive_path, std::io::empty())
                    .map_err(|error| {
                        format!("Failed to archive an installed plugin directory: {error}")
                    })?;
            } else {
                if !metadata.file_type().is_file() {
                    return Err("The installed plugin changed during backup".to_string());
                }
                header.set_entry_type(tar::EntryType::Regular);
                header.set_size(metadata.len());
                header.set_cksum();
                let mut input = std::fs::File::open(&source)
                    .map_err(|error| format!("Failed to open an installed plugin file: {error}"))?;
                archive
                    .append_data(&mut header, archive_path, &mut input)
                    .map_err(|error| {
                        format!("Failed to archive an installed plugin file: {error}")
                    })?;
            }
        }
        archive
            .finish()
            .map_err(|error| format!("Failed to finish the exact plugin backup: {error}"))?;
        let encoder = archive
            .into_inner()
            .map_err(|error| format!("Failed to persist the exact plugin backup: {error}"))?;
        let output = encoder
            .finish()
            .map_err(|error| format!("Failed to finish compressing the plugin backup: {error}"))?;
        output
            .sync_all()
            .map_err(|error| format!("Failed to sync the exact plugin backup: {error}"))?;
        let final_content_sha256 = hash_plugin_tree(root)?;
        if final_content_sha256 != content_sha256 {
            return Err("The installed plugin changed while it was being backed up".to_string());
        }
        parse_archive_metadata(destination)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o400))
                .map_err(|error| format!("Failed to protect the exact plugin backup: {error}"))?;
        }
        Ok(content_sha256)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(destination);
    }
    result
}

fn exact_plugin_source_directory(
    target: &MutationTarget,
    original: &BootstrapPluginSnapshot,
) -> Result<(PathBuf, String), String> {
    if original
        .version
        .as_deref()
        .map(str::trim)
        .is_none_or(str::is_empty)
    {
        return Err(
            "The installed plugin did not report an exact version; refusing to create an ambiguous rollback backup"
                .to_string(),
        );
    }
    let mut candidates = Vec::new();
    if let Some(path) = install_record_text(original, "installPath") {
        candidates.push(path.to_string());
    }
    if let Some(path) = original
        .root_dir
        .as_deref()
        .map(str::trim)
        .filter(|p| !p.is_empty())
    {
        candidates.push(path.to_string());
    }
    if let Some(path) = install_record_text(original, "sourcePath") {
        candidates.push(path.to_string());
    }
    candidates.sort();
    candidates.dedup();
    for candidate in candidates {
        let Some(host_path) = cli_path_to_host(target, &candidate) else {
            continue;
        };
        if let Ok(validated) = validate_installed_plugin_directory(&host_path, original) {
            return Ok(validated);
        }
    }
    Err(
        "The installed plugin has no exact, locally readable package directory; refusing to mutate it without an offline rollback backup"
            .to_string(),
    )
}

fn backup_original_plugin_archive(
    control: &CollaborationControlState,
    target: &MutationTarget,
    operation_id: &str,
    original: &BootstrapPluginSnapshot,
) -> Result<Option<ExactPluginBackup>, String> {
    if !original.installed {
        return Ok(None);
    }
    let (source_directory, version) = exact_plugin_source_directory(target, original)?;
    let (host_dir, cli_dir) = target_artifact_dirs(control, target, operation_id)?;
    let file_name = "original-junqi-collab.tgz";
    let host_backup = host_dir.join(file_name);
    let content_sha256 = create_plugin_tree_archive(&source_directory, &host_backup)?;
    let archive_sha256 = hash_file(&host_backup, MAX_PACKAGE_BYTES)?;
    let archived_version = parse_archive_metadata(&host_backup)?;
    if archived_version != version {
        let _ = std::fs::remove_file(&host_backup);
        return Err("The exact plugin backup version changed during archival".to_string());
    }
    Ok(Some(ExactPluginBackup {
        cli_path: cli_dir.join(file_name).to_string_lossy().to_string(),
        host_path: host_backup.to_string_lossy().to_string(),
        archive_sha256,
        content_sha256,
    }))
}

fn new_journal(
    target: &MutationTarget,
    package: &VerifiedPackage,
    original_plugin: BootstrapPluginSnapshot,
    original_config_sha256: String,
    operation_id: String,
    config_backup_path: Option<String>,
    original_plugin_backup: Option<ExactPluginBackup>,
) -> CollaborationBootstrapJournal {
    let now = chrono::Utc::now().timestamp_millis();
    CollaborationBootstrapJournal {
        version: BOOTSTRAP_JOURNAL_VERSION,
        operation_id,
        operation: BootstrapOperationKind::Apply,
        status: BootstrapJournalStatus::Running,
        target: BootstrapTargetSnapshot {
            target_fingerprint: target.identity.target_fingerprint.clone(),
            connection_id: target.identity.connection_id.clone(),
            deployment_kind: deployment_name(target.identity.deployment_kind).to_string(),
            ownership: ownership_name(target.identity.ownership).to_string(),
            gateway_version: target.identity.gateway_version.clone(),
            binary_path: target.cli.binary.to_string_lossy().to_string(),
            state_dir: target.cli.state_dir.to_string_lossy().to_string(),
            config_path: target.cli.config_path.to_string_lossy().to_string(),
        },
        package: BootstrapPackageSnapshot {
            source_tgz_path: package.source_path.to_string_lossy().to_string(),
            host_tgz_path: package.host_path.to_string_lossy().to_string(),
            tgz_path: package.cli_path.to_string_lossy().to_string(),
            sha256: package.sha256.clone(),
            plugin_id: PLUGIN_ID.to_string(),
            plugin_version: package.plugin_version.clone(),
        },
        original_plugin,
        original_plugin_backup_tgz_path: original_plugin_backup
            .as_ref()
            .map(|backup| backup.cli_path.clone()),
        original_plugin_backup_host_tgz_path: original_plugin_backup
            .as_ref()
            .map(|backup| backup.host_path.clone()),
        original_plugin_backup_sha256: original_plugin_backup
            .as_ref()
            .map(|backup| backup.archive_sha256.clone()),
        original_plugin_content_sha256: original_plugin_backup.map(|backup| backup.content_sha256),
        bootstrap_owned_config_sha256: Some(original_config_sha256.clone()),
        original_config_sha256,
        original_config_backup_path: config_backup_path,
        started_at_ms: now,
        updated_at_ms: now,
        restart_required: false,
        health_pending: false,
        health: None,
        steps: Vec::new(),
        diagnostics: Vec::new(),
    }
}

fn journal_failure(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    code: &str,
    message: &str,
) -> Result<(), String> {
    journal.status = BootstrapJournalStatus::RecoveryRequired;
    journal.add_diagnostic(format!("{code}: {message}"));
    control.save_journal(journal)
}

async fn execute_cli_step(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    target: &PinnedOpenClawCliTarget,
    step: &str,
    args: Vec<OsString>,
    timeout_seconds: u64,
) -> Result<OpenClawCliOutput, String> {
    verify_bootstrap_owned_config(journal, &target.config_path)?;
    journal.record_step(step, "started", None);
    control.save_journal(journal)?;
    let execution = run_openclaw_cli(target, args, cli_limits(timeout_seconds)).await;
    let ownership_error =
        persist_bootstrap_owned_config_hash(control, journal, &target.config_path).err();
    let output = match execution {
        Ok(output) => output,
        Err(error) => {
            let error = ownership_error.map_or(error.clone(), |ownership| {
                format!("{error}; config ownership update also failed: {ownership}")
            });
            journal.record_step(step, "failed", Some(error.clone()));
            control.save_journal(journal)?;
            return Err(error);
        }
    };
    if let Some(error) = ownership_error {
        let error =
            format!("OpenClaw {step} returned, but its config state could not be fenced: {error}");
        journal.record_step(step, "failed", Some(error.clone()));
        control.save_journal(journal)?;
        return Err(error);
    }
    if !output.status.success() {
        let diagnostic = output_diagnostic(
            &output,
            &[
                &target.binary,
                &target.state_dir,
                &target.config_path,
                Path::new(&journal.package.tgz_path),
                Path::new(&journal.package.host_tgz_path),
                Path::new(&journal.package.source_tgz_path),
            ],
        );
        let error = format!(
            "OpenClaw {step} exited with code {}{}",
            output.status.code().unwrap_or(-1),
            if diagnostic.is_empty() {
                String::new()
            } else {
                format!(": {diagnostic}")
            }
        );
        journal.record_step(step, "failed", Some(error.clone()));
        control.save_journal(journal)?;
        return Err(error);
    }
    journal.record_step(step, "completed", None);
    control.save_journal(journal)?;
    Ok(output)
}

async fn install_enable_inspect(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    target: &PinnedOpenClawCliTarget,
) -> Result<(BootstrapPluginSnapshot, Vec<String>), String> {
    let archive = OsString::from(&journal.package.tgz_path);
    execute_cli_step(
        control,
        journal,
        target,
        "plugins_install",
        vec![
            "plugins".into(),
            "install".into(),
            "--force".into(),
            "--pin".into(),
            archive,
        ],
        300,
    )
    .await?;
    execute_cli_step(
        control,
        journal,
        target,
        "plugins_enable",
        vec!["plugins".into(), "enable".into(), PLUGIN_ID.into()],
        60,
    )
    .await?;
    journal.record_step("plugins_inspect", "started", None);
    control.save_journal(journal)?;
    let (plugin, warnings) = inspect_plugin(target).await.inspect_err(|error| {
        journal.record_step("plugins_inspect", "failed", Some(error.clone()));
        let _ = control.save_journal(journal);
    })?;
    if !plugin.installed
        || !plugin.enabled
        || plugin.status.as_deref() != Some("loaded")
        || plugin.version.as_deref() != Some(journal.package.plugin_version.as_str())
    {
        let error = "Installed collaboration plugin failed identity, version, enablement, or load validation"
            .to_string();
        journal.record_step("plugins_inspect", "failed", Some(error.clone()));
        control.save_journal(journal)?;
        return Err(error);
    }
    journal.record_step("plugins_inspect", "completed", None);
    control.save_journal(journal)?;
    Ok((plugin, warnings))
}

async fn uninstall_if_present(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    target: &PinnedOpenClawCliTarget,
) -> Result<(), String> {
    let step = "plugins_uninstall";
    verify_bootstrap_owned_config(journal, &target.config_path)?;
    journal.record_step(step, "started", None);
    control.save_journal(journal)?;
    let execution = run_openclaw_cli(
        target,
        ["plugins", "uninstall", PLUGIN_ID, "--force"],
        cli_limits(120),
    )
    .await;
    let ownership_error =
        persist_bootstrap_owned_config_hash(control, journal, &target.config_path).err();
    let output = match execution {
        Ok(output) => output,
        Err(error) => {
            let error = ownership_error.map_or(error.clone(), |ownership| {
                format!("{error}; config ownership update also failed: {ownership}")
            });
            journal.record_step(step, "failed", Some(error.clone()));
            control.save_journal(journal)?;
            return Err(error);
        }
    };
    if let Some(error) = ownership_error {
        let error = format!(
            "OpenClaw plugin uninstall returned, but its config state could not be fenced: {error}"
        );
        journal.record_step(step, "failed", Some(error.clone()));
        control.save_journal(journal)?;
        return Err(error);
    }
    if !output.status.success() {
        let diagnostic = output_diagnostic(
            &output,
            &[&target.binary, &target.state_dir, &target.config_path],
        );
        if !diagnostic.to_ascii_lowercase().contains("plugin not found") {
            let error = format!("OpenClaw plugin uninstall failed: {diagnostic}");
            journal.record_step(step, "failed", Some(error.clone()));
            control.save_journal(journal)?;
            return Err(error);
        }
        journal.record_step(step, "completed_already_absent", None);
    } else {
        journal.record_step(step, "completed", None);
    }
    control.save_journal(journal)
}

fn existing_journal_blocks_apply(journal: Option<&CollaborationBootstrapJournal>) -> bool {
    journal
        .map(|journal| {
            matches!(
                journal.status,
                BootstrapJournalStatus::Running | BootstrapJournalStatus::RecoveryRequired
            ) || (journal.status == BootstrapJournalStatus::Completed && journal.health_pending)
        })
        .unwrap_or(false)
}

#[expect(
    clippy::too_many_arguments,
    reason = "the constructor mirrors the stable recovery response contract"
)]
fn abandon_result(
    ok: bool,
    code: impl Into<String>,
    message: impl Into<String>,
    operation_id: Option<String>,
    orphan_target_fingerprint: Option<String>,
    current_target_fingerprint: Option<String>,
    evidence_retained: bool,
    apply_unblocked: bool,
) -> CollaborationBootstrapAbandonResult {
    CollaborationBootstrapAbandonResult {
        ok,
        code: code.into(),
        message: message.into(),
        operation_id,
        orphan_target_fingerprint,
        current_target_fingerprint,
        evidence_retained,
        apply_unblocked,
    }
}

#[cfg(not(unix))]
fn copy_bootstrap_evidence(
    source: &Path,
    destination: &Path,
    limit: u64,
    expected_sha256: Option<&str>,
) -> Result<String, String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|error| format!("Failed to inspect bootstrap recovery evidence: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err("Bootstrap recovery evidence is not a safe bounded file".to_string());
    }
    let mut input = std::fs::File::open(source)
        .map_err(|error| format!("Failed to open bootstrap recovery evidence: {error}"))?;
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(destination)
        .map_err(|error| format!("Failed to create archived bootstrap evidence: {error}"))?;
    let result = (|| {
        use std::io::Write;
        let mut total = 0_u64;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|error| format!("Failed to read bootstrap recovery evidence: {error}"))?;
            if count == 0 {
                break;
            }
            total = total
                .checked_add(count as u64)
                .ok_or_else(|| "Bootstrap recovery evidence size overflowed".to_string())?;
            if total > limit {
                return Err("Bootstrap recovery evidence exceeded its size limit".to_string());
            }
            hasher.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Failed to write archived bootstrap evidence: {error}"))?;
        }
        output
            .sync_all()
            .map_err(|error| format!("Failed to persist archived bootstrap evidence: {error}"))?;
        let actual = format!("{:x}", hasher.finalize());
        if expected_sha256.is_some_and(|expected| expected != actual) {
            return Err("Bootstrap recovery evidence failed hash verification".to_string());
        }
        Ok(actual)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(destination);
    }
    result
}

fn bootstrap_archive_key(operation_id: &str) -> String {
    format!("{:x}", Sha256::digest(operation_id.as_bytes()))
}

fn parse_archived_journal(raw: &[u8]) -> Result<CollaborationBootstrapJournal, String> {
    if raw.len() > 512 * 1024 {
        return Err("Archived bootstrap journal exceeds the 512 KiB limit".to_string());
    }
    let journal: CollaborationBootstrapJournal = serde_json::from_slice(raw)
        .map_err(|error| format!("Invalid archived bootstrap journal: {error}"))?;
    validate_bootstrap_operation_id(&journal.operation_id)
        .map_err(|error| format!("Invalid archived bootstrap journal operation id: {error}"))?;
    Ok(journal)
}

/// Writes an archived journal as one owned operation. Consuming the file keeps
/// the archive commit boundary portable: Windows must not rename the staging
/// directory while its journal handle is still open.
fn persist_archived_bootstrap_journal(
    mut file: std::fs::File,
    archived: &CollaborationBootstrapJournal,
) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(archived)
        .map_err(|error| format!("Failed to encode the archived bootstrap journal: {error}"))?;
    if payload.len() > 512 * 1024 {
        return Err("Archived bootstrap journal exceeds the 512 KiB limit".to_string());
    }
    use std::io::Write;
    file.write_all(&payload)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("Failed to persist the archived bootstrap journal: {error}"))
}

#[cfg(any(not(unix), test))]
fn load_archived_journal(path: &Path) -> Result<CollaborationBootstrapJournal, String> {
    let raw = std::fs::read(path)
        .map_err(|error| format!("Failed to read archived bootstrap journal: {error}"))?;
    parse_archived_journal(&raw)
}

#[cfg(not(unix))]
fn clear_active_bootstrap_journal(control: &CollaborationControlState) -> Result<(), String> {
    let path = control.journal_path();
    let backup = path.with_extension("json.bak");
    for candidate in [path, backup.as_path()] {
        if candidate.exists() {
            std::fs::remove_file(candidate).map_err(|error| {
                format!("Failed to clear the archived bootstrap journal: {error}")
            })?;
        }
    }
    sync_parent_directory(path)
}

#[cfg(unix)]
fn read_bounded_descriptor_file(
    mut file: std::fs::File,
    limit: u64,
    label: &str,
) -> Result<Vec<u8>, String> {
    let metadata = file
        .metadata()
        .map_err(|error| format!("Failed to inspect {label}: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() > limit {
        return Err(format!("{label} is not a safe bounded regular file"));
    }
    let capacity = usize::try_from(metadata.len())
        .map_err(|_| format!("{label} size cannot be represented safely"))?;
    let mut raw = Vec::with_capacity(capacity);
    file.by_ref()
        .take(limit.saturating_add(1))
        .read_to_end(&mut raw)
        .map_err(|error| format!("Failed to read {label}: {error}"))?;
    if raw.len() as u64 > limit {
        return Err(format!("{label} exceeded its size limit while being read"));
    }
    Ok(raw)
}

#[cfg(unix)]
fn load_archived_journal_from_directory(
    directory: &DescriptorDirectory,
) -> Result<CollaborationBootstrapJournal, String> {
    let file = directory.open_regular_file(OsStr::new("journal.json"), "archived journal")?;
    let raw = read_bounded_descriptor_file(file, 512 * 1024, "archived journal")?;
    parse_archived_journal(&raw)
}

#[cfg(unix)]
fn copy_bootstrap_evidence_descriptor(
    source: &Path,
    destination: &DescriptorDirectory,
    destination_name: &OsStr,
    limit: u64,
    expected_sha256: Option<&str>,
) -> Result<String, String> {
    let mut input = open_absolute_regular_file(source, "bootstrap recovery evidence")?;
    let metadata = input
        .metadata()
        .map_err(|error| format!("Failed to inspect bootstrap recovery evidence: {error}"))?;
    if metadata.len() > limit {
        return Err("Bootstrap recovery evidence is not a safe bounded file".to_string());
    }
    let mut output =
        destination.create_regular_file(destination_name, 0o600, "archived bootstrap evidence")?;
    let result = (|| {
        use std::io::Write;
        let mut total = 0_u64;
        let mut hasher = Sha256::new();
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let count = input
                .read(&mut buffer)
                .map_err(|error| format!("Failed to read bootstrap recovery evidence: {error}"))?;
            if count == 0 {
                break;
            }
            total = total
                .checked_add(count as u64)
                .ok_or_else(|| "Bootstrap recovery evidence size overflowed".to_string())?;
            if total > limit {
                return Err("Bootstrap recovery evidence exceeded its size limit".to_string());
            }
            hasher.update(&buffer[..count]);
            output
                .write_all(&buffer[..count])
                .map_err(|error| format!("Failed to write archived bootstrap evidence: {error}"))?;
        }
        output
            .sync_all()
            .map_err(|error| format!("Failed to persist archived bootstrap evidence: {error}"))?;
        let actual = format!("{:x}", hasher.finalize());
        if expected_sha256.is_some_and(|expected| expected != actual) {
            return Err("Bootstrap recovery evidence failed hash verification".to_string());
        }
        Ok(actual)
    })();
    if result.is_err() {
        let _ = destination
            .unlink_file_if_present(destination_name, "incomplete archived bootstrap evidence");
    }
    result
}

#[cfg(unix)]
fn clear_active_bootstrap_journal_descriptor(
    control: &CollaborationControlState,
    journal_parent: &DescriptorDirectory,
) -> Result<(), String> {
    let path = control.journal_path();
    let backup = path.with_extension("json.bak");
    for candidate in [path, backup.as_path()] {
        let name = candidate
            .file_name()
            .ok_or_else(|| "Invalid bootstrap journal file name".to_string())?;
        journal_parent.unlink_file_if_present(name, "archived bootstrap journal")?;
    }
    journal_parent.sync("bootstrap journal directory")
}

#[cfg(unix)]
fn cleanup_archive_staging(
    archive_root: &DescriptorDirectory,
    staging: &DescriptorDirectory,
    staging_name: &OsStr,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for name in [
        "journal.json",
        "applied-package.tgz",
        "original-openclaw.json",
        "original-plugin.tgz",
    ] {
        if let Err(error) =
            staging.unlink_file_if_present(OsStr::new(name), "incomplete bootstrap archive file")
        {
            errors.push(error);
        }
    }
    if let Err(error) = archive_root
        .unlink_child_directory_if_present(staging_name, "incomplete bootstrap archive directory")
    {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(unix)]
fn archive_abandoned_bootstrap(
    control: &CollaborationControlState,
    journal: &CollaborationBootstrapJournal,
    current_target_fingerprint: &str,
) -> Result<(), String> {
    validate_bootstrap_operation_id(&journal.operation_id)
        .map_err(|message| format!("Invalid bootstrap operation id: {message}"))?;
    let journal_parent_path = control
        .journal_path()
        .parent()
        .ok_or_else(|| "Invalid bootstrap journal directory".to_string())?;
    let journal_parent = DescriptorDirectory::open_absolute(
        journal_parent_path,
        false,
        0,
        "bootstrap journal directory",
    )?;
    let archive_root = journal_parent.ensure_child_directory(
        OsStr::new("collaboration-bootstrap-archive"),
        0o700,
        "bootstrap archive root",
    )?;
    let archive_key = bootstrap_archive_key(&journal.operation_id);
    if let Some(final_directory) = archive_root
        .open_child_directory(OsStr::new(&archive_key), "committed bootstrap archive")?
    {
        let archived = load_archived_journal_from_directory(&final_directory)?;
        if archived.operation_id != journal.operation_id
            || archived.target.target_fingerprint != journal.target.target_fingerprint
            || archived.status != BootstrapJournalStatus::Abandoned
        {
            return Err("The existing bootstrap archive does not match this operation".to_string());
        }
        return clear_active_bootstrap_journal_descriptor(control, &journal_parent);
    }
    let archive_count = archive_root.visible_entry_count("bounded bootstrap archive")?;
    if archive_count >= MAX_ABANDONED_BOOTSTRAP_ARCHIVES {
        return Err(format!(
            "The bounded bootstrap archive already contains {MAX_ABANDONED_BOOTSTRAP_ARCHIVES} operations; export or remove evidence before abandoning another operation"
        ));
    }

    let staging_name = format!(".{archive_key}.{}.tmp", uuid::Uuid::new_v4());
    let staging = archive_root.create_child_directory_new(
        OsStr::new(&staging_name),
        0o700,
        "bootstrap archive staging directory",
    )?;
    let final_path = archive_root.display_path.join(&archive_key);
    let mut committed = false;
    let result = (|| {
        let mut archived = journal.clone();
        archived.status = BootstrapJournalStatus::Abandoned;
        archived.add_diagnostic(format!(
            "Explicitly abandoned after the operator connected to a different verified target: {current_target_fingerprint}"
        ));
        archived.record_step("abandon", "archived", None);

        copy_bootstrap_evidence_descriptor(
            Path::new(&journal.package.host_tgz_path),
            &staging,
            OsStr::new("applied-package.tgz"),
            MAX_PACKAGE_BYTES,
            Some(&journal.package.sha256),
        )?;
        let archived_package = final_path.join("applied-package.tgz");
        archived.package.source_tgz_path = archived_package.to_string_lossy().to_string();
        archived.package.host_tgz_path = archived.package.source_tgz_path.clone();
        archived.package.tgz_path = archived.package.source_tgz_path.clone();

        if journal.original_config_sha256 == "missing" {
            if journal.original_config_backup_path.is_some() {
                return Err(
                    "The bootstrap journal contains an inconsistent config backup".to_string(),
                );
            }
            archived.original_config_backup_path = None;
        } else {
            let source = journal
                .original_config_backup_path
                .as_deref()
                .ok_or_else(|| "The pre-bootstrap config backup is unavailable".to_string())?;
            copy_bootstrap_evidence_descriptor(
                Path::new(source),
                &staging,
                OsStr::new("original-openclaw.json"),
                MAX_CONFIG_BACKUP_BYTES,
                Some(&journal.original_config_sha256),
            )?;
            archived.original_config_backup_path = Some(
                final_path
                    .join("original-openclaw.json")
                    .to_string_lossy()
                    .to_string(),
            );
        }

        if journal.original_plugin.installed {
            let source = journal
                .original_plugin_backup_host_tgz_path
                .as_deref()
                .ok_or_else(|| "The exact original plugin backup is unavailable".to_string())?;
            let expected = journal
                .original_plugin_backup_sha256
                .as_deref()
                .filter(|hash| is_valid_sha256(hash))
                .ok_or_else(|| {
                    "The exact original plugin backup hash is unavailable".to_string()
                })?;
            journal
                .original_plugin_content_sha256
                .as_deref()
                .filter(|hash| is_valid_sha256(hash))
                .ok_or_else(|| "The original plugin content hash is unavailable".to_string())?;
            copy_bootstrap_evidence_descriptor(
                Path::new(source),
                &staging,
                OsStr::new("original-plugin.tgz"),
                MAX_PACKAGE_BYTES,
                Some(expected),
            )?;
            let archived_plugin = final_path.join("original-plugin.tgz");
            archived.original_plugin_backup_host_tgz_path =
                Some(archived_plugin.to_string_lossy().to_string());
            archived.original_plugin_backup_tgz_path =
                archived.original_plugin_backup_host_tgz_path.clone();
        } else if journal.original_plugin_backup_host_tgz_path.is_some()
            || journal.original_plugin_backup_tgz_path.is_some()
            || journal.original_plugin_backup_sha256.is_some()
            || journal.original_plugin_content_sha256.is_some()
        {
            return Err("The bootstrap journal contains an inconsistent plugin backup".to_string());
        }

        let file = staging.create_regular_file(
            OsStr::new("journal.json"),
            0o600,
            "archived bootstrap journal",
        )?;
        persist_archived_bootstrap_journal(file, &archived)?;
        staging.sync("bootstrap archive staging directory")?;
        archive_root.rename_child_noreplace(
            OsStr::new(&staging_name),
            OsStr::new(&archive_key),
            "archived bootstrap evidence",
        )?;
        committed = true;
        archive_root.sync("bootstrap archive root")?;
        clear_active_bootstrap_journal_descriptor(control, &journal_parent)
    })();
    match result {
        Ok(()) => Ok(()),
        Err(error) if committed => Err(error),
        Err(error) => {
            match cleanup_archive_staging(&archive_root, &staging, OsStr::new(&staging_name)) {
                Ok(()) => Err(error),
                Err(cleanup_error) => Err(format!(
                "{error}; failed to clean the incomplete bootstrap archive safely: {cleanup_error}"
            )),
            }
        }
    }
}

#[cfg(not(unix))]
fn archive_abandoned_bootstrap(
    control: &CollaborationControlState,
    journal: &CollaborationBootstrapJournal,
    current_target_fingerprint: &str,
) -> Result<(), String> {
    validate_bootstrap_operation_id(&journal.operation_id)
        .map_err(|message| format!("Invalid bootstrap operation id: {message}"))?;
    let journal_parent = control
        .journal_path()
        .parent()
        .ok_or_else(|| "Invalid bootstrap journal directory".to_string())?;
    let archive_root = journal_parent.join("collaboration-bootstrap-archive");
    secure_directory(&archive_root)?;
    let archive_key = bootstrap_archive_key(&journal.operation_id);
    let final_directory = archive_root.join(&archive_key);
    let archived_journal_path = final_directory.join("journal.json");
    if final_directory.exists() {
        let archived = load_archived_journal(&archived_journal_path)?;
        if archived.operation_id != journal.operation_id
            || archived.target.target_fingerprint != journal.target.target_fingerprint
            || archived.status != BootstrapJournalStatus::Abandoned
        {
            return Err("The existing bootstrap archive does not match this operation".to_string());
        }
        return clear_active_bootstrap_journal(control);
    }
    let archive_count = std::fs::read_dir(&archive_root)
        .map_err(|error| format!("Failed to inspect the bootstrap archive: {error}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .count();
    if archive_count >= MAX_ABANDONED_BOOTSTRAP_ARCHIVES {
        return Err(format!(
            "The bounded bootstrap archive already contains {MAX_ABANDONED_BOOTSTRAP_ARCHIVES} operations; export or remove evidence before abandoning another operation"
        ));
    }

    let staging = archive_root.join(format!(".{archive_key}.tmp"));
    if staging.exists() {
        std::fs::remove_dir_all(&staging).map_err(|error| {
            format!("Failed to reset an interrupted bootstrap archive: {error}")
        })?;
    }
    secure_directory(&staging)?;
    let mut archived = journal.clone();
    archived.status = BootstrapJournalStatus::Abandoned;
    archived.add_diagnostic(format!(
        "Explicitly abandoned after the operator connected to a different verified target: {current_target_fingerprint}"
    ));
    archived.record_step("abandon", "archived", None);

    let archived_package = final_directory.join("applied-package.tgz");
    copy_bootstrap_evidence(
        Path::new(&journal.package.host_tgz_path),
        &staging.join("applied-package.tgz"),
        MAX_PACKAGE_BYTES,
        Some(&journal.package.sha256),
    )?;
    archived.package.source_tgz_path = archived_package.to_string_lossy().to_string();
    archived.package.host_tgz_path = archived.package.source_tgz_path.clone();
    archived.package.tgz_path = archived.package.source_tgz_path.clone();

    if journal.original_config_sha256 == "missing" {
        if journal.original_config_backup_path.is_some() {
            let _ = std::fs::remove_dir_all(&staging);
            return Err("The bootstrap journal contains an inconsistent config backup".to_string());
        }
        archived.original_config_backup_path = None;
    } else {
        let source = journal
            .original_config_backup_path
            .as_deref()
            .ok_or_else(|| "The pre-bootstrap config backup is unavailable".to_string())?;
        copy_bootstrap_evidence(
            Path::new(source),
            &staging.join("original-openclaw.json"),
            MAX_CONFIG_BACKUP_BYTES,
            Some(&journal.original_config_sha256),
        )?;
        archived.original_config_backup_path = Some(
            final_directory
                .join("original-openclaw.json")
                .to_string_lossy()
                .to_string(),
        );
    }

    if journal.original_plugin.installed {
        let source = journal
            .original_plugin_backup_host_tgz_path
            .as_deref()
            .ok_or_else(|| "The exact original plugin backup is unavailable".to_string())?;
        let expected = journal
            .original_plugin_backup_sha256
            .as_deref()
            .filter(|hash| is_valid_sha256(hash))
            .ok_or_else(|| "The exact original plugin backup hash is unavailable".to_string())?;
        journal
            .original_plugin_content_sha256
            .as_deref()
            .filter(|hash| is_valid_sha256(hash))
            .ok_or_else(|| "The original plugin content hash is unavailable".to_string())?;
        copy_bootstrap_evidence(
            Path::new(source),
            &staging.join("original-plugin.tgz"),
            MAX_PACKAGE_BYTES,
            Some(expected),
        )?;
        let archived_plugin = final_directory.join("original-plugin.tgz");
        archived.original_plugin_backup_host_tgz_path =
            Some(archived_plugin.to_string_lossy().to_string());
        archived.original_plugin_backup_tgz_path =
            archived.original_plugin_backup_host_tgz_path.clone();
    } else if journal.original_plugin_backup_host_tgz_path.is_some()
        || journal.original_plugin_backup_tgz_path.is_some()
        || journal.original_plugin_backup_sha256.is_some()
        || journal.original_plugin_content_sha256.is_some()
    {
        let _ = std::fs::remove_dir_all(&staging);
        return Err("The bootstrap journal contains an inconsistent plugin backup".to_string());
    }

    let staged_journal = staging.join("journal.json");
    let mut options = std::fs::OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(&staged_journal)
        .map_err(|error| format!("Failed to create the archived bootstrap journal: {error}"))?;
    if let Err(error) = persist_archived_bootstrap_journal(file, &archived) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    sync_parent_directory(&staged_journal)?;
    std::fs::rename(&staging, &final_directory)
        .map_err(|error| format!("Failed to commit the archived bootstrap evidence: {error}"))?;
    sync_parent_directory(&final_directory)?;
    clear_active_bootstrap_journal(control)
}

fn validate_bootstrap_abandon(
    journal: &CollaborationBootstrapJournal,
    identity: &RuntimeIdentity,
    params: &BootstrapAbandonParams,
) -> Result<(), (String, String)> {
    let operation_id = params.operation_id.trim();
    if let Err(message) = validate_bootstrap_operation_id(operation_id) {
        return Err(("BOOTSTRAP_OPERATION_INVALID".to_string(), message));
    }
    validate_bootstrap_operation_id(&journal.operation_id).map_err(|message| {
        (
            "BOOTSTRAP_OPERATION_INVALID".to_string(),
            format!("The bootstrap journal operation id is invalid: {message}"),
        )
    })?;
    if operation_id != journal.operation_id {
        return Err((
            "BOOTSTRAP_OPERATION_MISMATCH".to_string(),
            "The confirmed bootstrap operation does not match the active journal".to_string(),
        ));
    }
    if params.orphan_target_fingerprint.trim().is_empty()
        || params.orphan_target_fingerprint.trim() != journal.target.target_fingerprint
    {
        return Err((
            "ORPHAN_TARGET_MISMATCH".to_string(),
            "The confirmed orphan target does not match the active bootstrap journal".to_string(),
        ));
    }
    validate_fingerprint(identity, &params.current_target_fingerprint).map_err(|code| {
        (
            code,
            "The active Gateway target changed; probe it again before abandoning recovery"
                .to_string(),
        )
    })?;
    validate_expected_connection(identity, &params.expected_connection_id)?;
    let class = target_class(identity);
    if !identity.verified
        || !identity.desktop_mutation_allowed
        || identity.ownership != RuntimeOwnership::JunqiManaged
        || matches!(
            class,
            BootstrapTargetClass::ExternalLocal
                | BootstrapTargetClass::ExternalRemote
                | BootstrapTargetClass::Unknown
        )
    {
        return Err((
            "CURRENT_TARGET_NOT_ATTESTED".to_string(),
            "Only a verified JunQi-owned current Gateway can replace an orphaned bootstrap target"
                .to_string(),
        ));
    }
    validate_durable_identity(identity, class)?;
    if identity.target_fingerprint == journal.target.target_fingerprint {
        return Err((
            "BOOTSTRAP_TARGET_NOT_ORPHANED".to_string(),
            "Reconnect to this target and resume or roll back its bootstrap operation".to_string(),
        ));
    }
    if !existing_journal_blocks_apply(Some(journal)) {
        return Err((
            "BOOTSTRAP_ABANDON_NOT_REQUIRED".to_string(),
            "The active bootstrap journal does not block a new apply operation".to_string(),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn collaboration_bootstrap_abandon(
    params: BootstrapAbandonParams,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
    gateway_state: State<'_, GatewayProcess>,
) -> Result<CollaborationBootstrapAbandonResult, String> {
    let operation_id = params.operation_id.trim().to_string();
    let orphan_target = params.orphan_target_fingerprint.trim().to_string();
    let current_target = params.current_target_fingerprint.trim().to_string();
    let _guard = match control.try_acquire() {
        Ok(guard) => guard,
        Err(message) => {
            return Ok(abandon_result(
                false,
                "BOOTSTRAP_BUSY",
                message,
                Some(operation_id),
                Some(orphan_target),
                Some(current_target),
                false,
                false,
            ));
        }
    };
    let _gateway_guard = match gateway_state.operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            return Ok(abandon_result(
                false,
                "GATEWAY_OPERATION_BUSY",
                "A Gateway lifecycle, update, or storage operation is already running",
                Some(operation_id),
                Some(orphan_target),
                Some(current_target),
                false,
                false,
            ));
        }
    };
    let Some(journal) = control.load_journal()? else {
        return Ok(abandon_result(
            false,
            "BOOTSTRAP_JOURNAL_MISSING",
            "There is no orphaned collaboration bootstrap operation to abandon",
            Some(operation_id),
            Some(orphan_target),
            Some(current_target),
            false,
            true,
        ));
    };
    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(abandon_result(
            false,
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "Connect to the replacement Gateway before abandoning orphaned bootstrap recovery",
            Some(operation_id),
            Some(orphan_target),
            Some(current_target),
            false,
            false,
        ));
    };
    if let Err((code, message)) = validate_bootstrap_abandon(&journal, &identity, &params) {
        return Ok(abandon_result(
            false,
            code,
            message,
            Some(operation_id),
            Some(orphan_target),
            Some(current_target),
            false,
            false,
        ));
    }
    let live_identity = current_identity(&identity_state)?;
    if let Err((code, message)) =
        validate_current_operation_identity(&identity, live_identity.as_ref())
    {
        return Ok(abandon_result(
            false,
            code,
            message,
            Some(operation_id),
            Some(orphan_target),
            Some(current_target),
            false,
            false,
        ));
    }
    if let Err(message) =
        archive_abandoned_bootstrap(&control, &journal, &identity.target_fingerprint)
    {
        return Ok(abandon_result(
            false,
            "BOOTSTRAP_ABANDON_ARCHIVE_FAILED",
            message,
            Some(operation_id),
            Some(orphan_target),
            Some(current_target),
            false,
            false,
        ));
    }
    Ok(abandon_result(
        true,
        "BOOTSTRAP_ABANDONED",
        "The orphaned bootstrap operation and its recovery evidence were archived; the verified current target can now be bootstrapped",
        Some(operation_id),
        Some(orphan_target),
        Some(identity.target_fingerprint),
        true,
        true,
    ))
}

#[tauri::command]
pub async fn collaboration_bootstrap_configure(
    params: BootstrapConfigureParams,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
    gateway_state: State<'_, GatewayProcess>,
) -> Result<CollaborationBootstrapConfigureResult, String> {
    let requested_fingerprint = params.target_fingerprint.trim().to_string();
    let requested_connection = params.expected_connection_id.trim().to_string();
    let _guard = match control.try_acquire() {
        Ok(guard) => guard,
        Err(message) => {
            return Ok(configuration_result(
                false,
                "BOOTSTRAP_BUSY",
                message,
                Some(requested_fingerprint),
                Some(requested_connection),
                None,
                false,
                Vec::new(),
            ));
        }
    };
    let _gateway_guard = match gateway_state.operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            return Ok(configuration_result(
                false,
                "GATEWAY_OPERATION_BUSY",
                "A Gateway lifecycle, update, storage, or collaboration operation is already running",
                Some(requested_fingerprint),
                Some(requested_connection),
                None,
                false,
                Vec::new(),
            ));
        }
    };
    if control.load_journal()?.as_ref().is_some_and(|journal| {
        matches!(
            journal.status,
            BootstrapJournalStatus::Running | BootstrapJournalStatus::RecoveryRequired
        )
    }) {
        return Ok(configuration_result(
            false,
            "BOOTSTRAP_RECOVERY_REQUIRED",
            "Recover or roll back the interrupted bootstrap before changing collaboration configuration",
            Some(requested_fingerprint),
            Some(requested_connection),
            None,
            false,
            Vec::new(),
        ));
    }

    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(configuration_result(
            false,
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "Connect to the exact durable Gateway before configuring collaboration",
            Some(requested_fingerprint),
            Some(requested_connection),
            None,
            false,
            Vec::new(),
        ));
    };
    if let Err((code, message)) = validate_expected_connection(&identity, &requested_connection) {
        return Ok(configuration_result(
            false,
            code,
            message,
            Some(identity.target_fingerprint),
            Some(identity.connection_id),
            None,
            false,
            Vec::new(),
        ));
    }
    let target = match resolve_mutation_target(identity, &requested_fingerprint).await {
        Ok(target) => target,
        Err((code, message)) => {
            return Ok(configuration_result(
                false,
                code,
                message,
                Some(requested_fingerprint),
                Some(requested_connection),
                None,
                false,
                Vec::new(),
            ));
        }
    };
    if let Err((code, message)) = validate_durable_mutation_target(&target) {
        return Ok(configuration_result(
            false,
            code,
            message,
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            None,
            false,
            Vec::new(),
        ));
    }
    if let Err(message) = attest_cli_version(&target.cli, &target.identity.gateway_version).await {
        return Ok(configuration_result(
            false,
            "OPENCLAW_BINARY_RUNTIME_MISMATCH",
            message,
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            None,
            false,
            Vec::new(),
        ));
    }
    let (plugin, mut warnings) = match inspect_plugin(&target.cli).await {
        Ok(result) => result,
        Err(message) => {
            return Ok(configuration_result(
                false,
                "PLUGIN_INSPECT_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                None,
                false,
                Vec::new(),
            ));
        }
    };
    if !plugin.installed || !plugin.enabled || plugin.status.as_deref() != Some("loaded") {
        return Ok(configuration_result(
            false,
            "PLUGIN_NOT_READY",
            "Install, enable, and repair junqi-collab before configuring its agents",
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            None,
            false,
            warnings,
        ));
    }
    let (registry, registry_warnings) = match read_agent_registry(&target.cli).await {
        Ok(result) => result,
        Err(message) => {
            return Ok(configuration_result(
                false,
                "AGENT_CONFIG_READ_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                None,
                false,
                warnings,
            ));
        }
    };
    warnings.extend(registry_warnings);
    let configuration = match validate_agent_configuration(&params, &registry) {
        Ok(configuration) => configuration,
        Err((code, message)) => {
            let preview = ValidatedAgentConfiguration {
                coordinator_agent_id: normalize_agent_id(&params.coordinator_agent_id),
                allowed_agent_ids: params
                    .allowed_agent_ids
                    .iter()
                    .map(|value| normalize_agent_id(value))
                    .filter(|value| !value.is_empty())
                    .collect(),
                configured_agent_ids: registry.configured_ids,
                coordinator_policy_path: None,
                coordinator_allow_agents_update: None,
            };
            return Ok(configuration_result(
                false,
                code,
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&preview),
                false,
                warnings,
            ));
        }
    };
    let batch_json = match collaboration_config_batch_json(&configuration) {
        Ok(value) => value,
        Err(message) => {
            return Ok(configuration_result(
                false,
                "CONFIG_BATCH_ENCODE_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                false,
                warnings,
            ));
        }
    };
    if let Err(message) = run_config_batch(&target.cli, &batch_json, true).await {
        return Ok(configuration_result(
            false,
            "CONFIG_DRY_RUN_FAILED",
            message,
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            Some(&configuration),
            false,
            warnings,
        ));
    }

    let Some(live_identity) = current_identity(&identity_state)? else {
        return Ok(configuration_result(
            false,
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "The Gateway disconnected before collaboration configuration was committed",
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            Some(&configuration),
            false,
            warnings,
        ));
    };
    if live_identity.target_fingerprint != target.identity.target_fingerprint
        || live_identity.connection_id != target.identity.connection_id
        || !live_identity.verified
    {
        return Ok(configuration_result(
            false,
            "TARGET_CHANGED",
            "The verified Gateway identity changed after config validation; no config was written",
            Some(live_identity.target_fingerprint),
            Some(live_identity.connection_id),
            Some(&configuration),
            false,
            warnings,
        ));
    }
    let (fresh_registry, fresh_warnings) = match read_agent_registry(&target.cli).await {
        Ok(result) => result,
        Err(message) => {
            return Ok(configuration_result(
                false,
                "AGENT_CONFIG_RECHECK_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                false,
                warnings,
            ));
        }
    };
    warnings.extend(fresh_warnings);
    match validate_agent_configuration(&params, &fresh_registry) {
        Ok(fresh) if fresh == configuration => {}
        Ok(_) => {
            return Ok(configuration_result(
                false,
                "AGENT_CONFIG_CHANGED",
                "OpenClaw agents.list changed during validation; refresh and choose agents again",
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                false,
                warnings,
            ));
        }
        Err((code, message)) => {
            return Ok(configuration_result(
                false,
                code,
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                false,
                warnings,
            ));
        }
    }
    let live_identity = current_identity(&identity_state)?;
    if let Err((code, message)) =
        validate_current_operation_identity(&target.identity, live_identity.as_ref())
    {
        return Ok(configuration_result(
            false,
            code,
            message,
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            Some(&configuration),
            false,
            warnings,
        ));
    }
    if let Err(message) = run_config_batch(&target.cli, &batch_json, false).await {
        return Ok(configuration_result(
            false,
            "CONFIG_WRITE_FAILED",
            message,
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            Some(&configuration),
            false,
            warnings,
        ));
    }
    match verify_collaboration_config_readback(&target.cli, &configuration).await {
        Ok(readback_warnings) => warnings.extend(readback_warnings),
        Err(message) => {
            return Ok(configuration_result(
                false,
                "CONFIG_READBACK_MISMATCH",
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                true,
                warnings,
            ));
        }
    }
    let (post_registry, post_warnings) = match read_agent_registry(&target.cli).await {
        Ok(result) => result,
        Err(message) => {
            return Ok(configuration_result(
                false,
                "AGENT_CONFIG_POSTCHECK_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                true,
                warnings,
            ));
        }
    };
    warnings.extend(post_warnings);
    match validate_agent_configuration(&params, &post_registry) {
        Ok(post) if post.coordinator_allow_agents_update.is_none() => {}
        Ok(_) => {
            return Ok(configuration_result(
                false,
                "COORDINATOR_POLICY_READBACK_MISMATCH",
                "The plugin config was persisted, but the coordinator policy still does not cover every selected Agent",
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                true,
                warnings,
            ));
        }
        Err((code, message)) => {
            return Ok(configuration_result(
                false,
                code,
                format!("The plugin config was persisted, but the effective Agent policy changed: {message}"),
                Some(target.identity.target_fingerprint),
                Some(target.identity.connection_id),
                Some(&configuration),
                true,
                warnings,
            ));
        }
    }
    let post_identity = current_identity(&identity_state)?;
    if post_identity.as_ref().is_none_or(|identity| {
        !identity.verified
            || identity.target_fingerprint != target.identity.target_fingerprint
            || identity.connection_id != target.identity.connection_id
    }) {
        return Ok(configuration_result(
            false,
            "TARGET_CHANGED_AFTER_WRITE",
            "The collaboration policy was persisted to the verified target, but the active Gateway connection changed before completion",
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            Some(&configuration),
            true,
            warnings,
        ));
    }
    Ok(configuration_result(
        true,
        "COLLABORATION_CONFIGURED",
        "The explicit collaboration Agent policy was validated, persisted, and scheduled for OpenClaw hot reload",
        Some(target.identity.target_fingerprint),
        Some(target.identity.connection_id),
        Some(&configuration),
        true,
        warnings,
    ))
}

#[tauri::command]
pub async fn collaboration_bootstrap_restart(
    params: BootstrapRestartParams,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
    gateway_state: State<'_, GatewayProcess>,
) -> Result<CollaborationBootstrapRestartResult, String> {
    let requested_fingerprint = params.target_fingerprint.trim().to_string();
    let requested_connection = params.expected_connection_id.trim().to_string();
    let requested_operation = params.operation_id.trim().to_string();
    let _guard = match control.try_acquire() {
        Ok(guard) => guard,
        Err(message) => {
            return Ok(restart_result(
                false,
                "BOOTSTRAP_BUSY",
                message,
                Some(requested_operation),
                Some(requested_fingerprint),
                Some(requested_connection),
                BootstrapTargetClass::Unknown,
                false,
                false,
            ));
        }
    };
    let _gateway_guard = match gateway_state.operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            return Ok(restart_result(
                false,
                "GATEWAY_OPERATION_BUSY",
                "A Gateway lifecycle, update, storage, or collaboration operation is already running",
                Some(requested_operation),
                Some(requested_fingerprint),
                Some(requested_connection),
                BootstrapTargetClass::Unknown,
                false,
                false,
            ));
        }
    };
    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(restart_result(
            false,
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "Reconnect to the exact Gateway connection that owns the pending bootstrap operation",
            Some(requested_operation),
            Some(requested_fingerprint),
            Some(requested_connection),
            BootstrapTargetClass::Unknown,
            false,
            true,
        ));
    };
    if let Err((code, message)) = validate_expected_connection(&identity, &requested_connection) {
        let class = target_class(&identity);
        return Ok(restart_result(
            false,
            code,
            message,
            Some(requested_operation),
            Some(identity.target_fingerprint),
            Some(identity.connection_id),
            class,
            false,
            true,
        ));
    }
    let target = match resolve_mutation_target(identity, &requested_fingerprint).await {
        Ok(target) => target,
        Err((code, message)) => {
            return Ok(restart_result(
                false,
                code,
                message,
                Some(requested_operation),
                Some(requested_fingerprint),
                Some(requested_connection),
                BootstrapTargetClass::Unknown,
                false,
                true,
            ));
        }
    };
    if let Err((code, message)) = validate_durable_mutation_target(&target) {
        return Ok(restart_result(
            false,
            code,
            message,
            Some(requested_operation),
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            target.class,
            false,
            true,
        ));
    }
    let Some(mut journal) = control.load_journal()? else {
        return Ok(restart_result(
            false,
            "BOOTSTRAP_JOURNAL_MISSING",
            "The bootstrap operation journal is unavailable",
            Some(requested_operation),
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            target.class,
            false,
            false,
        ));
    };
    if let Err((code, message)) =
        validate_restart_journal(&journal, &target.identity, &params, target.class)
    {
        return Ok(restart_result(
            false,
            code,
            message,
            Some(journal.operation_id),
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            target.class,
            false,
            journal.health_pending,
        ));
    }
    if let Err(message) = attest_cli_version(&target.cli, &target.identity.gateway_version).await {
        return Ok(restart_result(
            false,
            "OPENCLAW_BINARY_RUNTIME_MISMATCH",
            message,
            Some(journal.operation_id),
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            target.class,
            false,
            journal.health_pending,
        ));
    }
    let Some(live_identity) = current_identity(&identity_state)? else {
        return Ok(restart_result(
            false,
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "The Gateway disconnected before the restart command was issued",
            Some(journal.operation_id),
            Some(target.identity.target_fingerprint),
            Some(target.identity.connection_id),
            target.class,
            false,
            journal.health_pending,
        ));
    };
    if live_identity.target_fingerprint != target.identity.target_fingerprint
        || live_identity.connection_id != target.identity.connection_id
        || !live_identity.verified
    {
        return Ok(restart_result(
            false,
            "TARGET_CHANGED",
            "The verified Gateway identity changed during restart preflight; no restart was issued",
            Some(journal.operation_id),
            Some(live_identity.target_fingerprint),
            Some(live_identity.connection_id),
            target.class,
            false,
            journal.health_pending,
        ));
    }

    let connection_id = target.identity.connection_id.clone();
    journal.record_step("gateway_restart", "started", Some(connection_id.clone()));
    if let Err(message) = control.save_journal(&journal) {
        return Ok(restart_result(
            false,
            "BOOTSTRAP_JOURNAL_WRITE_FAILED",
            message,
            Some(journal.operation_id),
            Some(target.identity.target_fingerprint),
            Some(connection_id),
            target.class,
            false,
            journal.health_pending,
        ));
    }

    let previous_runtime = gateway_state.runtime_snapshot()?;
    struct RestartFlagGuard<'a> {
        state: &'a GatewayProcess,
        previous: bool,
    }
    impl Drop for RestartFlagGuard<'_> {
        fn drop(&mut self) {
            self.state.transition(
                None,
                None,
                Some(self.previous),
                "collaboration_bootstrap_restart: restart flag released",
            );
        }
    }
    gateway_state.transition(
        Some(crate::state::gateway_process::GatewayLifecycle::Reconnecting),
        None,
        Some(true),
        "collaboration_bootstrap_restart: exact target restart requested",
    );
    let _restart_flag = RestartFlagGuard {
        state: &gateway_state,
        previous: previous_runtime.restarting,
    };

    let restart = match target.class {
        BootstrapTargetClass::SystemService => restart_system_service_target(&target.cli).await,
        BootstrapTargetClass::Docker => restart_docker_target().await,
        _ => unreachable!("durable target validation limits restart classes"),
    };
    use std::sync::atomic::Ordering;
    gateway_state
        .restart_completed_generation
        .fetch_add(1, Ordering::AcqRel);
    if let Err((code, message)) = restart {
        let uncertain = code == "GATEWAY_RESTART_UNCERTAIN";
        let diagnostic = message.chars().take(2_048).collect::<String>();
        journal.record_step(
            "gateway_restart",
            if uncertain { "uncertain" } else { "failed" },
            Some(diagnostic.clone()),
        );
        journal.add_diagnostic(diagnostic);
        let _ = control.save_journal(&journal);
        if uncertain {
            gateway_state.transition(
                Some(crate::state::gateway_process::GatewayLifecycle::Reconnecting),
                Some(previous_runtime.mode),
                None,
                "collaboration_bootstrap_restart: restart outcome is uncertain",
            );
            let _ = identity_state.invalidate(&connection_id);
        } else {
            gateway_state.transition(
                Some(previous_runtime.lifecycle),
                Some(previous_runtime.mode),
                None,
                "collaboration_bootstrap_restart: exact target restart failed",
            );
        }
        return Ok(restart_result(
            false,
            code,
            message,
            Some(journal.operation_id),
            Some(target.identity.target_fingerprint),
            Some(connection_id),
            target.class,
            uncertain,
            journal.health_pending,
        ));
    }

    let rollback_completed = journal.status == BootstrapJournalStatus::RolledBack;
    journal.record_step("gateway_restart", "requested", Some(connection_id.clone()));
    if rollback_completed {
        journal.restart_required = false;
        journal.health_pending = false;
        journal.record_step("rollback_restart", "completed", None);
    }
    let journal_save_error = control.save_journal(&journal).err();
    let runtime_mode = match target.class {
        BootstrapTargetClass::SystemService => {
            crate::state::gateway_process::GatewayRuntimeMode::SystemService
        }
        BootstrapTargetClass::Docker => crate::state::gateway_process::GatewayRuntimeMode::Docker,
        _ => unreachable!("durable target validation limits restart classes"),
    };
    gateway_state.transition(
        Some(crate::state::gateway_process::GatewayLifecycle::Running),
        Some(runtime_mode),
        None,
        "collaboration_bootstrap_restart: exact target restart command succeeded",
    );
    let identity_invalidation_error = identity_state.invalidate(&connection_id).err();
    if let Some(message) = journal_save_error.or(identity_invalidation_error) {
        return Ok(restart_result(
            false,
            "RESTART_POSTCOMMIT_FAILED",
            format!(
                "The exact Gateway restart was issued, but Desktop could not persist all post-restart state: {message}"
            ),
            Some(journal.operation_id),
            Some(target.identity.target_fingerprint),
            Some(connection_id),
            target.class,
            true,
            journal.health_pending,
        ));
    }
    Ok(restart_result(
        true,
        if rollback_completed {
            "ROLLBACK_GATEWAY_RESTARTED"
        } else {
            "GATEWAY_RESTART_REQUESTED"
        },
        if rollback_completed {
            "The exact Gateway target restarted with the rolled-back plugin state"
        } else {
            "The exact Gateway target restarted; reconnect and confirm the advertised collaboration capabilities"
        },
        Some(journal.operation_id),
        Some(target.identity.target_fingerprint),
        Some(connection_id),
        target.class,
        true,
        journal.health_pending,
    ))
}

#[tauri::command]
pub async fn collaboration_bootstrap_status(
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
) -> Result<CollaborationBootstrapStatus, String> {
    let busy = control.busy();
    let journal = control.load_journal()?;
    let recovery_required = !busy
        && journal
            .as_ref()
            .map(|journal| {
                matches!(
                    journal.status,
                    BootstrapJournalStatus::Running | BootstrapJournalStatus::RecoveryRequired
                )
            })
            .unwrap_or(false);
    let recoverable = journal
        .as_ref()
        .map(|journal| journal.status != BootstrapJournalStatus::RolledBack)
        .unwrap_or(false);
    Ok(CollaborationBootstrapStatus {
        busy,
        recovery_required,
        recoverable,
        target_fingerprint: current_identity(&identity_state)?
            .map(|identity| identity.target_fingerprint),
        journal,
    })
}

fn validate_confirmed_capabilities(
    params: &BootstrapConfirmHealthParams,
    journal: &CollaborationBootstrapJournal,
) -> Result<(), (String, String)> {
    let metadata = parse_bundled_metadata(BUNDLED_METADATA_JSON.as_bytes()).map_err(|message| {
        (
            "PLUGIN_BUNDLE_EMBEDDED_METADATA_INVALID".to_string(),
            message,
        )
    })?;
    if journal.package.plugin_id != metadata.plugin_id
        || journal.package.plugin_version != metadata.plugin_version
        || journal.package.sha256 != metadata.sha256
        || params.plugin_version.trim() != metadata.plugin_version
    {
        return Err((
            "COLLABORATION_PLUGIN_VERSION_MISMATCH".to_string(),
            "The loaded collaboration plugin does not match this JunQi binary's embedded bundle"
                .to_string(),
        ));
    }
    if params.schema_version != metadata.schema_version {
        return Err((
            "COLLABORATION_SCHEMA_VERSION_MISMATCH".to_string(),
            format!(
                "The loaded collaboration schema must be exactly {}, but the Gateway reported {}",
                metadata.schema_version, params.schema_version
            ),
        ));
    }
    if !params.durable_state {
        return Err((
            "COLLABORATION_DURABLE_STATE_REQUIRED".to_string(),
            "The collaboration plugin did not confirm durable state".to_string(),
        ));
    }
    if !params.durable_runtime || !params.durable_runtime_supported {
        return Err((
            "COLLABORATION_DURABLE_RUNTIME_REQUIRED".to_string(),
            "The collaboration plugin did not confirm a supported durable runtime".to_string(),
        ));
    }
    if params.feature_evidence_kind != "DECLARED_PLUGIN_CONTRACT"
        || params.feature_evidence_behavior_verified
        || params.feature_evidence_required_behavior_gate != "ISOLATED_REAL_GATEWAY"
        || !params.feature_evidence_plugin_service_started
        || params.feature_evidence_database_integrity != "ok"
    {
        return Err((
            "COLLABORATION_FEATURE_EVIDENCE_INVALID".to_string(),
            "The collaboration plugin did not provide the capability evidence required by this JunQi build"
                .to_string(),
        ));
    }
    let missing_features = REQUIRED_COLLABORATION_FEATURES
        .iter()
        .filter(|feature| params.features.get(**feature) != Some(&true))
        .copied()
        .collect::<Vec<_>>();
    if !missing_features.is_empty() {
        return Err((
            "COLLABORATION_FEATURES_MISSING".to_string(),
            format!(
                "The collaboration plugin is missing required features: {}",
                missing_features.join(", ")
            ),
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn collaboration_bootstrap_confirm_health(
    params: BootstrapConfirmHealthParams,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
    gateway_state: State<'_, GatewayProcess>,
) -> Result<CollaborationBootstrapResult, String> {
    let _guard = match control.try_acquire() {
        Ok(guard) => guard,
        Err(message) => {
            return Ok(mutation_error(
                "BOOTSTRAP_BUSY",
                message,
                Some(params.target_fingerprint),
                Some(params.operation_id),
                false,
            ));
        }
    };
    let _gateway_guard = match gateway_state.operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            return Ok(mutation_error(
                "GATEWAY_OPERATION_BUSY",
                "A Gateway lifecycle, update, or storage operation is already running",
                Some(params.target_fingerprint),
                Some(params.operation_id),
                false,
            ));
        }
    };
    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(mutation_error(
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "Reconnect to the target Gateway before confirming collaboration health",
            Some(params.target_fingerprint),
            Some(params.operation_id),
            true,
        ));
    };
    if let Err(code) = validate_fingerprint(&identity, &params.target_fingerprint) {
        return Ok(mutation_error(
            code,
            "The active Gateway target changed before collaboration health was confirmed",
            Some(identity.target_fingerprint),
            Some(params.operation_id),
            true,
        ));
    }
    if let Err((code, message)) =
        validate_expected_connection(&identity, &params.expected_connection_id)
    {
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(params.operation_id),
            true,
        ));
    }
    if let Err((code, message)) = validate_durable_identity(&identity, target_class(&identity)) {
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(params.operation_id),
            true,
        ));
    }
    let Some(mut journal) = control.load_journal()? else {
        return Ok(mutation_error(
            "BOOTSTRAP_JOURNAL_MISSING",
            "The bootstrap operation journal is unavailable",
            Some(identity.target_fingerprint),
            Some(params.operation_id),
            false,
        ));
    };
    let operation_id = params.operation_id.trim();
    if let Err(message) = validate_bootstrap_operation_id(operation_id) {
        return Ok(mutation_error(
            "BOOTSTRAP_OPERATION_INVALID",
            message,
            Some(identity.target_fingerprint),
            Some(params.operation_id),
            true,
        ));
    }
    if journal.operation_id != operation_id
        || journal.target.target_fingerprint != identity.target_fingerprint
    {
        return Ok(mutation_error(
            "BOOTSTRAP_OPERATION_MISMATCH",
            "The health response does not belong to the current bootstrap operation and Gateway target",
            Some(identity.target_fingerprint),
            Some(params.operation_id),
            true,
        ));
    }
    if journal.target.connection_id == identity.connection_id {
        return Ok(mutation_error(
            "GATEWAY_RESTART_NOT_OBSERVED",
            "The active Gateway connection predates the plugin apply; restart the target Gateway before confirming health",
            Some(identity.target_fingerprint),
            Some(journal.operation_id),
            true,
        ));
    }
    if journal.status != BootstrapJournalStatus::Completed {
        return Ok(mutation_error(
            "BOOTSTRAP_NOT_APPLIED",
            "Only a completed plugin apply can be health-confirmed",
            Some(identity.target_fingerprint),
            Some(journal.operation_id),
            true,
        ));
    }
    let live_identity = current_identity(&identity_state)?;
    if let Err((code, message)) =
        validate_current_operation_identity(&identity, live_identity.as_ref())
    {
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(journal.operation_id),
            true,
        ));
    }
    if !journal.health_pending {
        let instance_id = params.collaboration_instance_id.trim();
        let replay_matches = identity
            .methods
            .iter()
            .any(|method| method == "junqi.collab.capabilities")
            && validate_confirmed_capabilities(&params, &journal).is_ok()
            && journal.health.as_ref().is_some_and(|health| {
                health.collaboration_instance_id == instance_id
                    && health.plugin_version == params.plugin_version.trim()
                    && health.schema_version == params.schema_version
            });
        if !replay_matches {
            return Ok(mutation_error(
                "BOOTSTRAP_HEALTH_REPLAY_MISMATCH",
                "The repeated health confirmation does not match the capability contract already recorded for this operation",
                Some(identity.target_fingerprint),
                Some(journal.operation_id),
                false,
            ));
        }
        return Ok(CollaborationBootstrapResult {
            ok: true,
            code: "BOOTSTRAP_HEALTH_ALREADY_CONFIRMED".to_string(),
            message: "Collaboration health was already confirmed for this operation".to_string(),
            operation_id: Some(journal.operation_id),
            target_fingerprint: Some(identity.target_fingerprint),
            action: Some("confirm_health".to_string()),
            plugin: Some(BootstrapPluginSnapshot {
                installed: true,
                enabled: true,
                status: Some("gateway_healthy".to_string()),
                version: Some(journal.package.plugin_version),
                ..BootstrapPluginSnapshot::default()
            }),
            restart_required: false,
            health_pending: false,
            recoverable: true,
            warnings: Vec::new(),
        });
    }
    if !identity
        .methods
        .iter()
        .any(|method| method == "junqi.collab.capabilities")
    {
        let code = "COLLABORATION_RPC_NOT_ADVERTISED";
        let message = "The active Gateway does not advertise junqi.collab.capabilities";
        journal_failure(&control, &mut journal, code, message)?;
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(journal.operation_id),
            true,
        ));
    }
    let instance_id = params.collaboration_instance_id.trim();
    if instance_id.is_empty() || instance_id.len() > 128 {
        let code = "COLLABORATION_INSTANCE_ID_INVALID";
        let message = "The collaboration capability response omitted a valid runtime instance id";
        journal_failure(&control, &mut journal, code, message)?;
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(journal.operation_id),
            true,
        ));
    }
    if let Err((code, message)) = validate_confirmed_capabilities(&params, &journal) {
        journal_failure(&control, &mut journal, &code, &message)?;
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(journal.operation_id),
            true,
        ));
    }

    journal.health_pending = false;
    journal.restart_required = false;
    journal.health = Some(BootstrapHealthSnapshot {
        collaboration_instance_id: instance_id.to_string(),
        plugin_version: params.plugin_version.trim().to_string(),
        schema_version: params.schema_version,
        confirmed_at_ms: chrono::Utc::now().timestamp_millis(),
    });
    journal.record_step("gateway_capabilities", "confirmed", None);
    control.save_journal(&journal)?;
    Ok(CollaborationBootstrapResult {
        ok: true,
        code: "BOOTSTRAP_HEALTH_CONFIRMED".to_string(),
        message: "The active Gateway loaded the expected durable collaboration plugin".to_string(),
        operation_id: Some(journal.operation_id),
        target_fingerprint: Some(identity.target_fingerprint),
        action: Some("confirm_health".to_string()),
        plugin: Some(BootstrapPluginSnapshot {
            installed: true,
            enabled: true,
            status: Some("gateway_healthy".to_string()),
            version: Some(journal.package.plugin_version),
            ..BootstrapPluginSnapshot::default()
        }),
        restart_required: false,
        health_pending: false,
        recoverable: true,
        warnings: Vec::new(),
    })
}

#[tauri::command]
pub async fn collaboration_bootstrap_probe(
    params: Option<BootstrapProbeParams>,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
) -> Result<CollaborationBootstrapProbe, String> {
    let params = params.unwrap_or_default();
    let busy = control.busy();
    let journal = control.load_journal()?;
    let recovery_required = !busy
        && journal
            .as_ref()
            .map(|journal| {
                matches!(
                    journal.status,
                    BootstrapJournalStatus::Running | BootstrapJournalStatus::RecoveryRequired
                )
            })
            .unwrap_or(false);
    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(CollaborationBootstrapProbe {
            ok: false,
            code: "RUNTIME_IDENTITY_UNAVAILABLE".to_string(),
            message: "Connect to an OpenClaw Gateway and complete its handshake before probing collaboration"
                .to_string(),
            target_fingerprint: None,
            connection_id: None,
            target_class: BootstrapTargetClass::Unknown,
            deployment_kind: None,
            ownership: None,
            gateway_version: None,
            durable_runtime: false,
            mutation_allowed: false,
            manual_install_required: false,
            binary_path: None,
            state_dir: None,
            config_path: None,
            plugin: BootstrapPluginSnapshot::default(),
            warnings: Vec::new(),
            manual_install_instructions: None,
            busy,
            recovery_required,
            durable_collaboration_state: DurableCollaborationState::Unknown,
        });
    };

    if let Err((code, message)) = validate_probe_identity(&identity, &params) {
        let class = target_class(&identity);
        return Ok(CollaborationBootstrapProbe {
            ok: false,
            code: code.to_string(),
            message: message.to_string(),
            target_fingerprint: Some(identity.target_fingerprint),
            connection_id: Some(identity.connection_id),
            target_class: class,
            deployment_kind: Some(deployment_name(identity.deployment_kind).to_string()),
            ownership: Some(ownership_name(identity.ownership).to_string()),
            gateway_version: Some(identity.gateway_version),
            durable_runtime: false,
            mutation_allowed: false,
            manual_install_required: false,
            binary_path: None,
            state_dir: None,
            config_path: None,
            plugin: BootstrapPluginSnapshot::default(),
            warnings: Vec::new(),
            manual_install_instructions: None,
            busy,
            recovery_required,
            durable_collaboration_state: DurableCollaborationState::Unknown,
        });
    }

    let class = target_class(&identity);
    let external = matches!(
        class,
        BootstrapTargetClass::ExternalLocal | BootstrapTargetClass::ExternalRemote
    );
    if external {
        let capability_available = identity
            .methods
            .iter()
            .any(|method| method == "junqi.collab.capabilities");
        return Ok(CollaborationBootstrapProbe {
            ok: true,
            code: if capability_available {
                "EXTERNAL_PLUGIN_AVAILABLE"
            } else {
                "EXTERNAL_TARGET_MANUAL"
            }
            .to_string(),
            message: if capability_available {
                "The externally managed Gateway advertises the collaboration RPC; validate its capabilities through the active connection"
            } else {
                "The active Gateway is externally managed; JunQi will only provide pinned manual installation instructions"
            }
            .to_string(),
            target_fingerprint: Some(identity.target_fingerprint),
            connection_id: Some(identity.connection_id),
            target_class: class,
            deployment_kind: Some(deployment_name(identity.deployment_kind).to_string()),
            ownership: Some(ownership_name(identity.ownership).to_string()),
            gateway_version: Some(identity.gateway_version),
            durable_runtime: true,
            mutation_allowed: false,
            manual_install_required: !capability_available,
            binary_path: None,
            state_dir: identity.state_dir,
            config_path: identity.config_path,
            plugin: BootstrapPluginSnapshot {
                installed: capability_available,
                enabled: capability_available,
                status: capability_available.then(|| "gateway_available".to_string()),
                ..BootstrapPluginSnapshot::default()
            },
            warnings: Vec::new(),
            manual_install_instructions: (!capability_available).then(|| {
                "On the target runtime, verify the published SHA-256, then run: openclaw plugins install --force --pin <junqi-collab.tgz>; openclaw plugins enable junqi-collab; restart that Gateway"
                    .to_string()
            }),
            busy,
            recovery_required,
            durable_collaboration_state: DurableCollaborationState::Unknown,
        });
    }

    if busy {
        return Ok(CollaborationBootstrapProbe {
            ok: false,
            code: "BOOTSTRAP_BUSY".to_string(),
            message: "A collaboration bootstrap operation is already running".to_string(),
            target_fingerprint: Some(identity.target_fingerprint),
            connection_id: Some(identity.connection_id),
            target_class: class,
            deployment_kind: Some(deployment_name(identity.deployment_kind).to_string()),
            ownership: Some(ownership_name(identity.ownership).to_string()),
            gateway_version: Some(identity.gateway_version),
            durable_runtime: is_durable(class),
            mutation_allowed: false,
            manual_install_required: false,
            binary_path: None,
            state_dir: Some(identity.local_state_dir),
            config_path: Some(identity.local_config_path),
            plugin: BootstrapPluginSnapshot::default(),
            warnings: Vec::new(),
            manual_install_instructions: None,
            busy,
            recovery_required,
            durable_collaboration_state: DurableCollaborationState::Unknown,
        });
    }

    let current_fingerprint = identity.target_fingerprint.clone();
    let current_connection_id = identity.connection_id.clone();
    let target = match resolve_mutation_target(identity, &current_fingerprint).await {
        Ok(target) => target,
        Err((code, message)) => {
            return Ok(CollaborationBootstrapProbe {
                ok: false,
                code,
                message,
                target_fingerprint: Some(current_fingerprint),
                connection_id: Some(current_connection_id),
                target_class: class,
                deployment_kind: None,
                ownership: None,
                gateway_version: None,
                durable_runtime: is_durable(class),
                mutation_allowed: false,
                manual_install_required: false,
                binary_path: None,
                state_dir: None,
                config_path: None,
                plugin: BootstrapPluginSnapshot::default(),
                warnings: Vec::new(),
                manual_install_instructions: None,
                busy,
                recovery_required,
                durable_collaboration_state: DurableCollaborationState::Unknown,
            });
        }
    };
    if let Err(message) = attest_cli_version(&target.cli, &target.identity.gateway_version).await {
        return Ok(CollaborationBootstrapProbe {
            ok: false,
            code: "OPENCLAW_BINARY_RUNTIME_MISMATCH".to_string(),
            message,
            target_fingerprint: Some(target.identity.target_fingerprint),
            connection_id: Some(target.identity.connection_id),
            target_class: target.class,
            deployment_kind: Some(deployment_name(target.identity.deployment_kind).to_string()),
            ownership: Some(ownership_name(target.identity.ownership).to_string()),
            gateway_version: Some(target.identity.gateway_version),
            durable_runtime: is_durable(target.class),
            mutation_allowed: false,
            manual_install_required: false,
            binary_path: Some(target.cli.binary.to_string_lossy().to_string()),
            state_dir: Some(target.cli.state_dir.to_string_lossy().to_string()),
            config_path: Some(target.cli.config_path.to_string_lossy().to_string()),
            plugin: BootstrapPluginSnapshot::default(),
            warnings: Vec::new(),
            manual_install_instructions: None,
            busy,
            recovery_required,
            durable_collaboration_state: DurableCollaborationState::Unknown,
        });
    }
    let (plugin, warnings) = match inspect_plugin(&target.cli).await {
        Ok(result) => result,
        Err(error) => {
            return Ok(CollaborationBootstrapProbe {
                ok: false,
                code: "PLUGIN_INSPECT_FAILED".to_string(),
                message: error,
                target_fingerprint: Some(target.identity.target_fingerprint),
                connection_id: Some(target.identity.connection_id),
                target_class: target.class,
                deployment_kind: Some(deployment_name(target.identity.deployment_kind).to_string()),
                ownership: Some(ownership_name(target.identity.ownership).to_string()),
                gateway_version: Some(target.identity.gateway_version),
                durable_runtime: is_durable(target.class),
                mutation_allowed: false,
                manual_install_required: false,
                binary_path: Some(target.cli.binary.to_string_lossy().to_string()),
                state_dir: Some(target.cli.state_dir.to_string_lossy().to_string()),
                config_path: Some(target.cli.config_path.to_string_lossy().to_string()),
                plugin: BootstrapPluginSnapshot::default(),
                warnings: Vec::new(),
                manual_install_instructions: None,
                busy,
                recovery_required,
                durable_collaboration_state: DurableCollaborationState::Unknown,
            });
        }
    };
    let ready = plugin.installed && plugin.enabled && plugin.status.as_deref() == Some("loaded");
    let durable_collaboration_state =
        inspect_durable_collaboration_state(Path::new(&target.identity.local_state_dir));
    if !plugin.installed {
        let live_identity = current_identity(&identity_state)?;
        let stable = live_identity.as_ref().is_some_and(|identity| {
            same_probe_identity(&target.identity, identity)
                && validate_probe_identity(identity, &params).is_ok()
        });
        if !stable {
            return Ok(CollaborationBootstrapProbe {
                ok: false,
                code: "CONNECTION_CHANGED_DURING_PROBE".to_string(),
                message: "The active Gateway identity changed while durable collaboration state was inspected"
                    .to_string(),
                target_fingerprint: Some(target.identity.target_fingerprint),
                connection_id: Some(target.identity.connection_id),
                target_class: target.class,
                deployment_kind: Some(
                    deployment_name(target.identity.deployment_kind).to_string(),
                ),
                ownership: Some(ownership_name(target.identity.ownership).to_string()),
                gateway_version: Some(target.identity.gateway_version),
                durable_runtime: is_durable(target.class),
                mutation_allowed: false,
                manual_install_required: false,
                binary_path: Some(target.cli.binary.to_string_lossy().to_string()),
                state_dir: Some(target.cli.state_dir.to_string_lossy().to_string()),
                config_path: Some(target.cli.config_path.to_string_lossy().to_string()),
                plugin,
                warnings,
                manual_install_instructions: None,
                busy,
                recovery_required,
                durable_collaboration_state: DurableCollaborationState::Unknown,
            });
        }
    }
    let missing_code = match (durable_collaboration_state, warnings.is_empty()) {
        (DurableCollaborationState::Absent, true) => "PLUGIN_MISSING",
        (DurableCollaborationState::Absent, false) => "PLUGIN_MISSING_PROBE_WARNINGS",
        (DurableCollaborationState::Present, _) => "PLUGIN_MISSING_STATE_PRESENT",
        (DurableCollaborationState::Corrupt, _) => "PLUGIN_MISSING_STATE_CORRUPT",
        (DurableCollaborationState::Unknown, _) => "PLUGIN_MISSING_STATE_UNKNOWN",
    };
    Ok(CollaborationBootstrapProbe {
        ok: true,
        code: if ready {
            "PLUGIN_READY"
        } else if plugin.installed {
            "PLUGIN_NEEDS_REPAIR"
        } else {
            missing_code
        }
        .to_string(),
        message: if ready {
            "The collaboration plugin is installed and loadable"
        } else if plugin.installed {
            "The collaboration plugin is installed but disabled or unhealthy"
        } else {
            match durable_collaboration_state {
                DurableCollaborationState::Absent if warnings.is_empty() => {
                    "The collaboration plugin and its durable state are absent"
                }
                DurableCollaborationState::Absent => {
                    "The collaboration plugin is absent, but its inspection emitted warnings"
                }
                DurableCollaborationState::Present => {
                    "The collaboration plugin is not installed, but durable collaboration state remains"
                }
                DurableCollaborationState::Corrupt => {
                    "The collaboration plugin is not installed, but its durable state path is invalid"
                }
                DurableCollaborationState::Unknown => {
                    "The collaboration plugin is not installed, but durable state could not be inspected"
                }
            }
        }
        .to_string(),
        target_fingerprint: Some(target.identity.target_fingerprint),
        connection_id: Some(target.identity.connection_id),
        target_class: target.class,
        deployment_kind: Some(deployment_name(target.identity.deployment_kind).to_string()),
        ownership: Some(ownership_name(target.identity.ownership).to_string()),
        gateway_version: Some(target.identity.gateway_version),
        durable_runtime: is_durable(target.class),
        mutation_allowed: target.identity.desktop_mutation_allowed && !recovery_required,
        manual_install_required: false,
        binary_path: Some(target.cli.binary.to_string_lossy().to_string()),
        state_dir: Some(target.cli.state_dir.to_string_lossy().to_string()),
        config_path: Some(target.cli.config_path.to_string_lossy().to_string()),
        plugin,
        warnings,
        manual_install_instructions: None,
        busy,
        recovery_required,
        durable_collaboration_state,
    })
}

#[tauri::command]
pub async fn collaboration_bootstrap_apply(
    params: BootstrapApplyParams,
    app: AppHandle,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
    gateway_state: State<'_, GatewayProcess>,
) -> Result<CollaborationBootstrapResult, String> {
    let _guard = match control.try_acquire() {
        Ok(guard) => guard,
        Err(message) => {
            return Ok(mutation_error(
                "BOOTSTRAP_BUSY",
                message,
                Some(params.target_fingerprint),
                None,
                false,
            ));
        }
    };
    let _gateway_guard = match gateway_state.operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            return Ok(mutation_error(
                "GATEWAY_OPERATION_BUSY",
                "A Gateway lifecycle, update, or storage operation is already running",
                Some(params.target_fingerprint),
                None,
                false,
            ));
        }
    };
    let existing = control.load_journal()?;
    if existing_journal_blocks_apply(existing.as_ref()) {
        return Ok(mutation_error(
            "BOOTSTRAP_RECOVERY_REQUIRED",
            "The previous bootstrap operation must be health-confirmed, resumed, or rolled back before applying another package",
            Some(params.target_fingerprint),
            existing.map(|journal| journal.operation_id),
            true,
        ));
    }
    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(mutation_error(
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "Connect to the target Gateway before installing the collaboration plugin",
            Some(params.target_fingerprint),
            None,
            false,
        ));
    };
    if let Err((code, message)) =
        validate_expected_connection(&identity, &params.expected_connection_id)
    {
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            None,
            false,
        ));
    }
    let target = match resolve_mutation_target(identity, &params.target_fingerprint).await {
        Ok(target) => target,
        Err((code, message)) => {
            return Ok(mutation_error(
                code,
                message,
                Some(params.target_fingerprint),
                None,
                false,
            ));
        }
    };
    if let Err((code, message)) = validate_durable_mutation_target(&target) {
        return Ok(mutation_error(
            code,
            message,
            Some(target.identity.target_fingerprint),
            None,
            false,
        ));
    }
    if let Err(message) = attest_cli_version(&target.cli, &target.identity.gateway_version).await {
        return Ok(mutation_error(
            "OPENCLAW_BINARY_RUNTIME_MISMATCH",
            message,
            Some(target.identity.target_fingerprint),
            None,
            false,
        ));
    }
    let source_package = match verify_bundled_package(&app) {
        Ok(package) => package,
        Err((code, message)) => {
            return Ok(mutation_error(
                code,
                message,
                Some(target.identity.target_fingerprint),
                None,
                false,
            ));
        }
    };
    let (original_plugin, mut warnings) = match inspect_plugin(&target.cli).await {
        Ok(result) => result,
        Err(message) => {
            return Ok(mutation_error(
                "PLUGIN_INSPECT_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                None,
                false,
            ));
        }
    };
    let operation_id = uuid::Uuid::new_v4().to_string();
    let package = match stage_package(&control, &target, &operation_id, source_package) {
        Ok(package) => package,
        Err(message) => {
            let message = message_with_preflight_cleanup(&control, &target, &operation_id, message);
            return Ok(mutation_error(
                "PLUGIN_STAGE_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(operation_id),
                false,
            ));
        }
    };
    let original_plugin_backup =
        match backup_original_plugin_archive(&control, &target, &operation_id, &original_plugin) {
            Ok(backup) => backup,
            Err(message) => {
                let message =
                    message_with_preflight_cleanup(&control, &target, &operation_id, message);
                return Ok(mutation_error(
                    "ROLLBACK_SNAPSHOT_FAILED",
                    message,
                    Some(target.identity.target_fingerprint),
                    Some(operation_id),
                    false,
                ));
            }
        };
    let config_backup = match backup_config(&control, &operation_id, &target.cli.config_path) {
        Ok(path) => path,
        Err(message) => {
            let message = message_with_preflight_cleanup(&control, &target, &operation_id, message);
            return Ok(mutation_error(
                "CONFIG_BACKUP_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(operation_id),
                false,
            ));
        }
    };
    let original_config_sha256 = match config_backup.as_deref() {
        Some(path) => match hash_file(Path::new(path), MAX_CONFIG_BACKUP_BYTES) {
            Ok(hash) => hash,
            Err(message) => {
                let message =
                    message_with_preflight_cleanup(&control, &target, &operation_id, message);
                return Ok(mutation_error(
                    "CONFIG_SNAPSHOT_FAILED",
                    message,
                    Some(target.identity.target_fingerprint),
                    Some(operation_id),
                    false,
                ));
            }
        },
        None if !target.cli.config_path.exists() => "missing".to_string(),
        None => {
            let message = message_with_preflight_cleanup(
                &control,
                &target,
                &operation_id,
                "The target OpenClaw config appeared during bootstrap preflight; retry the operation",
            );
            return Ok(mutation_error(
                "CONFIG_SNAPSHOT_RACED",
                message,
                Some(target.identity.target_fingerprint),
                Some(operation_id),
                false,
            ));
        }
    };
    let action = if original_plugin.installed {
        "update"
    } else {
        "install"
    };
    let live_identity = current_identity(&identity_state)?;
    if let Err((code, message)) =
        validate_current_operation_identity(&target.identity, live_identity.as_ref())
    {
        let message = message_with_preflight_cleanup(&control, &target, &operation_id, message);
        return Ok(mutation_error(
            code,
            message,
            Some(target.identity.target_fingerprint),
            Some(operation_id),
            false,
        ));
    }
    let mut journal = new_journal(
        &target,
        &package,
        original_plugin,
        original_config_sha256,
        operation_id.clone(),
        config_backup,
        original_plugin_backup,
    );
    journal.record_step("preflight", "completed", None);
    control.save_journal(&journal)?;

    match install_enable_inspect(&control, &mut journal, &target.cli).await {
        Ok((plugin, install_warnings)) => {
            warnings.extend(install_warnings);
            if let Err(message) =
                persist_bootstrap_owned_config_hash(&control, &mut journal, &target.cli.config_path)
            {
                journal_failure(
                    &control,
                    &mut journal,
                    "CONFIG_OWNERSHIP_FENCE_FAILED",
                    &message,
                )?;
                return Ok(mutation_error(
                    "CONFIG_OWNERSHIP_FENCE_FAILED",
                    message,
                    Some(target.identity.target_fingerprint),
                    Some(operation_id),
                    true,
                ));
            }
            journal.status = BootstrapJournalStatus::Completed;
            journal.restart_required = true;
            journal.health_pending = true;
            journal.record_step("apply", "completed", None);
            control.save_journal(&journal)?;
            Ok(CollaborationBootstrapResult {
                ok: true,
                code: "BOOTSTRAP_APPLIED".to_string(),
                message: "The collaboration plugin is installed and loadable; restart the active Gateway, then confirm junqi.collab.capabilities"
                    .to_string(),
                operation_id: Some(operation_id),
                target_fingerprint: Some(target.identity.target_fingerprint),
                action: Some(action.to_string()),
                plugin: Some(plugin),
                restart_required: true,
                health_pending: true,
                recoverable: true,
                warnings,
            })
        }
        Err(message) => {
            journal_failure(&control, &mut journal, "BOOTSTRAP_APPLY_FAILED", &message)?;
            Ok(mutation_error(
                "BOOTSTRAP_APPLY_FAILED",
                message,
                Some(target.identity.target_fingerprint),
                Some(operation_id),
                true,
            ))
        }
    }
}

async fn recovery_target(
    journal: &CollaborationBootstrapJournal,
    identity: RuntimeIdentity,
    expected_fingerprint: &str,
) -> Result<MutationTarget, (String, String)> {
    validate_bootstrap_operation_id(&journal.operation_id).map_err(|message| {
        (
            "RECOVERY_OPERATION_INVALID".to_string(),
            format!("The bootstrap journal operation id is invalid: {message}"),
        )
    })?;
    let mut target = resolve_mutation_target(identity, expected_fingerprint).await?;
    validate_durable_mutation_target(&target)?;
    if target.identity.target_fingerprint != journal.target.target_fingerprint
        || target.identity.connection_id != journal.target.connection_id
        || deployment_name(target.identity.deployment_kind) != journal.target.deployment_kind
        || ownership_name(target.identity.ownership) != journal.target.ownership
        || target.cli.binary.to_string_lossy() != journal.target.binary_path
        || target.identity.local_state_dir != journal.target.state_dir
        || target.identity.local_config_path != journal.target.config_path
    {
        return Err((
            "RECOVERY_TARGET_CHANGED".to_string(),
            "The bootstrap journal target, connection, executable, or local runtime paths no longer match the verified target".to_string(),
        ));
    }
    target.cli = if target.class == BootstrapTargetClass::Docker {
        PinnedOpenClawCliTarget::verified_container(
            Path::new(&journal.target.binary_path),
            Path::new(&journal.target.state_dir),
            Path::new(&journal.target.config_path),
            OPENCLAW_CONTAINER_NAME,
        )
    } else {
        PinnedOpenClawCliTarget::verified(
            Path::new(&journal.target.binary_path),
            Path::new(&journal.target.state_dir),
            Path::new(&journal.target.config_path),
        )
    }
    .map_err(|message| ("RECOVERY_BINARY_UNAVAILABLE".to_string(), message))?;
    Ok(target)
}

fn rollback_archive_cli_path_to_host(
    journal: &CollaborationBootstrapJournal,
    cli_path: &Path,
) -> Result<PathBuf, String> {
    if !cli_path.is_absolute() {
        return Err("The target-visible offline plugin backup path is not absolute".to_string());
    }
    if journal.target.deployment_kind != "docker" {
        return Ok(cli_path.to_path_buf());
    }
    let relative = cli_path
        .strip_prefix("/home/node/.openclaw")
        .map_err(|_| "The Docker rollback archive is outside its mounted state".to_string())?;
    Ok(Path::new(&journal.target.state_dir).join(relative))
}

fn rollback_source(journal: &CollaborationBootstrapJournal) -> Result<String, String> {
    let host_path = journal
        .original_plugin_backup_host_tgz_path
        .as_deref()
        .ok_or_else(|| {
            "The exact offline plugin backup is unavailable; network rollback is forbidden"
                .to_string()
        })?;
    let cli_path = journal
        .original_plugin_backup_tgz_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            "The target-visible offline plugin backup path is unavailable".to_string()
        })?;
    let expected_sha256 = journal
        .original_plugin_backup_sha256
        .as_deref()
        .filter(|hash| is_valid_sha256(hash))
        .ok_or_else(|| "The exact offline plugin backup hash is unavailable".to_string())?;
    journal
        .original_plugin_content_sha256
        .as_deref()
        .filter(|hash| is_valid_sha256(hash))
        .ok_or_else(|| "The original installed plugin content hash is unavailable".to_string())?;
    let canonical_host = std::fs::canonicalize(host_path)
        .map_err(|error| format!("The exact offline plugin backup is unavailable: {error}"))?;
    let mapped_cli_path = rollback_archive_cli_path_to_host(journal, Path::new(cli_path))?;
    let canonical_cli = std::fs::canonicalize(&mapped_cli_path).map_err(|error| {
        format!("The target-visible offline plugin backup is unavailable: {error}")
    })?;
    if canonical_cli != canonical_host {
        return Err(
            "The target-visible rollback archive is not the hash-verified host backup".to_string(),
        );
    }
    let verified = verify_package_path(&canonical_host, expected_sha256)
        .map_err(|(_, message)| format!("The exact offline plugin backup is invalid: {message}"))?;
    let expected_version = journal
        .original_plugin
        .version
        .as_deref()
        .ok_or_else(|| "The original plugin version is unavailable".to_string())?;
    if verified.plugin_version != expected_version {
        return Err(
            "The exact offline plugin backup version does not match the original plugin"
                .to_string(),
        );
    }
    Ok(cli_path.to_string())
}

fn validate_journal_rollback_artifact(
    journal: &CollaborationBootstrapJournal,
) -> Result<(), String> {
    if journal.original_plugin.installed {
        rollback_source(journal).map(|_| ())
    } else if journal.original_plugin_backup_host_tgz_path.is_some()
        || journal.original_plugin_backup_tgz_path.is_some()
        || journal.original_plugin_backup_sha256.is_some()
        || journal.original_plugin_content_sha256.is_some()
    {
        Err(
            "The bootstrap journal contains a plugin backup for an originally absent plugin"
                .to_string(),
        )
    } else {
        Ok(())
    }
}

fn verify_restored_plugin_snapshot(
    expected: &BootstrapPluginSnapshot,
    actual: &BootstrapPluginSnapshot,
) -> Result<(), String> {
    if actual.installed != expected.installed
        || actual.enabled != expected.enabled
        || (expected.version.is_some() && actual.version != expected.version)
        || (expected.status.is_some() && actual.status != expected.status)
    {
        return Err("The restored plugin does not match the pre-bootstrap snapshot".to_string());
    }
    Ok(())
}

fn journal_plugin_root_to_host(
    journal: &CollaborationBootstrapJournal,
    root_dir: &str,
) -> Result<PathBuf, String> {
    let path = Path::new(root_dir);
    if !path.is_absolute() {
        return Err("The restored plugin reported a non-absolute package root".to_string());
    }
    if journal.target.deployment_kind != "docker" {
        return Ok(path.to_path_buf());
    }
    let relative = path
        .strip_prefix("/home/node/.openclaw")
        .map_err(|_| "The restored Docker plugin root is outside its mounted state".to_string())?;
    Ok(Path::new(&journal.target.state_dir).join(relative))
}

fn verify_restored_plugin_content(
    journal: &CollaborationBootstrapJournal,
    actual: &BootstrapPluginSnapshot,
) -> Result<(), String> {
    if !journal.original_plugin.installed {
        return Ok(());
    }
    let expected = journal
        .original_plugin_content_sha256
        .as_deref()
        .filter(|hash| is_valid_sha256(hash))
        .ok_or_else(|| "The original installed plugin content hash is unavailable".to_string())?;
    let root_dir = actual
        .root_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .ok_or_else(|| "The restored plugin did not report its package root".to_string())?;
    let host_root = journal_plugin_root_to_host(journal, root_dir)?;
    validate_installed_plugin_directory(&host_root, &journal.original_plugin)?;
    let actual_hash = hash_plugin_tree(&host_root)?;
    if actual_hash != expected {
        return Err(format!(
            "The restored plugin content does not match the exact pre-bootstrap snapshot (expected {expected}, got {actual_hash})"
        ));
    }
    Ok(())
}

async fn rollback_plugin(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    target: &PinnedOpenClawCliTarget,
) -> Result<(BootstrapPluginSnapshot, Vec<String>), String> {
    let original = journal.original_plugin.clone();
    if !original.installed {
        uninstall_if_present(control, journal, target).await?;
        journal.record_step("plugins_rollback_inspect", "started", None);
        control.save_journal(journal)?;
        let (plugin, warnings) = inspect_plugin(target).await?;
        if plugin.installed {
            return Err("The collaboration plugin remains installed after rollback".to_string());
        }
        journal.record_step("plugins_rollback_inspect", "completed", None);
        control.save_journal(journal)?;
        return Ok((plugin, warnings));
    }

    let source = rollback_source(journal)?;
    execute_cli_step(
        control,
        journal,
        target,
        "plugins_restore",
        vec![
            "plugins".into(),
            "install".into(),
            "--force".into(),
            "--pin".into(),
            source.into(),
        ],
        300,
    )
    .await?;
    let enable_action = if original.enabled {
        "enable"
    } else {
        "disable"
    };
    execute_cli_step(
        control,
        journal,
        target,
        "plugins_restore_enablement",
        vec!["plugins".into(), enable_action.into(), PLUGIN_ID.into()],
        60,
    )
    .await?;
    journal.record_step("plugins_rollback_inspect", "started", None);
    control.save_journal(journal)?;
    let (plugin, warnings) = inspect_plugin(target).await?;
    verify_restored_plugin_snapshot(&original, &plugin)?;
    verify_restored_plugin_content(journal, &plugin)?;
    journal.record_step("plugins_rollback_inspect", "completed", None);
    control.save_journal(journal)?;
    Ok((plugin, warnings))
}

async fn rollback_bootstrap_state(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    target: &PinnedOpenClawCliTarget,
) -> Result<(BootstrapPluginSnapshot, Vec<String>), String> {
    verify_bootstrap_owned_config(journal, &target.config_path)?;
    let (_, mut warnings) = rollback_plugin(control, journal, target).await?;
    restore_config_snapshot(control, journal, &target.config_path)?;

    journal.record_step("rollback_final_inspect", "started", None);
    control.save_journal(journal)?;
    let (plugin, final_warnings) = inspect_plugin(target).await.inspect_err(|error| {
        journal.record_step("rollback_final_inspect", "failed", Some(error.clone()));
        let _ = control.save_journal(journal);
    })?;
    verify_restored_plugin_snapshot(&journal.original_plugin, &plugin).inspect_err(|error| {
        journal.record_step("rollback_final_inspect", "failed", Some(error.clone()));
        let _ = control.save_journal(journal);
    })?;
    verify_restored_plugin_content(journal, &plugin).inspect_err(|error| {
        journal.record_step("rollback_final_inspect", "failed", Some(error.clone()));
        let _ = control.save_journal(journal);
    })?;
    verify_restored_config_snapshot(journal, &target.config_path).inspect_err(|error| {
        journal.record_step("rollback_final_inspect", "failed", Some(error.clone()));
        let _ = control.save_journal(journal);
    })?;
    journal.record_step("rollback_final_inspect", "completed", None);
    control.save_journal(journal)?;
    warnings.extend(final_warnings);
    warnings.sort();
    warnings.dedup();
    Ok((plugin, warnings))
}

fn finalize_rollback_journal(
    control: &CollaborationControlState,
    journal: &mut CollaborationBootstrapJournal,
    target: &PinnedOpenClawCliTarget,
    plugin: &BootstrapPluginSnapshot,
) -> Result<(), String> {
    verify_restored_plugin_snapshot(&journal.original_plugin, plugin)?;
    verify_restored_plugin_content(journal, plugin)?;
    verify_restored_config_snapshot(journal, &target.config_path)?;
    verify_bootstrap_owned_config(journal, &target.config_path)?;
    if journal.bootstrap_owned_config_sha256.as_deref()
        != Some(journal.original_config_sha256.as_str())
    {
        return Err(
            "The rollback completed without restoring config ownership to the original snapshot"
                .to_string(),
        );
    }
    journal.status = BootstrapJournalStatus::RolledBack;
    journal.restart_required = true;
    journal.health_pending = true;
    journal.health = None;
    journal.record_step("recovery_rollback", "completed", None);
    control.save_journal(journal)
}

#[tauri::command]
pub async fn collaboration_bootstrap_recover(
    params: BootstrapRecoverParams,
    control: State<'_, CollaborationControlState>,
    identity_state: State<'_, RuntimeIdentityState>,
    gateway_state: State<'_, GatewayProcess>,
) -> Result<CollaborationBootstrapResult, String> {
    let _guard = match control.try_acquire() {
        Ok(guard) => guard,
        Err(message) => {
            return Ok(mutation_error(
                "BOOTSTRAP_BUSY",
                message,
                Some(params.target_fingerprint),
                None,
                false,
            ));
        }
    };
    let _gateway_guard = match gateway_state.operation_gate.clone().try_lock_owned() {
        Ok(guard) => guard,
        Err(_) => {
            return Ok(mutation_error(
                "GATEWAY_OPERATION_BUSY",
                "A Gateway lifecycle, update, or storage operation is already running",
                Some(params.target_fingerprint),
                None,
                false,
            ));
        }
    };
    let Some(mut journal) = control.load_journal()? else {
        return Ok(mutation_error(
            "BOOTSTRAP_JOURNAL_MISSING",
            "There is no collaboration bootstrap operation to recover",
            Some(params.target_fingerprint),
            None,
            false,
        ));
    };
    let operation_id = journal.operation_id.clone();
    if let Err(message) = validate_bootstrap_operation_id(&operation_id) {
        return Ok(mutation_error(
            "RECOVERY_OPERATION_INVALID",
            format!("The bootstrap journal operation id is invalid: {message}"),
            Some(params.target_fingerprint),
            Some(operation_id),
            true,
        ));
    }
    let Some(identity) = current_identity(&identity_state)? else {
        return Ok(mutation_error(
            "RUNTIME_IDENTITY_UNAVAILABLE",
            "Reconnect to the journaled Gateway target before recovery",
            Some(params.target_fingerprint),
            Some(operation_id),
            true,
        ));
    };
    if let Err((code, message)) =
        validate_expected_connection(&identity, &params.expected_connection_id)
    {
        return Ok(mutation_error(
            code,
            message,
            Some(identity.target_fingerprint),
            Some(operation_id),
            true,
        ));
    }
    let target = match recovery_target(&journal, identity, &params.target_fingerprint).await {
        Ok(target) => target,
        Err((code, message)) => {
            return Ok(mutation_error(
                code,
                message,
                Some(params.target_fingerprint),
                Some(operation_id),
                true,
            ));
        }
    };
    if let Err(message) = attest_cli_version(&target.cli, &target.identity.gateway_version).await {
        return Ok(mutation_error(
            "RECOVERY_BINARY_RUNTIME_MISMATCH",
            message,
            Some(target.identity.target_fingerprint),
            Some(operation_id),
            true,
        ));
    }
    let live_identity = current_identity(&identity_state)?;
    if let Err((code, message)) =
        validate_current_operation_identity(&target.identity, live_identity.as_ref())
    {
        return Ok(mutation_error(
            code,
            message,
            Some(target.identity.target_fingerprint),
            Some(operation_id),
            true,
        ));
    }
    if let Err(message) = validate_journal_rollback_artifact(&journal) {
        journal_failure(
            &control,
            &mut journal,
            "ROLLBACK_SNAPSHOT_INVALID",
            &message,
        )?;
        return Ok(mutation_error(
            "ROLLBACK_SNAPSHOT_INVALID",
            message,
            Some(target.identity.target_fingerprint),
            Some(operation_id),
            true,
        ));
    }
    if journal.status == BootstrapJournalStatus::RolledBack {
        let config_path = Path::new(&journal.target.config_path);
        let verification = verify_restored_config_snapshot(&journal, config_path)
            .and_then(|_| verify_bootstrap_owned_config(&journal, config_path))
            .and_then(|_| {
                (journal.bootstrap_owned_config_sha256.as_deref()
                    == Some(journal.original_config_sha256.as_str()))
                .then_some(())
                .ok_or_else(|| {
                    "The rolled-back journal does not own the original config snapshot".to_string()
                })
            });
        let plugin_verification = match verification {
            Ok(()) => inspect_plugin(&target.cli)
                .await
                .and_then(|(plugin, warnings)| {
                    verify_restored_plugin_snapshot(&journal.original_plugin, &plugin)?;
                    verify_restored_plugin_content(&journal, &plugin)?;
                    Ok((plugin, warnings))
                }),
            Err(message) => Err(message),
        };
        match plugin_verification {
            Ok((plugin, warnings)) => {
                return Ok(CollaborationBootstrapResult {
                    ok: true,
                    code: "BOOTSTRAP_ALREADY_ROLLED_BACK".to_string(),
                    message: "The previous bootstrap operation is already rolled back and its exact plugin/config state was re-verified"
                        .to_string(),
                    operation_id: Some(operation_id),
                    target_fingerprint: Some(journal.target.target_fingerprint),
                    action: Some("rollback".to_string()),
                    plugin: Some(plugin),
                    restart_required: journal.restart_required,
                    health_pending: journal.health_pending,
                    recoverable: false,
                    warnings,
                });
            }
            Err(message) => {
                journal_failure(
                    &control,
                    &mut journal,
                    "ROLLBACK_STATE_VERIFICATION_FAILED",
                    &message,
                )?;
            }
        }
    }

    match params.strategy {
        BootstrapRecoveryStrategy::Resume => {
            if journal.status == BootstrapJournalStatus::Completed {
                return Ok(mutation_error(
                    "BOOTSTRAP_ALREADY_APPLIED",
                    "The plugin was already applied; use rollback if post-restart health validation failed",
                    Some(target.identity.target_fingerprint),
                    Some(operation_id),
                    true,
                ));
            }
            let verified = match verify_package_path(
                Path::new(&journal.package.host_tgz_path),
                &journal.package.sha256,
            ) {
                Ok(package) => package,
                Err((code, message)) => {
                    journal_failure(&control, &mut journal, &code, &message)?;
                    return Ok(mutation_error(
                        code,
                        message,
                        Some(target.identity.target_fingerprint),
                        Some(operation_id),
                        true,
                    ));
                }
            };
            if verified.plugin_version != journal.package.plugin_version {
                let message = "The journaled plugin package version changed".to_string();
                journal_failure(&control, &mut journal, "PLUGIN_PACKAGE_CHANGED", &message)?;
                return Ok(mutation_error(
                    "PLUGIN_PACKAGE_CHANGED",
                    message,
                    Some(target.identity.target_fingerprint),
                    Some(operation_id),
                    true,
                ));
            }
            journal.operation = BootstrapOperationKind::RecoverResume;
            journal.status = BootstrapJournalStatus::Running;
            journal.record_step("recovery_resume", "started", None);
            control.save_journal(&journal)?;
            match install_enable_inspect(&control, &mut journal, &target.cli).await {
                Ok((plugin, warnings)) => {
                    if let Err(message) = persist_bootstrap_owned_config_hash(
                        &control,
                        &mut journal,
                        &target.cli.config_path,
                    ) {
                        journal_failure(
                            &control,
                            &mut journal,
                            "CONFIG_OWNERSHIP_FENCE_FAILED",
                            &message,
                        )?;
                        return Ok(mutation_error(
                            "CONFIG_OWNERSHIP_FENCE_FAILED",
                            message,
                            Some(target.identity.target_fingerprint),
                            Some(operation_id),
                            true,
                        ));
                    }
                    journal.status = BootstrapJournalStatus::Completed;
                    journal.restart_required = true;
                    journal.health_pending = true;
                    journal.record_step("recovery_resume", "completed", None);
                    control.save_journal(&journal)?;
                    Ok(CollaborationBootstrapResult {
                        ok: true,
                        code: "BOOTSTRAP_RESUMED".to_string(),
                        message: "The collaboration plugin bootstrap resumed successfully; restart the active Gateway and confirm capabilities"
                            .to_string(),
                        operation_id: Some(operation_id),
                        target_fingerprint: Some(target.identity.target_fingerprint),
                        action: Some("resume".to_string()),
                        plugin: Some(plugin),
                        restart_required: true,
                        health_pending: true,
                        recoverable: true,
                        warnings,
                    })
                }
                Err(message) => {
                    journal_failure(&control, &mut journal, "BOOTSTRAP_RESUME_FAILED", &message)?;
                    Ok(mutation_error(
                        "BOOTSTRAP_RESUME_FAILED",
                        message,
                        Some(target.identity.target_fingerprint),
                        Some(operation_id),
                        true,
                    ))
                }
            }
        }
        BootstrapRecoveryStrategy::Rollback => {
            journal.operation = BootstrapOperationKind::RecoverRollback;
            journal.status = BootstrapJournalStatus::Running;
            journal.record_step("recovery_rollback", "started", None);
            control.save_journal(&journal)?;
            match rollback_bootstrap_state(&control, &mut journal, &target.cli).await {
                Ok((plugin, warnings)) => {
                    if let Err(message) =
                        finalize_rollback_journal(&control, &mut journal, &target.cli, &plugin)
                    {
                        journal_failure(
                            &control,
                            &mut journal,
                            "BOOTSTRAP_ROLLBACK_FAILED",
                            &message,
                        )?;
                        return Ok(mutation_error(
                            "BOOTSTRAP_ROLLBACK_FAILED",
                            message,
                            Some(target.identity.target_fingerprint),
                            Some(operation_id),
                            true,
                        ));
                    }
                    Ok(CollaborationBootstrapResult {
                        ok: true,
                        code: "BOOTSTRAP_ROLLED_BACK".to_string(),
                        message: "The previous plugin and configuration state were restored and verified; restart the active Gateway to apply them"
                            .to_string(),
                        operation_id: Some(operation_id),
                        target_fingerprint: Some(target.identity.target_fingerprint),
                        action: Some("rollback".to_string()),
                        plugin: Some(plugin),
                        restart_required: true,
                        health_pending: true,
                        recoverable: false,
                        warnings,
                    })
                }
                Err(message) => {
                    journal_failure(
                        &control,
                        &mut journal,
                        "BOOTSTRAP_ROLLBACK_FAILED",
                        &message,
                    )?;
                    Ok(mutation_error(
                        "BOOTSTRAP_ROLLBACK_FAILED",
                        message,
                        Some(target.identity.target_fingerprint),
                        Some(operation_id),
                        true,
                    ))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn create_test_tgz(root: &Path, id: &str, version: &str) -> PathBuf {
        let path = root.join("plugin.tgz");
        let file = std::fs::File::create(&path).unwrap();
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut archive = tar::Builder::new(encoder);
        let package = serde_json::json!({
            "name": PLUGIN_PACKAGE_NAME,
            "version": version,
            "openclaw": { "extensions": ["./dist/index.js"] }
        })
        .to_string();
        let plugin = serde_json::json!({ "id": id, "version": version }).to_string();
        for (name, content) in [
            ("package/package.json", package),
            ("package/openclaw.plugin.json", plugin),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            archive
                .append_data(&mut header, name, content.as_bytes())
                .unwrap();
        }
        archive.into_inner().unwrap().finish().unwrap();
        path
    }

    fn create_test_plugin_directory(root: &Path, version: &str) -> PathBuf {
        let plugin_root = root.join("installed-plugin");
        std::fs::create_dir_all(plugin_root.join("dist")).unwrap();
        std::fs::write(
            plugin_root.join("package.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "name": PLUGIN_PACKAGE_NAME,
                "version": version,
                "openclaw": { "extensions": ["./dist/index.js"] }
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(
            plugin_root.join("openclaw.plugin.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "id": PLUGIN_ID,
                "version": version
            }))
            .unwrap(),
        )
        .unwrap();
        std::fs::write(plugin_root.join("dist/index.js"), b"export default {};\n").unwrap();
        plugin_root
    }

    fn test_mutation_target(root: &Path, deployment_kind: RuntimeDeploymentKind) -> MutationTarget {
        let mut identity = test_identity(deployment_kind, "connection-before");
        identity.local_state_dir = root.to_string_lossy().to_string();
        identity.local_config_path = root.join("openclaw.json").to_string_lossy().to_string();
        identity.state_dir = Some(identity.local_state_dir.clone());
        identity.config_path = Some(identity.local_config_path.clone());
        let class = target_class(&identity);
        MutationTarget {
            cli: PinnedOpenClawCliTarget {
                binary: root.join("openclaw-test"),
                state_dir: root.to_path_buf(),
                config_path: root.join("openclaw.json"),
                container: None,
            },
            identity,
            class,
        }
    }

    #[test]
    fn durable_collaboration_state_is_absent_only_for_missing_or_empty_real_directory() {
        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-absence-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&root),
            DurableCollaborationState::Absent
        );

        let collaboration_dir = root.join(PLUGIN_ID);
        std::fs::create_dir_all(&collaboration_dir).unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&root),
            DurableCollaborationState::Absent
        );

        std::fs::write(collaboration_dir.join("collaboration.sqlite"), b"state").unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&root),
            DurableCollaborationState::Present
        );
        std::fs::remove_file(collaboration_dir.join("collaboration.sqlite")).unwrap();
        std::fs::write(collaboration_dir.join(".durable-authority"), b"state").unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&root),
            DurableCollaborationState::Present
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn durable_collaboration_state_rejects_invalid_or_unreadable_paths() {
        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-corrupt-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(PLUGIN_ID), b"not-a-directory").unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&root),
            DurableCollaborationState::Corrupt
        );

        let state_file = root.join("state-file");
        std::fs::write(&state_file, b"not-a-state-directory").unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&state_file),
            DurableCollaborationState::Corrupt
        );
        assert_eq!(
            inspect_durable_collaboration_state(Path::new("relative-state")),
            DurableCollaborationState::Unknown
        );
        assert_eq!(
            inspect_durable_collaboration_state(&root.join("missing-state-root")),
            DurableCollaborationState::Unknown
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn durable_collaboration_state_rejects_symlinked_authority_directory() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-symlink-{}",
            uuid::Uuid::new_v4()
        ));
        let elsewhere = root.join("elsewhere");
        std::fs::create_dir_all(&elsewhere).unwrap();
        symlink(&elsewhere, root.join(PLUGIN_ID)).unwrap();
        assert_eq!(
            inspect_durable_collaboration_state(&root),
            DurableCollaborationState::Corrupt
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn durable_collaboration_state_rejects_a_symlinked_path_component() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-component-symlink-{}",
            uuid::Uuid::new_v4()
        ));
        let real_parent = root.join("real-parent");
        let state_directory = real_parent.join("state");
        std::fs::create_dir_all(state_directory.join(PLUGIN_ID)).unwrap();
        let linked_parent = root.join("linked-parent");
        symlink(&real_parent, &linked_parent).unwrap();

        assert_eq!(
            inspect_durable_collaboration_state(&linked_parent.join("state")),
            DurableCollaborationState::Corrupt
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn durable_collaboration_state_returns_unknown_after_parent_rebind() {
        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-parent-swap-{}",
            uuid::Uuid::new_v4()
        ));
        let authority_parent = root.join("authority-parent");
        let authority_state = authority_parent.join("state");
        std::fs::create_dir_all(authority_state.join(PLUGIN_ID)).unwrap();

        let replacement_parent = root.join("replacement-parent");
        let replacement_state = replacement_parent.join("state");
        std::fs::create_dir_all(replacement_state.join(PLUGIN_ID)).unwrap();
        std::fs::write(
            replacement_state
                .join(PLUGIN_ID)
                .join("collaboration.sqlite"),
            b"replacement state must not be observed",
        )
        .unwrap();

        let pinned_parent = root.join("pinned-parent");
        let observed = inspect_durable_collaboration_state_with_observers(
            &authority_state,
            || {
                std::fs::rename(&authority_parent, &pinned_parent).unwrap();
                std::fs::rename(&replacement_parent, &authority_parent).unwrap();
            },
            || {},
        );

        assert_eq!(observed, DurableCollaborationState::Unknown);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn durable_collaboration_state_returns_unknown_after_target_rebind() {
        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-target-swap-{}",
            uuid::Uuid::new_v4()
        ));
        let state_directory = root.join("state");
        let collaboration_directory = state_directory.join(PLUGIN_ID);
        std::fs::create_dir_all(&collaboration_directory).unwrap();

        let replacement_directory = root.join("replacement-collaboration");
        std::fs::create_dir_all(&replacement_directory).unwrap();
        std::fs::write(
            replacement_directory.join("collaboration.sqlite"),
            b"replacement state must not be observed",
        )
        .unwrap();

        let pinned_directory = state_directory.join("pinned-collaboration");
        let observed = inspect_durable_collaboration_state_with_observers(
            &state_directory,
            || {},
            || {
                std::fs::rename(&collaboration_directory, &pinned_directory).unwrap();
                std::fs::rename(&replacement_directory, &collaboration_directory).unwrap();
            },
        );

        assert_eq!(observed, DurableCollaborationState::Unknown);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn durable_collaboration_state_returns_unknown_when_missing_target_appears() {
        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-target-appears-{}",
            uuid::Uuid::new_v4()
        ));
        let state_directory = root.join("state");
        std::fs::create_dir_all(&state_directory).unwrap();
        let collaboration_directory = state_directory.join(PLUGIN_ID);

        let observed = inspect_durable_collaboration_state_with_observers(
            &state_directory,
            || {},
            || {
                std::fs::create_dir(&collaboration_directory).unwrap();
            },
        );

        assert_eq!(observed, DurableCollaborationState::Unknown);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn durable_collaboration_state_returns_unknown_when_target_disappears() {
        let root = std::env::temp_dir().join(format!(
            "junqi-collaboration-target-disappears-{}",
            uuid::Uuid::new_v4()
        ));
        let state_directory = root.join("state");
        let collaboration_directory = state_directory.join(PLUGIN_ID);
        std::fs::create_dir_all(&collaboration_directory).unwrap();
        let moved_directory = state_directory.join("moved-collaboration");

        let observed = inspect_durable_collaboration_state_with_observers(
            &state_directory,
            || {},
            || {
                std::fs::rename(&collaboration_directory, &moved_directory).unwrap();
            },
        );

        assert_eq!(observed, DurableCollaborationState::Unknown);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn package_verification_requires_an_absolute_tgz_and_exact_hash() {
        let root = std::env::temp_dir().join(format!("junqi-package-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = create_test_tgz(&root, PLUGIN_ID, "0.1.0");
        let hash = hash_file(&path, MAX_PACKAGE_BYTES).unwrap();
        let verified = verify_package_path(&path, &hash).unwrap();
        assert_eq!(verified.sha256, hash);
        assert_eq!(verified.plugin_version, "0.1.0");
        let staged = root.join("staged.tgz");
        copy_archive_verified(&path, &staged, &hash).unwrap();
        assert_eq!(hash_file(&staged, MAX_PACKAGE_BYTES).unwrap(), hash);

        let mismatch = verify_package_path(&path, &"0".repeat(64)).unwrap_err();
        assert_eq!(mismatch.0, "PLUGIN_SHA256_MISMATCH");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn bundled_package_is_bound_to_compiled_and_resource_metadata() {
        let resource_root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("collaboration");
        let metadata = resource_root.join("metadata.json");
        let archive = resource_root.join("junqi-collab.tgz");
        let verified = verify_bundled_package_paths(&metadata, &archive).unwrap();
        let compiled = parse_bundled_metadata(BUNDLED_METADATA_JSON.as_bytes()).unwrap();
        assert_eq!(verified.sha256, compiled.sha256);
        assert_eq!(verified.plugin_version, compiled.plugin_version);

        let root = std::env::temp_dir().join(format!("junqi-bundle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let changed_metadata = root.join("metadata.json");
        let mut document: Value = serde_json::from_str(BUNDLED_METADATA_JSON).unwrap();
        document["schemaVersion"] = Value::from(compiled.schema_version + 1);
        std::fs::write(&changed_metadata, serde_json::to_vec(&document).unwrap()).unwrap();
        assert_eq!(
            verify_bundled_package_paths(&changed_metadata, &archive)
                .unwrap_err()
                .0,
            "PLUGIN_BUNDLE_METADATA_MISMATCH"
        );

        let changed_archive = root.join("junqi-collab.tgz");
        std::fs::copy(&archive, &changed_archive).unwrap();
        std::fs::OpenOptions::new()
            .append(true)
            .open(&changed_archive)
            .unwrap()
            .write_all(b"tampered")
            .unwrap();
        assert_eq!(
            verify_bundled_package_paths(&metadata, &changed_archive)
                .unwrap_err()
                .0,
            "PLUGIN_SHA256_MISMATCH"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn bootstrap_apply_deserialization_ignores_untrusted_renderer_package_fields() {
        let params: BootstrapApplyParams = serde_json::from_value(serde_json::json!({
            "targetFingerprint": "fp",
            "expectedConnectionId": "connection-before",
            "tgzPath": "/tmp/attacker.tgz",
            "expectedSha256": "0".repeat(64),
        }))
        .unwrap();
        assert_eq!(params.target_fingerprint, "fp");
        assert_eq!(params.expected_connection_id, "connection-before");
    }

    #[test]
    fn package_verification_rejects_a_different_plugin_id() {
        let root = std::env::temp_dir().join(format!("junqi-package-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = create_test_tgz(&root, "other-plugin", "0.1.0");
        assert!(parse_archive_metadata(&path)
            .unwrap_err()
            .contains("unexpected OpenClaw plugin id"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn version_probe_extracts_openclaw_semver_without_accepting_noise() {
        assert_eq!(
            extract_version("OpenClaw 2026.7.1 (2d2ddc4)"),
            Some("2026.7.1".to_string())
        );
        assert_eq!(extract_version("warning only"), None);
    }

    #[test]
    fn direct_apply_target_gate_rejects_desktop_bound_managed_child() {
        let root = std::env::temp_dir().join(format!("junqi-target-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let target = test_mutation_target(&root, RuntimeDeploymentKind::ManagedChild);
        assert_eq!(
            validate_durable_mutation_target(&target).unwrap_err().0,
            "DURABLE_TARGET_REQUIRED"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn installed_plugin_without_exact_local_directory_fails_before_mutation() {
        let root = std::env::temp_dir().join(format!("junqi-backup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let target = test_mutation_target(&root, RuntimeDeploymentKind::SystemService);
        let plugin = BootstrapPluginSnapshot {
            installed: true,
            enabled: true,
            status: Some("loaded".to_string()),
            version: Some("0.1.0".to_string()),
            source: None,
            root_dir: None,
            install_record: Some(serde_json::json!({
                "source": "npm",
                "resolvedSpec": "@junqi/openclaw-collaboration@0.1.0"
            })),
        };
        let error = backup_original_plugin_archive(&control, &target, "op", &plugin).unwrap_err();
        assert!(error.contains("no exact, locally readable package directory"));
        assert!(!control.journal_path().exists());
        assert!(!root.join("collaboration-bootstrap-backups/op").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    fn test_journal(original_plugin: BootstrapPluginSnapshot) -> CollaborationBootstrapJournal {
        CollaborationBootstrapJournal {
            version: BOOTSTRAP_JOURNAL_VERSION,
            operation_id: "op".to_string(),
            operation: BootstrapOperationKind::Apply,
            status: BootstrapJournalStatus::Running,
            target: BootstrapTargetSnapshot {
                target_fingerprint: "fp".to_string(),
                connection_id: "connection-before".to_string(),
                deployment_kind: "docker".to_string(),
                ownership: "junqi_managed".to_string(),
                gateway_version: "2026.7.1".to_string(),
                binary_path: "/bin/openclaw".to_string(),
                state_dir: "/tmp/state".to_string(),
                config_path: "/tmp/state/openclaw.json".to_string(),
            },
            package: BootstrapPackageSnapshot {
                source_tgz_path: "/tmp/source-plugin.tgz".to_string(),
                host_tgz_path: "/tmp/plugin.tgz".to_string(),
                tgz_path: "/tmp/plugin.tgz".to_string(),
                sha256: "a".repeat(64),
                plugin_id: PLUGIN_ID.to_string(),
                plugin_version: "0.1.0".to_string(),
            },
            original_plugin,
            original_plugin_backup_tgz_path: None,
            original_plugin_backup_host_tgz_path: None,
            original_plugin_backup_sha256: None,
            original_plugin_content_sha256: None,
            original_config_sha256: "missing".to_string(),
            original_config_backup_path: None,
            bootstrap_owned_config_sha256: Some("missing".to_string()),
            started_at_ms: 1,
            updated_at_ms: 1,
            restart_required: false,
            health_pending: false,
            health: None,
            steps: vec![],
            diagnostics: vec![],
        }
    }

    fn valid_health_fixture() -> (BootstrapConfirmHealthParams, CollaborationBootstrapJournal) {
        let metadata = parse_bundled_metadata(BUNDLED_METADATA_JSON.as_bytes()).unwrap();
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.status = BootstrapJournalStatus::Completed;
        journal.health_pending = true;
        journal.restart_required = true;
        journal.package.plugin_id = metadata.plugin_id.clone();
        journal.package.plugin_version = metadata.plugin_version.clone();
        journal.package.sha256 = metadata.sha256;
        let features = REQUIRED_COLLABORATION_FEATURES
            .iter()
            .map(|feature| ((*feature).to_string(), true))
            .collect();
        (
            BootstrapConfirmHealthParams {
                operation_id: journal.operation_id.clone(),
                target_fingerprint: journal.target.target_fingerprint.clone(),
                expected_connection_id: "connection-after".to_string(),
                collaboration_instance_id: "runtime-instance".to_string(),
                plugin_version: metadata.plugin_version,
                schema_version: metadata.schema_version,
                durable_state: true,
                durable_runtime: true,
                durable_runtime_supported: true,
                feature_evidence_kind: "DECLARED_PLUGIN_CONTRACT".to_string(),
                feature_evidence_behavior_verified: false,
                feature_evidence_required_behavior_gate: "ISOLATED_REAL_GATEWAY".to_string(),
                feature_evidence_plugin_service_started: true,
                feature_evidence_database_integrity: "ok".to_string(),
                features,
            },
            journal,
        )
    }

    #[test]
    fn health_contract_rejects_exact_schema_feature_and_runtime_mismatches() {
        let (valid, journal) = valid_health_fixture();
        validate_confirmed_capabilities(&valid, &journal).unwrap();

        let (mut wrong_schema, journal) = valid_health_fixture();
        wrong_schema.schema_version += 1;
        assert_eq!(
            validate_confirmed_capabilities(&wrong_schema, &journal)
                .unwrap_err()
                .0,
            "COLLABORATION_SCHEMA_VERSION_MISMATCH"
        );

        let (mut missing_feature, journal) = valid_health_fixture();
        missing_feature.features.remove("EVENT_CURSOR");
        assert_eq!(
            validate_confirmed_capabilities(&missing_feature, &journal)
                .unwrap_err()
                .0,
            "COLLABORATION_FEATURES_MISSING"
        );

        let (mut missing_instance_fence, journal) = valid_health_fixture();
        missing_instance_fence
            .features
            .remove("WRITE_INSTANCE_FENCE");
        assert_eq!(
            validate_confirmed_capabilities(&missing_instance_fence, &journal)
                .unwrap_err()
                .0,
            "COLLABORATION_FEATURES_MISSING"
        );

        let (mut non_durable, journal) = valid_health_fixture();
        non_durable.durable_runtime_supported = false;
        assert_eq!(
            validate_confirmed_capabilities(&non_durable, &journal)
                .unwrap_err()
                .0,
            "COLLABORATION_DURABLE_RUNTIME_REQUIRED"
        );

        let (mut invalid_evidence, journal) = valid_health_fixture();
        invalid_evidence.feature_evidence_kind.clear();
        assert_eq!(
            validate_confirmed_capabilities(&invalid_evidence, &journal)
                .unwrap_err()
                .0,
            "COLLABORATION_FEATURE_EVIDENCE_INVALID"
        );
    }

    #[test]
    fn health_contract_failure_is_persisted_as_recovery_required() {
        let root = std::env::temp_dir().join(format!("junqi-health-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let (mut params, mut journal) = valid_health_fixture();
        params.features.remove("SESSION_DELETE_CAS");
        let (code, message) = validate_confirmed_capabilities(&params, &journal).unwrap_err();
        journal_failure(&control, &mut journal, &code, &message).unwrap();
        let persisted = control.load_journal().unwrap().unwrap();
        assert_eq!(persisted.status, BootstrapJournalStatus::RecoveryRequired);
        assert!(persisted.health_pending);
        assert!(persisted
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("SESSION_DELETE_CAS")));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_restores_and_verifies_the_exact_config_before_marking_completion() {
        let root = std::env::temp_dir().join(format!("junqi-rollback-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let config_path = root.join("openclaw.json");
        let backup_path = root.join("original-openclaw.json");
        let original = br#"{"plugins":{"entries":{"legacy":{"enabled":true}}}}"#;
        std::fs::write(&backup_path, original).unwrap();
        std::fs::write(
            &config_path,
            br#"{"plugins":{"entries":{"junqi-collab":{}}}}"#,
        )
        .unwrap();
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.target.config_path = config_path.to_string_lossy().to_string();
        journal.original_config_sha256 = format!("{:x}", Sha256::digest(original));
        journal.original_config_backup_path = Some(backup_path.to_string_lossy().to_string());
        journal.bootstrap_owned_config_sha256 = Some(config_hash(&config_path).unwrap());
        control.save_journal(&journal).unwrap();

        restore_config_snapshot(&control, &mut journal, &config_path).unwrap();
        assert_eq!(std::fs::read(&config_path).unwrap(), original);
        let target = PinnedOpenClawCliTarget {
            binary: root.join("unused-openclaw"),
            state_dir: root.clone(),
            config_path: config_path.clone(),
            container: None,
        };
        finalize_rollback_journal(
            &control,
            &mut journal,
            &target,
            &BootstrapPluginSnapshot::default(),
        )
        .unwrap();
        let persisted = control.load_journal().unwrap().unwrap();
        assert_eq!(persisted.status, BootstrapJournalStatus::RolledBack);
        assert!(persisted.restart_required);
        assert!(persisted.health_pending);
        assert!(persisted.health.is_none());
        assert_eq!(
            persisted.bootstrap_owned_config_sha256.as_deref(),
            Some(persisted.original_config_sha256.as_str())
        );
        assert!(persisted
            .steps
            .iter()
            .any(|step| { step.name == "config_restore" && step.status == "completed" }));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_fails_closed_when_config_backup_is_missing_or_has_wrong_hash() {
        for mismatch in [false, true] {
            let root = std::env::temp_dir()
                .join(format!("junqi-rollback-invalid-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
            let config_path = root.join("openclaw.json");
            std::fs::write(&config_path, b"bootstrap-mutated").unwrap();
            let mut journal = test_journal(BootstrapPluginSnapshot::default());
            journal.target.config_path = config_path.to_string_lossy().to_string();
            journal.original_config_sha256 = format!("{:x}", Sha256::digest(b"original"));
            let backup_path = root.join("original-openclaw.json");
            if mismatch {
                std::fs::write(&backup_path, b"not-original").unwrap();
            }
            journal.original_config_backup_path = Some(backup_path.to_string_lossy().to_string());
            journal.bootstrap_owned_config_sha256 = Some(config_hash(&config_path).unwrap());
            control.save_journal(&journal).unwrap();

            let error = restore_config_snapshot(&control, &mut journal, &config_path).unwrap_err();
            if mismatch {
                assert!(error.contains("does not match its journaled hash"));
            } else {
                assert!(error.contains("backup is unavailable"));
            }
            assert_eq!(std::fs::read(&config_path).unwrap(), b"bootstrap-mutated");
            journal_failure(&control, &mut journal, "BOOTSTRAP_ROLLBACK_FAILED", &error).unwrap();
            let persisted = control.load_journal().unwrap().unwrap();
            assert_eq!(persisted.status, BootstrapJournalStatus::RecoveryRequired);
            assert_ne!(persisted.status, BootstrapJournalStatus::RolledBack);
            assert!(!persisted.restart_required);
            assert!(!persisted.health_pending);
            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[test]
    fn rollback_removes_a_config_that_did_not_exist_before_apply() {
        let root = std::env::temp_dir().join(format!("junqi-rollback-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let config_path = root.join("openclaw.json");
        std::fs::write(&config_path, b"created-by-bootstrap").unwrap();
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.target.config_path = config_path.to_string_lossy().to_string();
        journal.original_config_sha256 = "missing".to_string();
        journal.original_config_backup_path = None;
        journal.bootstrap_owned_config_sha256 = Some(config_hash(&config_path).unwrap());
        control.save_journal(&journal).unwrap();
        restore_config_snapshot(&control, &mut journal, &config_path).unwrap();
        assert!(!config_path.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rollback_refuses_config_changed_since_apply() {
        let root = std::env::temp_dir().join(format!("junqi-rollback-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let calls = root.join("calls.log");
        let script = executable_script(
            &root,
            "openclaw-test",
            &format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nexit 0\n",
                calls.to_string_lossy()
            ),
        );
        let config_path = root.join("openclaw.json");
        std::fs::write(&config_path, b"bootstrap-owned").unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.target.config_path = config_path.to_string_lossy().to_string();
        journal.bootstrap_owned_config_sha256 = Some(config_hash(&config_path).unwrap());
        control.save_journal(&journal).unwrap();

        std::fs::write(&config_path, b"user-edited-after-apply").unwrap();
        let target = PinnedOpenClawCliTarget {
            binary: script,
            state_dir: root.clone(),
            config_path: config_path.clone(),
            container: None,
        };
        let error = rollback_bootstrap_state(&control, &mut journal, &target)
            .await
            .unwrap_err();
        assert!(error.contains("changed outside this bootstrap operation"));
        assert!(!calls.exists(), "rollback must not invoke the plugin CLI");
        assert_eq!(
            std::fs::read(&config_path).unwrap(),
            b"user-edited-after-apply"
        );
        journal_failure(&control, &mut journal, "BOOTSTRAP_ROLLBACK_FAILED", &error).unwrap();
        assert_eq!(
            control.load_journal().unwrap().unwrap().status,
            BootstrapJournalStatus::RecoveryRequired
        );

        journal.bootstrap_owned_config_sha256 = None;
        assert!(verify_bootstrap_owned_config(&journal, &config_path)
            .unwrap_err()
            .contains("predates config ownership fencing"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_plugin_mutation_records_config_hash_and_allows_fenced_retry() {
        let root = std::env::temp_dir().join(format!("junqi-fence-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let marker = root.join("first-call-completed");
        let config_path = root.join("openclaw.json");
        let script = executable_script(
            &root,
            "openclaw-test",
            &format!(
                "#!/bin/sh\nif [ ! -f '{}' ]; then\n  printf 'after-failed-command' > \"$OPENCLAW_CONFIG_PATH\"\n  touch '{}'\n  exit 7\nfi\nprintf 'after-successful-retry' > \"$OPENCLAW_CONFIG_PATH\"\nexit 0\n",
                marker.to_string_lossy(),
                marker.to_string_lossy()
            ),
        );
        std::fs::write(&config_path, b"before-command").unwrap();
        let target = PinnedOpenClawCliTarget {
            binary: script,
            state_dir: root.clone(),
            config_path: config_path.clone(),
            container: None,
        };
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.target.config_path = config_path.to_string_lossy().to_string();
        journal.bootstrap_owned_config_sha256 = Some(config_hash(&config_path).unwrap());
        control.save_journal(&journal).unwrap();

        let first = execute_cli_step(
            &control,
            &mut journal,
            &target,
            "plugins_test_mutation",
            vec!["plugins".into(), "enable".into(), PLUGIN_ID.into()],
            10,
        )
        .await
        .unwrap_err();
        assert!(first.contains("exited with code 7"));
        assert_eq!(
            journal.bootstrap_owned_config_sha256.as_deref(),
            Some(config_hash(&config_path).unwrap().as_str())
        );
        verify_bootstrap_owned_config(&journal, &config_path).unwrap();

        execute_cli_step(
            &control,
            &mut journal,
            &target,
            "plugins_test_mutation_retry",
            vec!["plugins".into(), "enable".into(), PLUGIN_ID.into()],
            10,
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read(&config_path).unwrap(),
            b"after-successful-retry"
        );
        assert_eq!(
            journal.bootstrap_owned_config_sha256.as_deref(),
            Some(config_hash(&config_path).unwrap().as_str())
        );
        let persisted = control.load_journal().unwrap().unwrap();
        assert_eq!(
            persisted.bootstrap_owned_config_sha256,
            journal.bootstrap_owned_config_sha256
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_journal_without_owned_config_hash_fails_closed() {
        let journal = test_journal(BootstrapPluginSnapshot::default());
        let mut value = serde_json::to_value(journal).unwrap();
        value
            .as_object_mut()
            .unwrap()
            .remove("bootstrapOwnedConfigSha256");
        let legacy: CollaborationBootstrapJournal = serde_json::from_value(value).unwrap();
        assert!(legacy.bootstrap_owned_config_sha256.is_none());
        assert!(
            verify_bootstrap_owned_config(&legacy, Path::new(&legacy.target.config_path))
                .unwrap_err()
                .contains("predates config ownership fencing")
        );
    }

    #[test]
    fn explicit_abandon_archives_orphan_evidence_and_unblocks_other_targets() {
        let root = std::env::temp_dir().join(format!("junqi-abandon-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let package = root.join("package.tgz");
        let config_backup = root.join("original-openclaw.json");
        std::fs::write(&package, b"package-evidence").unwrap();
        std::fs::write(&config_backup, b"config-evidence").unwrap();
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.status = BootstrapJournalStatus::RecoveryRequired;
        journal.target.target_fingerprint = "orphan-fingerprint".to_string();
        journal.package.host_tgz_path = package.to_string_lossy().to_string();
        journal.package.sha256 = format!("{:x}", Sha256::digest(b"package-evidence"));
        journal.original_config_backup_path = Some(config_backup.to_string_lossy().to_string());
        journal.original_config_sha256 = format!("{:x}", Sha256::digest(b"config-evidence"));
        control.save_journal(&journal).unwrap();

        let mut identity = test_identity(RuntimeDeploymentKind::SystemService, "connection-new");
        identity.target_fingerprint = "current-fingerprint".to_string();
        let params = BootstrapAbandonParams {
            operation_id: journal.operation_id.clone(),
            orphan_target_fingerprint: journal.target.target_fingerprint.clone(),
            current_target_fingerprint: identity.target_fingerprint.clone(),
            expected_connection_id: identity.connection_id.clone(),
        };
        validate_bootstrap_abandon(&journal, &identity, &params).unwrap();
        archive_abandoned_bootstrap(&control, &journal, &identity.target_fingerprint).unwrap();
        assert!(control.load_journal().unwrap().is_none());
        assert!(!existing_journal_blocks_apply(
            control.load_journal().unwrap().as_ref()
        ));

        let archive_root = root.join("collaboration-bootstrap-archive");
        let entries = std::fs::read_dir(&archive_root)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(entries.len(), 1);
        let archived = load_archived_journal(&entries[0].path().join("journal.json")).unwrap();
        assert_eq!(archived.status, BootstrapJournalStatus::Abandoned);
        assert_eq!(archived.operation_id, journal.operation_id);
        assert!(Path::new(&archived.package.host_tgz_path).is_file());
        assert!(Path::new(archived.original_config_backup_path.as_deref().unwrap()).is_file());
        assert!(!archived.restart_required);
        assert!(!archived.health_pending);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn abandon_requires_exact_confirmation_and_a_different_verified_target() {
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.status = BootstrapJournalStatus::RecoveryRequired;
        journal.target.target_fingerprint = "orphan-fingerprint".to_string();
        let mut identity = test_identity(RuntimeDeploymentKind::SystemService, "connection-new");
        identity.target_fingerprint = "current-fingerprint".to_string();
        let mut params = BootstrapAbandonParams {
            operation_id: journal.operation_id.clone(),
            orphan_target_fingerprint: journal.target.target_fingerprint.clone(),
            current_target_fingerprint: identity.target_fingerprint.clone(),
            expected_connection_id: identity.connection_id.clone(),
        };
        params.operation_id = "wrong-operation".to_string();
        assert_eq!(
            validate_bootstrap_abandon(&journal, &identity, &params)
                .unwrap_err()
                .0,
            "BOOTSTRAP_OPERATION_MISMATCH"
        );
        params.operation_id = journal.operation_id.clone();
        identity.target_fingerprint = journal.target.target_fingerprint.clone();
        params.current_target_fingerprint = identity.target_fingerprint.clone();
        assert_eq!(
            validate_bootstrap_abandon(&journal, &identity, &params)
                .unwrap_err()
                .0,
            "BOOTSTRAP_TARGET_NOT_ORPHANED"
        );
    }

    #[test]
    fn abandon_archive_is_bounded_without_pruning_existing_evidence() {
        let root = std::env::temp_dir().join(format!("junqi-abandon-{}", uuid::Uuid::new_v4()));
        let archive_root = root.join("collaboration-bootstrap-archive");
        std::fs::create_dir_all(&archive_root).unwrap();
        for index in 0..MAX_ABANDONED_BOOTSTRAP_ARCHIVES {
            std::fs::create_dir(archive_root.join(format!("archive-{index}"))).unwrap();
        }
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let journal = test_journal(BootstrapPluginSnapshot::default());
        let error =
            archive_abandoned_bootstrap(&control, &journal, "current-fingerprint").unwrap_err();
        assert!(error.contains("bounded bootstrap archive"));
        assert_eq!(
            std::fs::read_dir(&archive_root).unwrap().count(),
            MAX_ABANDONED_BOOTSTRAP_ARCHIVES
        );
        let _ = std::fs::remove_dir_all(root);
    }

    fn test_identity(
        deployment_kind: RuntimeDeploymentKind,
        connection_id: &str,
    ) -> RuntimeIdentity {
        let (persistence, install_target) = match deployment_kind {
            RuntimeDeploymentKind::Docker => (
                crate::state::runtime_identity::RuntimePersistence::DesktopIndependent,
                crate::state::runtime_identity::RuntimeInstallTarget::DockerExec,
            ),
            RuntimeDeploymentKind::SystemService => (
                crate::state::runtime_identity::RuntimePersistence::DesktopIndependent,
                crate::state::runtime_identity::RuntimeInstallTarget::NativeCli,
            ),
            RuntimeDeploymentKind::ManagedChild => (
                crate::state::runtime_identity::RuntimePersistence::DesktopBound,
                crate::state::runtime_identity::RuntimeInstallTarget::NativeCli,
            ),
            RuntimeDeploymentKind::External => (
                crate::state::runtime_identity::RuntimePersistence::Unknown,
                crate::state::runtime_identity::RuntimeInstallTarget::RemoteManual,
            ),
        };
        RuntimeIdentity {
            runtime_id: None,
            target_fingerprint: "fp".to_string(),
            connection_id: connection_id.to_string(),
            endpoint: "ws://127.0.0.1:18789/".to_string(),
            gateway_version: "2026.7.1".to_string(),
            protocol: 4,
            state_dir: Some("/tmp/state".to_string()),
            config_path: Some("/tmp/state/openclaw.json".to_string()),
            local_state_dir: "/tmp/state".to_string(),
            local_config_path: "/tmp/state/openclaw.json".to_string(),
            deployment_kind,
            ownership: if deployment_kind == RuntimeDeploymentKind::External {
                RuntimeOwnership::UserManaged
            } else {
                RuntimeOwnership::JunqiManaged
            },
            persistence,
            install_target,
            endpoint_attestation: crate::state::runtime_identity::RuntimeAttestation::Matched,
            path_attestation: crate::state::runtime_identity::RuntimeAttestation::Matched,
            desktop_mutation_allowed: deployment_kind != RuntimeDeploymentKind::External,
            desktop_exit_continuity: matches!(
                deployment_kind,
                RuntimeDeploymentKind::SystemService | RuntimeDeploymentKind::Docker
            ),
            verified: true,
            issues: vec![],
            auth_mode: Some("token".to_string()),
            methods: vec!["junqi.collab.capabilities".to_string()],
            events: vec![],
            negotiated_role: Some("operator".to_string()),
            negotiated_scopes: vec!["operator.read".to_string()],
            supervisor_lifecycle: crate::state::gateway_process::GatewayLifecycle::Running,
            supervisor_port: 18789,
            observed_at_ms: 1,
        }
    }

    #[test]
    fn probe_identity_requires_an_exact_fingerprint_and_connection_pair() {
        let identity = test_identity(RuntimeDeploymentKind::SystemService, "connection-current");
        assert!(validate_probe_identity(
            &identity,
            &BootstrapProbeParams {
                target_fingerprint: Some("fp".to_string()),
                expected_connection_id: Some("connection-current".to_string()),
            }
        )
        .is_ok());
        assert_eq!(
            validate_probe_identity(
                &identity,
                &BootstrapProbeParams {
                    target_fingerprint: Some("fp".to_string()),
                    expected_connection_id: Some("connection-old".to_string()),
                }
            )
            .unwrap_err()
            .0,
            "CONNECTION_CHANGED"
        );
        assert_eq!(
            validate_probe_identity(
                &identity,
                &BootstrapProbeParams {
                    target_fingerprint: Some("fp".to_string()),
                    expected_connection_id: None,
                }
            )
            .unwrap_err()
            .0,
            "PROBE_IDENTITY_INCOMPLETE"
        );
    }

    #[test]
    fn current_operation_identity_rejects_local_runtime_path_drift() {
        let expected = test_identity(RuntimeDeploymentKind::SystemService, "connection-before");
        let mut current = expected.clone();
        current.local_state_dir = "/tmp/replaced-state".to_string();
        current.local_config_path = "/tmp/replaced-state/openclaw.json".to_string();
        let error = validate_current_operation_identity(&expected, Some(&current)).unwrap_err();
        assert_eq!(error.0, "TARGET_CHANGED");
    }

    #[test]
    fn private_operation_dir_rejects_path_traversal_and_does_not_create_outside_root() {
        let root = std::env::temp_dir().join(format!(
            "junqi-operation-id-boundary-{}",
            uuid::Uuid::new_v4()
        ));
        let journal_path = root.join("journal.json");
        let control = CollaborationControlState::with_journal_path(journal_path);
        let escaped = root.parent().unwrap().join("escape");
        for operation_id in [
            "",
            ".",
            "..",
            "../escape",
            "/tmp/escape",
            r"..\escape",
            "operation/id",
            "operation\nid",
            "operation.id",
        ] {
            assert!(
                private_operation_dir(&control, operation_id).is_err(),
                "accepted unsafe operation id {operation_id:?}"
            );
        }
        assert!(!escaped.exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn private_operation_dir_rejects_an_existing_symbolic_link() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-operation-symlink-boundary-{}",
            uuid::Uuid::new_v4()
        ));
        let journal_path = root.join("journal.json");
        let control = CollaborationControlState::with_journal_path(journal_path);
        let backup_root = root.join("collaboration-bootstrap-backups");
        let outside = root.join("outside");
        std::fs::create_dir_all(&backup_root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, backup_root.join("op-1")).unwrap();

        assert!(private_operation_dir(&control, "op-1").is_err());
        assert!(!outside.join("junqi-collab-0.3.0.tgz").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn private_operation_dir_rejects_a_symbolic_linked_backup_root() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-operation-backup-root-boundary-{}",
            uuid::Uuid::new_v4()
        ));
        let journal_path = root.join("journal.json");
        let control = CollaborationControlState::with_journal_path(journal_path);
        let backup_root = root.join("collaboration-bootstrap-backups");
        let outside = root.join("outside");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &backup_root).unwrap();

        let error = private_operation_dir(&control, "op-1").unwrap_err();
        assert!(error.contains("backup root"));
        assert!(!outside.join("op-1").exists());

        let target = test_mutation_target(&root, RuntimeDeploymentKind::SystemService);
        let cleanup_error = cleanup_preflight_artifacts(&control, &target, "op-1").unwrap_err();
        assert!(cleanup_error.contains("backup root"));
        assert!(!outside.join("op-1").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn docker_artifact_dirs_reject_a_symbolic_linked_staging_root() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-docker-staging-root-boundary-{}",
            uuid::Uuid::new_v4()
        ));
        let state_root = root.join("state");
        let staging_root = state_root.join(".junqi-bootstrap");
        let outside = root.join("outside");
        std::fs::create_dir_all(&state_root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &staging_root).unwrap();
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let target = test_mutation_target(&state_root, RuntimeDeploymentKind::Docker);

        let error = target_artifact_dirs(&control, &target, "op-1").unwrap_err();
        assert!(error.contains("staging root"));
        assert!(!outside.join("op-1").exists());
        let cleanup_error = cleanup_preflight_artifacts(&control, &target, "op-1").unwrap_err();
        assert!(cleanup_error.contains("staging root"));
        assert!(!outside.join("op-1").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_archive_boundary_rejects_an_application_symlink_component() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-descriptor-symlink-component-{}",
            uuid::Uuid::new_v4()
        ));
        let outside = root.join("outside");
        let link = root.join("link");
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, &link).unwrap();

        let error = DescriptorDirectory::open_absolute(
            &root.join("link/created"),
            true,
            0o700,
            "descriptor test directory",
        )
        .unwrap_err();
        assert!(error.contains("descriptor test directory"));
        assert!(!outside.join("created").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn descriptor_archive_boundary_remains_bound_after_parent_swap() {
        use std::io::Write;
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-descriptor-parent-swap-{}",
            uuid::Uuid::new_v4()
        ));
        let anchor = root.join("anchor");
        let displaced = root.join("anchor-displaced");
        let outside = root.join("outside");
        std::fs::create_dir_all(&anchor).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let directory =
            DescriptorDirectory::open_absolute(&anchor, false, 0, "descriptor test directory")
                .unwrap();

        std::fs::rename(&anchor, &displaced).unwrap();
        symlink(&outside, &anchor).unwrap();

        let mut evidence = directory
            .create_regular_file(OsStr::new("evidence"), 0o600, "descriptor test evidence")
            .unwrap();
        evidence.write_all(b"pinned").unwrap();
        evidence.sync_all().unwrap();
        assert_eq!(
            std::fs::read(displaced.join("evidence")).unwrap(),
            b"pinned"
        );
        assert!(!outside.join("evidence").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn abandon_archive_rejects_a_symlinked_archive_root_without_writing_outside() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "junqi-archive-root-symlink-boundary-{}",
            uuid::Uuid::new_v4()
        ));
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let archive_root = root.join("collaboration-bootstrap-archive");
        symlink(&outside, &archive_root).unwrap();
        let package = root.join("package.tgz");
        std::fs::write(&package, b"package-evidence").unwrap();

        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.package.host_tgz_path = package.to_string_lossy().to_string();
        journal.package.sha256 = format!("{:x}", Sha256::digest(b"package-evidence"));
        control.save_journal(&journal).unwrap();

        let error =
            archive_abandoned_bootstrap(&control, &journal, "current-fingerprint").unwrap_err();
        assert!(error.contains("archive root"));
        assert!(std::fs::read_dir(&outside).unwrap().next().is_none());
        assert!(control.load_journal().unwrap().is_some());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_preflight_does_not_create_missing_artifact_directories() {
        let root = std::env::temp_dir().join(format!(
            "junqi-cleanup-missing-artifacts-{}",
            uuid::Uuid::new_v4()
        ));
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let target = test_mutation_target(&root, RuntimeDeploymentKind::SystemService);

        assert!(cleanup_preflight_artifacts(&control, &target, "op-1").is_ok());
        assert!(!root.exists());
    }

    fn configure_params(
        coordinator_agent_id: &str,
        allowed_agent_ids: &[&str],
    ) -> BootstrapConfigureParams {
        BootstrapConfigureParams {
            target_fingerprint: "fp".to_string(),
            expected_connection_id: "connection-before".to_string(),
            coordinator_agent_id: coordinator_agent_id.to_string(),
            allowed_agent_ids: allowed_agent_ids
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        }
    }

    #[test]
    fn agent_configuration_intersects_registry_plugin_and_coordinator_policy() {
        let registry = parse_agent_registry(&serde_json::json!({
            "defaults": { "subagents": { "allowAgents": ["blocked"] } },
            "list": [
                {
                    "id": "Coordinator",
                    "subagents": { "allowAgents": ["coordinator", "worker"] }
                },
                { "id": "Worker" },
                { "id": "Blocked" }
            ]
        }))
        .unwrap();
        let validated = validate_agent_configuration(
            &configure_params("COORDINATOR", &["coordinator", "worker"]),
            &registry,
        )
        .unwrap();
        assert_eq!(validated.coordinator_agent_id, "coordinator");
        assert_eq!(
            validated.allowed_agent_ids,
            vec!["coordinator".to_string(), "worker".to_string()]
        );

        let expanded = validate_agent_configuration(
            &configure_params("coordinator", &["coordinator", "blocked"]),
            &registry,
        )
        .unwrap();
        assert_eq!(
            expanded.coordinator_policy_path.as_deref(),
            Some("agents.list[0].subagents.allowAgents")
        );
        assert_eq!(
            expanded.coordinator_allow_agents_update,
            Some(vec![
                "coordinator".to_string(),
                "worker".to_string(),
                "blocked".to_string(),
            ])
        );
    }

    #[test]
    fn coordinator_policy_override_and_unset_self_only_match_openclaw_semantics() {
        let overridden = parse_agent_registry(&serde_json::json!({
            "defaults": { "subagents": { "allowAgents": ["*"] } },
            "list": [
                {
                    "id": "coordinator",
                    "subagents": { "allowAgents": ["coordinator"] }
                },
                { "id": "worker" }
            ]
        }))
        .unwrap();
        let explicit_expansion = validate_agent_configuration(
            &configure_params("coordinator", &["coordinator", "worker"]),
            &overridden,
        )
        .unwrap();
        assert_eq!(
            explicit_expansion.coordinator_allow_agents_update,
            Some(vec!["coordinator".to_string(), "worker".to_string()])
        );

        let self_only = parse_agent_registry(&serde_json::json!({
            "list": [{ "id": "coordinator" }, { "id": "worker" }]
        }))
        .unwrap();
        assert!(validate_agent_configuration(
            &configure_params("coordinator", &["coordinator"]),
            &self_only,
        )
        .is_ok());
        let missing_policy = validate_agent_configuration(
            &configure_params("coordinator", &["coordinator", "worker"]),
            &self_only,
        )
        .unwrap();
        assert_eq!(
            missing_policy.coordinator_allow_agents_update,
            Some(vec!["coordinator".to_string(), "worker".to_string()])
        );
    }

    #[test]
    fn inherited_policy_is_copied_to_entry_and_expanded_without_touching_defaults() {
        let inherited = parse_agent_registry(&serde_json::json!({
            "defaults": { "subagents": { "allowAgents": ["legacy"] } },
            "list": [
                { "id": "coordinator" },
                { "id": "worker" },
                { "id": "legacy" }
            ]
        }))
        .unwrap();
        let configuration = validate_agent_configuration(
            &configure_params("coordinator", &["coordinator", "worker"]),
            &inherited,
        )
        .unwrap();
        assert_eq!(
            configuration.coordinator_policy_path.as_deref(),
            Some("agents.list[0].subagents.allowAgents")
        );
        assert_eq!(
            configuration.coordinator_allow_agents_update,
            Some(vec![
                "legacy".to_string(),
                "coordinator".to_string(),
                "worker".to_string(),
            ])
        );
        assert_eq!(
            inherited.default_allow_agents,
            Some(vec!["legacy".to_string()])
        );
    }

    #[test]
    fn wildcard_effective_policy_needs_no_coordinator_write_but_plugin_stays_explicit() {
        let registry = parse_agent_registry(&serde_json::json!({
            "defaults": { "subagents": { "allowAgents": ["*"] } },
            "list": [{ "id": "coordinator" }, { "id": "worker" }]
        }))
        .unwrap();
        let configuration = validate_agent_configuration(
            &configure_params("coordinator", &["coordinator", "worker"]),
            &registry,
        )
        .unwrap();
        assert!(configuration.coordinator_policy_path.is_none());
        assert!(configuration.coordinator_allow_agents_update.is_none());
        assert_eq!(
            configuration.allowed_agent_ids,
            vec!["coordinator".to_string(), "worker".to_string()]
        );
    }

    #[test]
    fn explicit_plugin_allowlist_rejects_wildcard_duplicates_and_missing_coordinator() {
        let registry = parse_agent_registry(&serde_json::json!({
            "list": [{
                "id": "coordinator",
                "subagents": { "allowAgents": ["*"] }
            }, { "id": "worker" }]
        }))
        .unwrap();
        assert_eq!(
            validate_agent_configuration(&configure_params("coordinator", &["*"]), &registry)
                .unwrap_err()
                .0,
            "WILDCARD_AGENT_FORBIDDEN"
        );
        assert_eq!(
            validate_agent_configuration(
                &configure_params("coordinator", &["worker one", "worker-one"]),
                &registry,
            )
            .unwrap_err()
            .0,
            "DUPLICATE_AGENT_ID"
        );
        assert_eq!(
            validate_agent_configuration(&configure_params("coordinator", &["worker"]), &registry)
                .unwrap_err()
                .0,
            "COORDINATOR_NOT_ALLOWED"
        );
    }

    #[test]
    fn batch_config_is_atomic_and_adds_only_the_needed_coordinator_policy_path() {
        let mut configuration = ValidatedAgentConfiguration {
            coordinator_agent_id: "coordinator".to_string(),
            allowed_agent_ids: vec!["coordinator".to_string(), "worker".to_string()],
            configured_agent_ids: vec!["coordinator".to_string(), "worker".to_string()],
            coordinator_policy_path: None,
            coordinator_allow_agents_update: None,
        };
        let encoded = collaboration_config_batch_json(&configuration).unwrap();
        let value: Value = serde_json::from_str(&encoded).unwrap();
        let operations = value.as_array().unwrap();
        assert_eq!(operations.len(), 2);
        assert_eq!(
            operations[0]["path"],
            "plugins.entries.junqi-collab.config.coordinatorAgentId"
        );
        assert_eq!(
            operations[1]["path"],
            "plugins.entries.junqi-collab.config.allowedAgentIds"
        );
        assert!(!encoded.contains("\"*\""));

        configuration.coordinator_policy_path =
            Some("agents.list[0].subagents.allowAgents".to_string());
        configuration.coordinator_allow_agents_update = Some(vec![
            "legacy".to_string(),
            "coordinator".to_string(),
            "worker".to_string(),
        ]);
        let expanded: Value =
            serde_json::from_str(&collaboration_config_batch_json(&configuration).unwrap())
                .unwrap();
        assert_eq!(expanded.as_array().unwrap().len(), 3);
        assert_eq!(expanded[2]["path"], "agents.list[0].subagents.allowAgents");
        assert_eq!(expanded[2]["value"][0], "legacy");
    }

    #[test]
    fn restart_gate_requires_exact_connection_operation_and_pending_health() {
        let identity = test_identity(RuntimeDeploymentKind::SystemService, "connection-before");
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.target.deployment_kind = "system_service".to_string();
        journal.status = BootstrapJournalStatus::Completed;
        journal.restart_required = true;
        journal.health_pending = true;
        let params = BootstrapRestartParams {
            operation_id: "op".to_string(),
            target_fingerprint: "fp".to_string(),
            expected_connection_id: "connection-before".to_string(),
        };
        assert!(validate_expected_connection(&identity, &params.expected_connection_id).is_ok());
        assert!(validate_restart_journal(
            &journal,
            &identity,
            &params,
            BootstrapTargetClass::SystemService,
        )
        .is_ok());

        assert_eq!(
            validate_expected_connection(&identity, "connection-after")
                .unwrap_err()
                .0,
            "CONNECTION_CHANGED"
        );
        let mut wrong_operation = BootstrapRestartParams {
            operation_id: "other".to_string(),
            ..params
        };
        assert_eq!(
            validate_restart_journal(
                &journal,
                &identity,
                &wrong_operation,
                BootstrapTargetClass::SystemService,
            )
            .unwrap_err()
            .0,
            "BOOTSTRAP_OPERATION_MISMATCH"
        );
        wrong_operation.operation_id = "op".to_string();
        journal.health_pending = false;
        assert_eq!(
            validate_restart_journal(
                &journal,
                &identity,
                &wrong_operation,
                BootstrapTargetClass::SystemService,
            )
            .unwrap_err()
            .0,
            "BOOTSTRAP_HEALTH_NOT_PENDING"
        );
    }

    #[tokio::test]
    async fn restart_gate_rejects_managed_external_and_duplicate_requests() {
        let external = test_identity(RuntimeDeploymentKind::External, "connection-external");
        assert_eq!(
            resolve_mutation_target(external, "fp").await.unwrap_err().0,
            "EXTERNAL_TARGET_READ_ONLY"
        );

        let managed = test_identity(RuntimeDeploymentKind::ManagedChild, "connection-before");
        let mut journal = test_journal(BootstrapPluginSnapshot::default());
        journal.target.deployment_kind = "managed_child".to_string();
        journal.status = BootstrapJournalStatus::Completed;
        journal.restart_required = true;
        journal.health_pending = true;
        let params = BootstrapRestartParams {
            operation_id: "op".to_string(),
            target_fingerprint: "fp".to_string(),
            expected_connection_id: "connection-before".to_string(),
        };
        assert_eq!(
            validate_restart_journal(
                &journal,
                &managed,
                &params,
                BootstrapTargetClass::NativeManaged,
            )
            .unwrap_err()
            .0,
            "BOOTSTRAP_TARGET_MISMATCH"
        );

        let system = test_identity(RuntimeDeploymentKind::SystemService, "connection-before");
        journal.target.deployment_kind = "system_service".to_string();
        journal.record_step(
            "gateway_restart",
            "requested",
            Some("connection-before".to_string()),
        );
        assert_eq!(
            validate_restart_journal(
                &journal,
                &system,
                &params,
                BootstrapTargetClass::SystemService,
            )
            .unwrap_err()
            .0,
            "GATEWAY_RESTART_ALREADY_REQUESTED"
        );
    }

    #[cfg(unix)]
    fn executable_script(root: &Path, name: &str, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let path = root.join(name);
        std::fs::write(&path, body).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rollback_uses_only_the_hash_verified_offline_backup_and_exact_tree() {
        let root = std::env::temp_dir().join(format!("junqi-offline-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let plugin_root = create_test_plugin_directory(&root, "0.0.9");
        let original = BootstrapPluginSnapshot {
            installed: true,
            enabled: false,
            status: Some("disabled".to_string()),
            version: Some("0.0.9".to_string()),
            source: Some("installed".to_string()),
            root_dir: Some(plugin_root.to_string_lossy().to_string()),
            install_record: Some(serde_json::json!({
                "source": "npm",
                "resolvedSpec": "@junqi/openclaw-collaboration@0.0.9",
                "installPath": plugin_root,
            })),
        };
        let control = CollaborationControlState::with_journal_path(root.join("journal.json"));
        let mut mutation_target = test_mutation_target(&root, RuntimeDeploymentKind::SystemService);
        let backup = backup_original_plugin_archive(&control, &mutation_target, "op", &original)
            .unwrap()
            .unwrap();
        assert!(is_valid_sha256(&backup.archive_sha256));
        assert!(is_valid_sha256(&backup.content_sha256));

        let calls = root.join("calls.log");
        let inspect_json = serde_json::json!({
            "plugin": {
                "id": PLUGIN_ID,
                "enabled": false,
                "status": "disabled",
                "version": "0.0.9",
                "rootDir": original.root_dir,
            },
            "install": original.install_record,
        })
        .to_string();
        let script = executable_script(
            &root,
            "openclaw-test",
            &format!(
                "#!/bin/sh\nprintf '%s\\n' \"$*\" >> '{}'\nif [ \"$1\" = plugins ] && [ \"$2\" = inspect ]; then\n  printf '%s\\n' '{}'\nfi\nexit 0\n",
                calls.to_string_lossy(),
                inspect_json
            ),
        );
        mutation_target.cli.binary = script;

        let mut journal = test_journal(original.clone());
        journal.target.deployment_kind = "system_service".to_string();
        journal.target.state_dir = root.to_string_lossy().to_string();
        journal.target.config_path = root.join("openclaw.json").to_string_lossy().to_string();
        journal.original_plugin_backup_tgz_path = Some(backup.cli_path.clone());
        journal.original_plugin_backup_host_tgz_path = Some(backup.host_path.clone());
        journal.original_plugin_backup_sha256 = Some(backup.archive_sha256.clone());
        journal.original_plugin_content_sha256 = Some(backup.content_sha256.clone());
        control.save_journal(&journal).unwrap();

        let (restored, _) = rollback_plugin(&control, &mut journal, &mutation_target.cli)
            .await
            .unwrap();
        verify_restored_plugin_snapshot(&original, &restored).unwrap();
        verify_restored_plugin_content(&journal, &restored).unwrap();
        let log = std::fs::read_to_string(&calls).unwrap();
        assert!(log.contains(&format!(
            "plugins install --force --pin {}",
            backup.cli_path
        )));
        assert!(!log.contains("@junqi/openclaw-collaboration@0.0.9"));

        let different_archive = root.join("different-original.tgz");
        std::fs::copy(&backup.host_path, &different_archive).unwrap();
        journal.original_plugin_backup_tgz_path =
            Some(different_archive.to_string_lossy().to_string());
        assert!(rollback_source(&journal)
            .unwrap_err()
            .contains("is not the hash-verified host backup"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn official_batch_cli_is_dry_run_then_write_with_readback() {
        let root = std::env::temp_dir().join(format!("junqi-config-cli-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let calls = root.join("calls.log");
        let script = executable_script(
            &root,
            "openclaw-test",
            &format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nif [ \"$1\" = config ] && [ \"$2\" = get ]; then\n  printf '%s\\n' '{{\"coordinatorAgentId\":\"coordinator\",\"allowedAgentIds\":[\"coordinator\",\"worker\"]}}'\nfi\nexit 0\n",
                calls.to_string_lossy()
            ),
        );
        let target = PinnedOpenClawCliTarget::verified(
            &script,
            root.join("state"),
            root.join("state/openclaw.json"),
        )
        .unwrap();
        let configuration = ValidatedAgentConfiguration {
            coordinator_agent_id: "coordinator".to_string(),
            allowed_agent_ids: vec!["coordinator".to_string(), "worker".to_string()],
            configured_agent_ids: vec!["coordinator".to_string(), "worker".to_string()],
            coordinator_policy_path: None,
            coordinator_allow_agents_update: None,
        };
        let batch = collaboration_config_batch_json(&configuration).unwrap();
        run_config_batch(&target, &batch, true).await.unwrap();
        run_config_batch(&target, &batch, false).await.unwrap();
        verify_collaboration_config_readback(&target, &configuration)
            .await
            .unwrap();
        let log = std::fs::read_to_string(&calls).unwrap();
        assert!(log.contains("--batch-json"));
        assert!(log.contains("--dry-run"));
        assert!(log.contains("plugins.entries.junqi-collab.config.coordinatorAgentId"));
        assert!(log.contains("plugins.entries.junqi-collab.config.allowedAgentIds"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn docker_restart_uses_immutable_container_id_not_mutable_name() {
        let root = std::env::temp_dir().join(format!("junqi-docker-cli-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let calls = root.join("calls.log");
        let container_id = "a".repeat(64);
        let script = executable_script(
            &root,
            "docker-test",
            &format!(
                "#!/bin/sh\nprintf '%s ' \"$@\" >> '{}'\nprintf '\\n' >> '{}'\nif [ \"$1\" = inspect ]; then printf '%s|true\\n' '{}'; fi\nexit 0\n",
                calls.to_string_lossy(),
                calls.to_string_lossy(),
                container_id,
            ),
        );
        restart_docker_target_with_binary(script.to_str().unwrap())
            .await
            .unwrap();
        let log = std::fs::read_to_string(&calls).unwrap();
        let lines = log.lines().collect::<Vec<_>>();
        assert!(lines[0].contains(OPENCLAW_CONTAINER_NAME));
        assert!(lines[1].contains(&format!("restart --time 30 {container_id}")));
        assert!(!lines[1].contains(OPENCLAW_CONTAINER_NAME));
        assert!(lines[2].trim_end().ends_with(&container_id));
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn system_service_restart_uses_attested_cli_target_without_fallback() {
        let root = std::env::temp_dir().join(format!("junqi-system-cli-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let calls = root.join("calls.log");
        let script = executable_script(
            &root,
            "openclaw-test",
            &format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" >> '{}'\nexit 0\n",
                calls.to_string_lossy()
            ),
        );
        let target = PinnedOpenClawCliTarget::verified(
            &script,
            root.join("state"),
            root.join("state/openclaw.json"),
        )
        .unwrap();
        restart_system_service_target(&target).await.unwrap();
        assert_eq!(
            std::fs::read_to_string(&calls).unwrap(),
            "gateway\nrestart\n--json\n"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn stale_running_journal_blocks_a_new_apply() {
        let mut snapshot = test_journal(BootstrapPluginSnapshot::default());
        assert!(existing_journal_blocks_apply(Some(&snapshot)));
        snapshot.status = BootstrapJournalStatus::Completed;
        assert!(!existing_journal_blocks_apply(Some(&snapshot)));
        snapshot.health_pending = true;
        assert!(existing_journal_blocks_apply(Some(&snapshot)));
    }
}
