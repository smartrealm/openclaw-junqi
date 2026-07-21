use crate::paths;
use crate::state::gateway_process::{GatewayLifecycle, GatewayRuntimeMode};
use crate::state::runtime_identity::{
    GatewayHelloObservation, RuntimeAttestation, RuntimeDeploymentKind, RuntimeIdentity,
    RuntimeIdentityIssue, RuntimeIdentityState, RuntimeInstallTarget, RuntimeOwnership,
    RuntimePersistence,
};
use crate::state::GatewayProcess;
use sha2::{Digest, Sha256};
use std::path::{Component, Path, PathBuf};
use tauri::State;
use url::Url;

const DOCKER_STATE_DIR: &str = "/home/node/.openclaw";
const DOCKER_CONFIG_PATH: &str = "/home/node/.openclaw/openclaw.json";

#[derive(Debug, Clone)]
struct RuntimeEvidence {
    lifecycle: GatewayLifecycle,
    mode: GatewayRuntimeMode,
    port: u16,
    local_state_dir: PathBuf,
    local_config_path: PathBuf,
    accepted_observed_paths: Vec<(PathBuf, PathBuf)>,
}

#[derive(Debug)]
struct ParsedEndpoint {
    canonical: String,
    host_is_local: bool,
    port: Option<u16>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearRuntimeIdentityParams {
    connection_id: String,
}

fn deployment_kind(mode: GatewayRuntimeMode) -> RuntimeDeploymentKind {
    match mode {
        GatewayRuntimeMode::SystemService => RuntimeDeploymentKind::SystemService,
        GatewayRuntimeMode::ManagedChild => RuntimeDeploymentKind::ManagedChild,
        GatewayRuntimeMode::Docker => RuntimeDeploymentKind::Docker,
        GatewayRuntimeMode::None | GatewayRuntimeMode::External => RuntimeDeploymentKind::External,
    }
}

fn deployment_key(deployment: RuntimeDeploymentKind) -> &'static str {
    match deployment {
        RuntimeDeploymentKind::External => "external",
        RuntimeDeploymentKind::SystemService => "system_service",
        RuntimeDeploymentKind::ManagedChild => "managed_child",
        RuntimeDeploymentKind::Docker => "docker",
    }
}

fn parse_endpoint(raw: &str) -> Option<ParsedEndpoint> {
    let mut url = Url::parse(raw.trim()).ok()?;
    if !matches!(url.scheme(), "ws" | "wss")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    if url.path().is_empty() {
        url.set_path("/");
    }
    let host = url
        .host_str()?
        .trim_matches(['[', ']'])
        .to_ascii_lowercase();
    let host_is_local = matches!(host.as_str(), "127.0.0.1" | "::1" | "localhost");
    Some(ParsedEndpoint {
        canonical: url.to_string(),
        host_is_local,
        port: url.port_or_known_default(),
    })
}

fn normalize_path(path: &Path) -> PathBuf {
    if let Ok(canonical) = std::fs::canonicalize(path) {
        return canonical;
    }

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

fn comparable_path(path: &Path) -> String {
    let value = normalize_path(path).to_string_lossy().to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn path_pair_matches(
    observed_state_dir: &str,
    observed_config_path: &str,
    expected_pairs: &[(PathBuf, PathBuf)],
) -> bool {
    let observed_state = comparable_path(Path::new(observed_state_dir));
    let observed_config = comparable_path(Path::new(observed_config_path));
    expected_pairs.iter().any(|(state_dir, config_path)| {
        observed_state == comparable_path(state_dir)
            && observed_config == comparable_path(config_path)
    })
}

fn target_fingerprint(
    endpoint: &str,
    deployment: RuntimeDeploymentKind,
    state_dir: Option<&str>,
    config_path: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(endpoint.as_bytes());
    hasher.update(b"\0");
    hasher.update(deployment_key(deployment).as_bytes());
    hasher.update(b"\0");
    if let Some(state_dir) = state_dir {
        hasher.update(comparable_path(Path::new(state_dir)).as_bytes());
    }
    hasher.update(b"\0");
    if let Some(config_path) = config_path {
        hasher.update(comparable_path(Path::new(config_path)).as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn resolve_from_evidence(
    observation: GatewayHelloObservation,
    evidence: RuntimeEvidence,
) -> RuntimeIdentity {
    let deployment = deployment_kind(evidence.mode);
    let managed = !matches!(deployment, RuntimeDeploymentKind::External);
    let parsed_endpoint = parse_endpoint(&observation.endpoint);
    let endpoint = parsed_endpoint
        .as_ref()
        .map(|parsed| parsed.canonical.clone())
        .unwrap_or_else(|| observation.endpoint.trim().to_string());
    let mut issues = Vec::new();

    if parsed_endpoint.is_none() {
        issues.push(RuntimeIdentityIssue::InvalidEndpoint);
    }
    if observation.connection_id.trim().is_empty() {
        issues.push(RuntimeIdentityIssue::MissingConnectionId);
    }
    if observation.server_version.trim().is_empty() {
        issues.push(RuntimeIdentityIssue::MissingServerVersion);
    }
    if observation.protocol == 0 {
        issues.push(RuntimeIdentityIssue::InvalidProtocol);
    }

    let endpoint_matches_supervisor = parsed_endpoint
        .as_ref()
        .map(|parsed| parsed.host_is_local && parsed.port == Some(evidence.port))
        .unwrap_or(false);
    let endpoint_attestation = if managed {
        if endpoint_matches_supervisor {
            RuntimeAttestation::Matched
        } else {
            issues.push(RuntimeIdentityIssue::EndpointMismatch);
            RuntimeAttestation::Mismatched
        }
    } else if endpoint_matches_supervisor {
        RuntimeAttestation::Matched
    } else {
        RuntimeAttestation::NotApplicable
    };

    let path_attestation = match (
        observation.state_dir.as_deref(),
        observation.config_path.as_deref(),
    ) {
        (Some(state_dir), Some(config_path))
            if !state_dir.is_empty() && !config_path.is_empty() =>
        {
            if path_pair_matches(state_dir, config_path, &evidence.accepted_observed_paths) {
                RuntimeAttestation::Matched
            } else {
                if managed {
                    issues.push(RuntimeIdentityIssue::RuntimePathMismatch);
                }
                RuntimeAttestation::Mismatched
            }
        }
        _ => {
            if managed {
                issues.push(RuntimeIdentityIssue::MissingRuntimePaths);
            }
            RuntimeAttestation::Unavailable
        }
    };

    let (ownership, persistence, install_target) = match deployment {
        RuntimeDeploymentKind::ManagedChild => (
            RuntimeOwnership::JunqiManaged,
            RuntimePersistence::DesktopBound,
            RuntimeInstallTarget::NativeCli,
        ),
        RuntimeDeploymentKind::SystemService => (
            RuntimeOwnership::JunqiManaged,
            RuntimePersistence::DesktopIndependent,
            RuntimeInstallTarget::NativeCli,
        ),
        RuntimeDeploymentKind::Docker => (
            RuntimeOwnership::JunqiManaged,
            RuntimePersistence::DesktopIndependent,
            RuntimeInstallTarget::DockerExec,
        ),
        RuntimeDeploymentKind::External => {
            let local = parsed_endpoint
                .as_ref()
                .map(|parsed| parsed.host_is_local)
                .unwrap_or(false);
            (
                if local {
                    RuntimeOwnership::UserManaged
                } else {
                    RuntimeOwnership::Remote
                },
                RuntimePersistence::Unknown,
                RuntimeInstallTarget::RemoteManual,
            )
        }
    };

    let verified = issues.is_empty();
    let desktop_mutation_allowed = verified
        && managed
        && endpoint_attestation == RuntimeAttestation::Matched
        && path_attestation == RuntimeAttestation::Matched;
    let desktop_exit_continuity =
        verified && matches!(persistence, RuntimePersistence::DesktopIndependent);
    let fingerprint = target_fingerprint(
        &endpoint,
        deployment,
        observation.state_dir.as_deref(),
        observation.config_path.as_deref(),
    );

    RuntimeIdentity {
        runtime_id: None,
        target_fingerprint: fingerprint,
        connection_id: observation.connection_id,
        endpoint,
        gateway_version: observation.server_version,
        protocol: observation.protocol,
        state_dir: observation.state_dir,
        config_path: observation.config_path,
        local_state_dir: evidence.local_state_dir.to_string_lossy().to_string(),
        local_config_path: evidence.local_config_path.to_string_lossy().to_string(),
        deployment_kind: deployment,
        ownership,
        persistence,
        install_target,
        endpoint_attestation,
        path_attestation,
        desktop_mutation_allowed,
        desktop_exit_continuity,
        verified,
        issues,
        auth_mode: observation.auth_mode,
        methods: observation.methods,
        events: observation.events,
        negotiated_role: observation.negotiated_role,
        negotiated_scopes: observation.negotiated_scopes,
        supervisor_lifecycle: evidence.lifecycle,
        supervisor_port: evidence.port,
        observed_at_ms: observation.observed_at_ms,
    }
}

fn runtime_evidence(state: &GatewayProcess) -> Result<RuntimeEvidence, String> {
    let runtime = state.runtime_snapshot()?;
    let lifecycle = runtime.lifecycle;
    let mode = runtime.mode;
    let port = *state.port.lock().map_err(|error| error.to_string())?;

    let desktop_state_dir = paths::desktop_dir();
    let desktop_config_path = paths::config_path();
    if mode == GatewayRuntimeMode::Docker {
        let host_state_dir = desktop_state_dir.join("docker");
        let host_config_path = host_state_dir.join("openclaw.json");
        return Ok(RuntimeEvidence {
            lifecycle,
            mode,
            port,
            local_state_dir: host_state_dir.clone(),
            local_config_path: host_config_path.clone(),
            accepted_observed_paths: vec![
                (
                    PathBuf::from(DOCKER_STATE_DIR),
                    PathBuf::from(DOCKER_CONFIG_PATH),
                ),
                (host_state_dir, host_config_path),
            ],
        });
    }

    Ok(RuntimeEvidence {
        lifecycle,
        mode,
        port,
        local_state_dir: desktop_state_dir.clone(),
        local_config_path: desktop_config_path.clone(),
        accepted_observed_paths: vec![(desktop_state_dir, desktop_config_path)],
    })
}

#[tauri::command]
pub async fn resolve_gateway_runtime_identity(
    observation: GatewayHelloObservation,
    gateway_state: State<'_, GatewayProcess>,
    identity_state: State<'_, RuntimeIdentityState>,
) -> Result<RuntimeIdentity, String> {
    let identity = resolve_from_evidence(observation, runtime_evidence(&gateway_state)?);
    if !identity_state.store(identity.clone())? {
        return Err(
            "Gateway connection was invalidated before identity resolution completed".into(),
        );
    }
    Ok(identity)
}

#[tauri::command]
pub async fn get_gateway_runtime_identity(
    identity_state: State<'_, RuntimeIdentityState>,
) -> Result<Option<RuntimeIdentity>, String> {
    identity_state.current()
}

#[tauri::command]
pub async fn clear_gateway_runtime_identity(
    params: ClearRuntimeIdentityParams,
    identity_state: State<'_, RuntimeIdentityState>,
) -> Result<bool, String> {
    identity_state.invalidate(&params.connection_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn observation(connection_id: &str) -> GatewayHelloObservation {
        GatewayHelloObservation {
            endpoint: "ws://127.0.0.1:18789".to_string(),
            protocol: 4,
            server_version: "2026.7.1".to_string(),
            connection_id: connection_id.to_string(),
            state_dir: Some("/tmp/junqi-runtime".to_string()),
            config_path: Some("/tmp/junqi-runtime/openclaw.json".to_string()),
            auth_mode: Some("token".to_string()),
            methods: vec!["sessions.list".to_string()],
            events: vec!["sessions.changed".to_string()],
            negotiated_role: Some("operator".to_string()),
            negotiated_scopes: vec!["operator.read".to_string()],
            observed_at_ms: 42,
        }
    }

    fn evidence(mode: GatewayRuntimeMode) -> RuntimeEvidence {
        let state_dir = PathBuf::from("/tmp/junqi-runtime");
        let config_path = state_dir.join("openclaw.json");
        RuntimeEvidence {
            lifecycle: GatewayLifecycle::Running,
            mode,
            port: 18789,
            local_state_dir: state_dir.clone(),
            local_config_path: config_path.clone(),
            accepted_observed_paths: vec![(state_dir, config_path)],
        }
    }

    #[test]
    fn managed_child_is_always_desktop_bound() {
        let identity = resolve_from_evidence(
            observation("conn-managed"),
            evidence(GatewayRuntimeMode::ManagedChild),
        );
        assert!(identity.verified);
        assert_eq!(identity.persistence, RuntimePersistence::DesktopBound);
        assert!(!identity.desktop_exit_continuity);
        assert!(identity.desktop_mutation_allowed);
    }

    #[test]
    fn managed_runtime_path_mismatch_disables_mutation() {
        let mut hello = observation("conn-mismatch");
        hello.state_dir = Some("/tmp/another-runtime".to_string());
        hello.config_path = Some("/tmp/another-runtime/openclaw.json".to_string());
        let identity = resolve_from_evidence(hello, evidence(GatewayRuntimeMode::SystemService));
        assert!(!identity.verified);
        assert!(!identity.desktop_mutation_allowed);
        assert_eq!(identity.path_attestation, RuntimeAttestation::Mismatched);
        assert!(identity
            .issues
            .contains(&RuntimeIdentityIssue::RuntimePathMismatch));
    }

    #[test]
    fn external_runtime_is_observable_but_never_desktop_mutable() {
        let mut hello = observation("conn-external");
        hello.endpoint = "wss://gateway.example.test".to_string();
        hello.state_dir = Some("/srv/openclaw".to_string());
        hello.config_path = Some("/srv/openclaw/openclaw.json".to_string());
        let identity = resolve_from_evidence(hello, evidence(GatewayRuntimeMode::External));
        assert!(identity.verified);
        assert_eq!(identity.ownership, RuntimeOwnership::Remote);
        assert_eq!(identity.persistence, RuntimePersistence::Unknown);
        assert!(!identity.desktop_mutation_allowed);
        assert!(!identity.desktop_exit_continuity);
    }

    #[test]
    fn fingerprint_is_stable_across_gateway_connections() {
        let first = resolve_from_evidence(
            observation("conn-one"),
            evidence(GatewayRuntimeMode::ManagedChild),
        );
        let second = resolve_from_evidence(
            observation("conn-two"),
            evidence(GatewayRuntimeMode::ManagedChild),
        );
        assert_eq!(first.target_fingerprint, second.target_fingerprint);
    }

    #[test]
    fn docker_accepts_the_container_visible_state_path() {
        let mut hello = observation("conn-docker");
        hello.state_dir = Some(DOCKER_STATE_DIR.to_string());
        hello.config_path = Some(DOCKER_CONFIG_PATH.to_string());
        let mut docker_evidence = evidence(GatewayRuntimeMode::Docker);
        docker_evidence.accepted_observed_paths = vec![(
            PathBuf::from(DOCKER_STATE_DIR),
            PathBuf::from(DOCKER_CONFIG_PATH),
        )];
        let identity = resolve_from_evidence(hello, docker_evidence);
        assert!(identity.verified);
        assert_eq!(identity.install_target, RuntimeInstallTarget::DockerExec);
        assert!(identity.desktop_exit_continuity);
    }
}
