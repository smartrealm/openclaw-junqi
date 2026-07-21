export const JUNQI_COLLABORATION_PLUGIN_ID = 'junqi-collab' as const;

export type BootstrapTargetClass =
  | 'native_managed'
  | 'system_service'
  | 'docker'
  | 'external_local'
  | 'external_remote'
  | 'unknown';

export type BootstrapOperationKind = 'apply' | 'recover_resume' | 'recover_rollback';
export type BootstrapJournalStatus =
  | 'running'
  | 'recovery_required'
  | 'completed'
  | 'rolled_back'
  | 'abandoned';
export type BootstrapRecoveryStrategy = 'resume' | 'rollback';

export type DurableCollaborationState = 'absent' | 'present' | 'corrupt' | 'unknown';

export interface BootstrapJournalStep {
  name: string;
  status: string;
  atMs: number;
  diagnostic?: string;
}

export interface BootstrapTargetSnapshot {
  targetFingerprint: string;
  connectionId: string;
  deploymentKind: string;
  ownership: string;
  gatewayVersion: string;
  binaryPath: string;
  stateDir: string;
  configPath: string;
}

export interface BootstrapPackageSnapshot {
  sourceTgzPath: string;
  hostTgzPath: string;
  tgzPath: string;
  sha256: string;
  pluginId: string;
  pluginVersion: string;
}

export interface BootstrapPluginSnapshot {
  installed: boolean;
  enabled: boolean;
  status?: string;
  version?: string;
  source?: string;
  rootDir?: string;
  installRecord?: unknown;
}

export interface BootstrapHealthSnapshot {
  collaborationInstanceId: string;
  pluginVersion: string;
  schemaVersion: number;
  confirmedAtMs: number;
}

export interface CollaborationBootstrapJournal {
  version: number;
  operationId: string;
  operation: BootstrapOperationKind;
  status: BootstrapJournalStatus;
  target: BootstrapTargetSnapshot;
  package: BootstrapPackageSnapshot;
  originalPlugin: BootstrapPluginSnapshot;
  originalPluginBackupTgzPath?: string;
  originalPluginBackupHostTgzPath?: string;
  originalPluginBackupSha256?: string;
  originalPluginContentSha256?: string;
  originalConfigSha256: string;
  originalConfigBackupPath?: string;
  bootstrapOwnedConfigSha256?: string;
  startedAtMs: number;
  updatedAtMs: number;
  restartRequired: boolean;
  healthPending: boolean;
  health?: BootstrapHealthSnapshot;
  steps: BootstrapJournalStep[];
  diagnostics: string[];
}

export interface BootstrapProbeParams {
  targetFingerprint?: string;
  expectedConnectionId?: string;
}

export interface CollaborationBootstrapProbe {
  ok: boolean;
  code: string;
  message: string;
  targetFingerprint: string | null;
  connectionId: string | null;
  targetClass: BootstrapTargetClass;
  deploymentKind: string | null;
  ownership: string | null;
  gatewayVersion: string | null;
  durableRuntime: boolean;
  mutationAllowed: boolean;
  manualInstallRequired: boolean;
  binaryPath: string | null;
  stateDir: string | null;
  configPath: string | null;
  plugin: BootstrapPluginSnapshot;
  warnings: string[];
  manualInstallInstructions: string | null;
  busy: boolean;
  recoveryRequired: boolean;
  durableCollaborationState: DurableCollaborationState;
}

export interface BootstrapApplyParams {
  targetFingerprint: string;
  expectedConnectionId: string;
}

export interface BootstrapRecoverParams {
  targetFingerprint: string;
  expectedConnectionId: string;
  strategy: BootstrapRecoveryStrategy;
}

export interface BootstrapAbandonParams {
  operationId: string;
  orphanTargetFingerprint: string;
  currentTargetFingerprint: string;
  expectedConnectionId: string;
}

export interface BootstrapConfirmHealthParams {
  operationId: string;
  targetFingerprint: string;
  expectedConnectionId: string;
  collaborationInstanceId: string;
  pluginVersion: string;
  schemaVersion: number;
  durableState: boolean;
  durableRuntime: boolean;
  durableRuntimeSupported: boolean;
  featureEvidenceKind: string;
  featureEvidenceBehaviorVerified: boolean;
  featureEvidenceRequiredBehaviorGate: string;
  featureEvidencePluginServiceStarted: boolean;
  featureEvidenceDatabaseIntegrity: string;
  features: Record<string, boolean>;
}

export interface BootstrapRestartParams {
  operationId: string;
  targetFingerprint: string;
  expectedConnectionId: string;
}

export interface BootstrapConfigureParams {
  targetFingerprint: string;
  expectedConnectionId: string;
  coordinatorAgentId: string;
  /** Explicit OpenClaw agent ids. Wildcard authorization is intentionally forbidden. */
  allowedAgentIds: string[];
}

export interface CollaborationBootstrapStatus {
  busy: boolean;
  recoveryRequired: boolean;
  recoverable: boolean;
  targetFingerprint: string | null;
  journal: CollaborationBootstrapJournal | null;
}

export interface CollaborationBootstrapResult {
  ok: boolean;
  code: string;
  message: string;
  operationId: string | null;
  targetFingerprint: string | null;
  action: string | null;
  plugin: BootstrapPluginSnapshot | null;
  restartRequired: boolean;
  healthPending: boolean;
  recoverable: boolean;
  warnings: string[];
}

export interface CollaborationBootstrapAbandonResult {
  ok: boolean;
  code: string;
  message: string;
  operationId: string | null;
  orphanTargetFingerprint: string | null;
  currentTargetFingerprint: string | null;
  evidenceRetained: boolean;
  applyUnblocked: boolean;
}

export interface CollaborationBootstrapRestartResult {
  ok: boolean;
  code: string;
  message: string;
  operationId: string | null;
  targetFingerprint: string | null;
  previousConnectionId: string | null;
  targetClass: BootstrapTargetClass;
  restartRequested: boolean;
  reconnectRequired: boolean;
  healthPending: boolean;
}

export interface CollaborationBootstrapConfigureResult {
  ok: boolean;
  code: string;
  message: string;
  targetFingerprint: string | null;
  connectionId: string | null;
  coordinatorAgentId: string | null;
  allowedAgentIds: string[];
  configuredAgentIds: string[];
  coordinatorPolicyUpdated: boolean;
  reloadExpected: boolean;
  warnings: string[];
}
