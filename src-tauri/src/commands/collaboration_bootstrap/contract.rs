use crate::state::collaboration_control::{BootstrapPluginSnapshot, CollaborationBootstrapJournal};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

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

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;
    use serde_json::json;

    fn assert_exact_keys(value: impl Serialize, expected: &[&str]) {
        let object = serde_json::to_value(value)
            .unwrap()
            .as_object()
            .cloned()
            .expect("wire DTO must serialize as an object");
        let mut actual = object.keys().map(String::as_str).collect::<Vec<_>>();
        let mut expected = expected.to_vec();
        actual.sort_unstable();
        expected.sort_unstable();
        assert_eq!(actual, expected);
    }

    #[test]
    fn serialized_enums_preserve_all_snake_case_values() {
        for (value, expected) in [
            (BootstrapTargetClass::NativeManaged, "native_managed"),
            (BootstrapTargetClass::SystemService, "system_service"),
            (BootstrapTargetClass::Docker, "docker"),
            (BootstrapTargetClass::ExternalLocal, "external_local"),
            (BootstrapTargetClass::ExternalRemote, "external_remote"),
            (BootstrapTargetClass::Unknown, "unknown"),
        ] {
            assert_eq!(serde_json::to_value(value).unwrap(), json!(expected));
        }
        for (value, expected) in [
            (DurableCollaborationState::Absent, "absent"),
            (DurableCollaborationState::Present, "present"),
            (DurableCollaborationState::Corrupt, "corrupt"),
            (DurableCollaborationState::Unknown, "unknown"),
        ] {
            assert_eq!(serde_json::to_value(value).unwrap(), json!(expected));
        }
    }

    #[test]
    fn every_command_param_preserves_camel_case_and_defaults() {
        let probe: BootstrapProbeParams = serde_json::from_value(json!({})).unwrap();
        assert!(probe.target_fingerprint.is_none());
        assert!(probe.expected_connection_id.is_none());

        let apply: BootstrapApplyParams = serde_json::from_value(json!({
            "targetFingerprint": "target", "expectedConnectionId": "connection"
        }))
        .unwrap();
        assert_eq!(apply.target_fingerprint, "target");

        let recover: BootstrapRecoverParams = serde_json::from_value(json!({
            "targetFingerprint": "target", "expectedConnectionId": "connection", "strategy": "rollback"
        }))
        .unwrap();
        assert!(matches!(
            recover.strategy,
            BootstrapRecoveryStrategy::Rollback
        ));

        let abandon: BootstrapAbandonParams = serde_json::from_value(json!({
            "operationId": "operation", "orphanTargetFingerprint": "orphan",
            "currentTargetFingerprint": "current", "expectedConnectionId": "connection"
        }))
        .unwrap();
        assert_eq!(abandon.operation_id, "operation");

        let health: BootstrapConfirmHealthParams = serde_json::from_value(json!({
            "operationId": "operation", "targetFingerprint": "target",
            "expectedConnectionId": "connection", "collaborationInstanceId": "instance",
            "pluginVersion": "1.0.0", "schemaVersion": 13, "durableState": true
        }))
        .unwrap();
        assert!(!health.durable_runtime);
        assert!(!health.durable_runtime_supported);
        assert!(health.feature_evidence_kind.is_empty());
        assert!(health.features.is_empty());

        let restart: BootstrapRestartParams = serde_json::from_value(json!({
            "operationId": "operation", "targetFingerprint": "target",
            "expectedConnectionId": "connection"
        }))
        .unwrap();
        assert_eq!(restart.operation_id, "operation");

        let configure: BootstrapConfigureParams = serde_json::from_value(json!({
            "targetFingerprint": "target", "expectedConnectionId": "connection",
            "coordinatorAgentId": "main", "allowedAgentIds": ["main", "worker"]
        }))
        .unwrap();
        assert_eq!(configure.allowed_agent_ids, ["main", "worker"]);

        assert!(serde_json::from_value::<BootstrapApplyParams>(json!({
            "target_fingerprint": "target", "expected_connection_id": "connection"
        }))
        .is_err());
        assert!(serde_json::from_value::<BootstrapRecoveryStrategy>(json!("Rollback")).is_err());
    }

    #[test]
    fn every_command_response_preserves_its_exact_camel_case_shape() {
        let plugin = BootstrapPluginSnapshot::default();
        assert_exact_keys(
            CollaborationBootstrapProbe {
                ok: true,
                code: "ok".into(),
                message: "ready".into(),
                target_fingerprint: None,
                connection_id: None,
                target_class: BootstrapTargetClass::NativeManaged,
                deployment_kind: None,
                ownership: None,
                gateway_version: None,
                durable_runtime: true,
                mutation_allowed: true,
                manual_install_required: false,
                binary_path: None,
                state_dir: None,
                config_path: None,
                plugin: plugin.clone(),
                warnings: vec![],
                manual_install_instructions: None,
                busy: false,
                recovery_required: false,
                durable_collaboration_state: DurableCollaborationState::Present,
            },
            &[
                "ok",
                "code",
                "message",
                "targetFingerprint",
                "connectionId",
                "targetClass",
                "deploymentKind",
                "ownership",
                "gatewayVersion",
                "durableRuntime",
                "mutationAllowed",
                "manualInstallRequired",
                "binaryPath",
                "stateDir",
                "configPath",
                "plugin",
                "warnings",
                "manualInstallInstructions",
                "busy",
                "recoveryRequired",
                "durableCollaborationState",
            ],
        );
        assert_exact_keys(
            CollaborationBootstrapStatus {
                busy: false,
                recovery_required: false,
                recoverable: false,
                target_fingerprint: None,
                journal: None,
            },
            &[
                "busy",
                "recoveryRequired",
                "recoverable",
                "targetFingerprint",
                "journal",
            ],
        );
        assert_exact_keys(
            CollaborationBootstrapResult {
                ok: true,
                code: "ok".into(),
                message: "done".into(),
                operation_id: None,
                target_fingerprint: None,
                action: None,
                plugin: Some(plugin),
                restart_required: false,
                health_pending: false,
                recoverable: false,
                warnings: vec![],
            },
            &[
                "ok",
                "code",
                "message",
                "operationId",
                "targetFingerprint",
                "action",
                "plugin",
                "restartRequired",
                "healthPending",
                "recoverable",
                "warnings",
            ],
        );
        assert_exact_keys(
            CollaborationBootstrapAbandonResult {
                ok: true,
                code: "ok".into(),
                message: "done".into(),
                operation_id: None,
                orphan_target_fingerprint: None,
                current_target_fingerprint: None,
                evidence_retained: true,
                apply_unblocked: true,
            },
            &[
                "ok",
                "code",
                "message",
                "operationId",
                "orphanTargetFingerprint",
                "currentTargetFingerprint",
                "evidenceRetained",
                "applyUnblocked",
            ],
        );
        assert_exact_keys(
            CollaborationBootstrapRestartResult {
                ok: true,
                code: "ok".into(),
                message: "done".into(),
                operation_id: None,
                target_fingerprint: None,
                previous_connection_id: None,
                target_class: BootstrapTargetClass::NativeManaged,
                restart_requested: true,
                reconnect_required: true,
                health_pending: true,
            },
            &[
                "ok",
                "code",
                "message",
                "operationId",
                "targetFingerprint",
                "previousConnectionId",
                "targetClass",
                "restartRequested",
                "reconnectRequired",
                "healthPending",
            ],
        );
        assert_exact_keys(
            CollaborationBootstrapConfigureResult {
                ok: true,
                code: "ok".into(),
                message: "done".into(),
                target_fingerprint: None,
                connection_id: None,
                coordinator_agent_id: None,
                allowed_agent_ids: vec![],
                configured_agent_ids: vec![],
                coordinator_policy_updated: true,
                reload_expected: true,
                warnings: vec![],
            },
            &[
                "ok",
                "code",
                "message",
                "targetFingerprint",
                "connectionId",
                "coordinatorAgentId",
                "allowedAgentIds",
                "configuredAgentIds",
                "coordinatorPolicyUpdated",
                "reloadExpected",
                "warnings",
            ],
        );
    }
}
