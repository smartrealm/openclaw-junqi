use super::{BootstrapProbeParams, BootstrapTargetClass};
use crate::commands::docker::OPENCLAW_CONTAINER_NAME;
use crate::commands::openclaw_cli::PinnedOpenClawCliTarget;
use crate::commands::system;
use crate::state::runtime_identity::{
    RuntimeDeploymentKind, RuntimeIdentity, RuntimeIdentityState, RuntimeInstallTarget,
    RuntimeOwnership, RuntimePersistence,
};
use std::path::Path;

#[derive(Debug)]
pub(super) struct MutationTarget {
    pub(super) identity: RuntimeIdentity,
    pub(super) class: BootstrapTargetClass,
    pub(super) cli: PinnedOpenClawCliTarget,
}

pub(super) fn deployment_name(kind: RuntimeDeploymentKind) -> &'static str {
    match kind {
        RuntimeDeploymentKind::External => "external",
        RuntimeDeploymentKind::SystemService => "system_service",
        RuntimeDeploymentKind::ManagedChild => "managed_child",
        RuntimeDeploymentKind::Docker => "docker",
    }
}

pub(super) fn ownership_name(ownership: RuntimeOwnership) -> &'static str {
    match ownership {
        RuntimeOwnership::JunqiManaged => "junqi_managed",
        RuntimeOwnership::UserManaged => "user_managed",
        RuntimeOwnership::Remote => "remote",
    }
}

pub(super) fn target_class(identity: &RuntimeIdentity) -> BootstrapTargetClass {
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

pub(super) fn is_durable(class: BootstrapTargetClass) -> bool {
    matches!(
        class,
        BootstrapTargetClass::SystemService
            | BootstrapTargetClass::Docker
            | BootstrapTargetClass::ExternalLocal
            | BootstrapTargetClass::ExternalRemote
    )
}

pub(super) fn current_identity(
    state: &RuntimeIdentityState,
) -> Result<Option<RuntimeIdentity>, String> {
    state.current()
}

pub(super) fn validate_fingerprint(
    identity: &RuntimeIdentity,
    expected: &str,
) -> Result<(), String> {
    if expected.trim().is_empty() {
        return Err("TARGET_FINGERPRINT_REQUIRED".to_string());
    }
    if identity.target_fingerprint != expected.trim() {
        return Err("TARGET_CHANGED".to_string());
    }
    Ok(())
}

pub(super) fn validate_probe_identity(
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

pub(super) fn same_probe_identity(left: &RuntimeIdentity, right: &RuntimeIdentity) -> bool {
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

pub(super) async fn resolve_mutation_target(
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

pub(super) fn validate_expected_connection(
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

pub(super) fn validate_durable_identity(
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

pub(super) fn validate_durable_mutation_target(
    target: &MutationTarget,
) -> Result<(), (String, String)> {
    validate_durable_identity(&target.identity, target.class)
}

pub(super) fn validate_current_operation_identity(
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
