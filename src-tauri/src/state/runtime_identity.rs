use crate::state::gateway_process::GatewayLifecycle;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;

const INVALIDATED_CONNECTION_LIMIT: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeDeploymentKind {
    External,
    SystemService,
    ManagedChild,
    Docker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeOwnership {
    JunqiManaged,
    UserManaged,
    Remote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimePersistence {
    DesktopIndependent,
    DesktopBound,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeInstallTarget {
    NativeCli,
    DockerExec,
    RemoteManual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeAttestation {
    Matched,
    Mismatched,
    Unavailable,
    NotApplicable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeIdentityIssue {
    InvalidEndpoint,
    MissingConnectionId,
    MissingServerVersion,
    InvalidProtocol,
    EndpointMismatch,
    MissingRuntimePaths,
    RuntimePathMismatch,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayHelloObservation {
    pub endpoint: String,
    pub protocol: u32,
    pub server_version: String,
    pub connection_id: String,
    #[serde(default)]
    pub state_dir: Option<String>,
    #[serde(default)]
    pub config_path: Option<String>,
    #[serde(default)]
    pub auth_mode: Option<String>,
    #[serde(default)]
    pub methods: Vec<String>,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub negotiated_role: Option<String>,
    #[serde(default)]
    pub negotiated_scopes: Vec<String>,
    pub observed_at_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeIdentity {
    /// Reserved for the durable id supplied by the collaboration plugin.
    pub runtime_id: Option<String>,
    /// Stable pre-plugin target key. Connection ids and process ids are excluded.
    pub target_fingerprint: String,
    pub connection_id: String,
    pub endpoint: String,
    pub gateway_version: String,
    pub protocol: u32,
    pub state_dir: Option<String>,
    pub config_path: Option<String>,
    pub local_state_dir: String,
    pub local_config_path: String,
    pub deployment_kind: RuntimeDeploymentKind,
    pub ownership: RuntimeOwnership,
    pub persistence: RuntimePersistence,
    pub install_target: RuntimeInstallTarget,
    pub endpoint_attestation: RuntimeAttestation,
    pub path_attestation: RuntimeAttestation,
    pub desktop_mutation_allowed: bool,
    pub desktop_exit_continuity: bool,
    pub verified: bool,
    pub issues: Vec<RuntimeIdentityIssue>,
    pub auth_mode: Option<String>,
    pub methods: Vec<String>,
    pub events: Vec<String>,
    pub negotiated_role: Option<String>,
    pub negotiated_scopes: Vec<String>,
    pub supervisor_lifecycle: GatewayLifecycle,
    pub supervisor_port: u16,
    pub observed_at_ms: u64,
}

#[derive(Default)]
struct RuntimeIdentityCache {
    current: Option<RuntimeIdentity>,
    invalidated_connections: VecDeque<String>,
}

pub struct RuntimeIdentityState {
    cache: Mutex<RuntimeIdentityCache>,
}

impl RuntimeIdentityState {
    pub fn new() -> Self {
        Self {
            cache: Mutex::new(RuntimeIdentityCache::default()),
        }
    }

    pub fn current(&self) -> Result<Option<RuntimeIdentity>, String> {
        self.cache
            .lock()
            .map(|cache| cache.current.clone())
            .map_err(|error| error.to_string())
    }

    /// Stores an identity unless its connection was already invalidated by a
    /// close event that raced the Tauri command response.
    pub fn store(&self, identity: RuntimeIdentity) -> Result<bool, String> {
        let mut cache = self.cache.lock().map_err(|error| error.to_string())?;
        if cache
            .invalidated_connections
            .iter()
            .any(|connection_id| connection_id == &identity.connection_id)
        {
            return Ok(false);
        }
        cache.current = Some(identity);
        Ok(true)
    }

    pub fn invalidate(&self, connection_id: &str) -> Result<bool, String> {
        if connection_id.trim().is_empty() {
            return Ok(false);
        }

        let mut cache = self.cache.lock().map_err(|error| error.to_string())?;
        if !cache
            .invalidated_connections
            .iter()
            .any(|invalidated| invalidated == connection_id)
        {
            cache
                .invalidated_connections
                .push_back(connection_id.to_string());
            while cache.invalidated_connections.len() > INVALIDATED_CONNECTION_LIMIT {
                cache.invalidated_connections.pop_front();
            }
        }

        let should_clear = cache
            .current
            .as_ref()
            .map(|identity| identity.connection_id == connection_id)
            .unwrap_or(false);
        if should_clear {
            cache.current = None;
        }
        Ok(should_clear)
    }
}

impl Default for RuntimeIdentityState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(connection_id: &str) -> RuntimeIdentity {
        RuntimeIdentity {
            runtime_id: None,
            target_fingerprint: "target".to_string(),
            connection_id: connection_id.to_string(),
            endpoint: "ws://127.0.0.1:18789".to_string(),
            gateway_version: "2026.7.1".to_string(),
            protocol: 4,
            state_dir: None,
            config_path: None,
            local_state_dir: "/tmp/openclaw".to_string(),
            local_config_path: "/tmp/openclaw/openclaw.json".to_string(),
            deployment_kind: RuntimeDeploymentKind::ManagedChild,
            ownership: RuntimeOwnership::JunqiManaged,
            persistence: RuntimePersistence::DesktopBound,
            install_target: RuntimeInstallTarget::NativeCli,
            endpoint_attestation: RuntimeAttestation::Matched,
            path_attestation: RuntimeAttestation::Matched,
            desktop_mutation_allowed: true,
            desktop_exit_continuity: false,
            verified: true,
            issues: vec![],
            auth_mode: Some("token".to_string()),
            methods: vec![],
            events: vec![],
            negotiated_role: Some("operator".to_string()),
            negotiated_scopes: vec!["operator.read".to_string()],
            supervisor_lifecycle: GatewayLifecycle::Running,
            supervisor_port: 18789,
            observed_at_ms: 1,
        }
    }

    #[test]
    fn invalidated_connection_cannot_be_restored_by_a_late_response() {
        let state = RuntimeIdentityState::new();
        assert!(!state.invalidate("conn-old").unwrap());
        assert!(!state.store(identity("conn-old")).unwrap());
        assert!(state.current().unwrap().is_none());
    }

    #[test]
    fn invalidating_an_old_connection_does_not_clear_the_new_identity() {
        let state = RuntimeIdentityState::new();
        assert!(state.store(identity("conn-new")).unwrap());
        assert!(!state.invalidate("conn-old").unwrap());
        assert_eq!(state.current().unwrap().unwrap().connection_id, "conn-new");
    }
}
