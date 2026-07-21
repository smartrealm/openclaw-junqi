export const COLLABORATION_RPC_PREFIX = 'junqi.collab.' as const;

export const RUN_STATUSES = [
  'DRAFT',
  'PLANNING',
  'AWAITING_APPROVAL',
  'PROVISIONING',
  'RUNNING',
  'AWAITING_INTERVENTION',
  'SYNTHESIZING',
  'FINALIZING',
  'DELIVERY_PENDING',
  'COMPLETED',
  'CANCELLING',
  'CANCELLED',
  'FAILED',
] as const;

export type CollaborationRunStatus = (typeof RUN_STATUSES)[number];
export const DISPATCH_STATES = ['OPEN', 'STOPPED', 'CLOSED'] as const;
export const ARCHIVE_STATES = ['ACTIVE', 'ARCHIVED'] as const;
export const RECONCILE_STATES = ['IDLE', 'RUNNING', 'ATTENTION_REQUIRED'] as const;
export const WORK_ITEM_STATUSES = [
  'PLANNED',
  'BLOCKED',
  'READY',
  'DISPATCHING',
  'RUNNING',
  'SUCCEEDED',
  'NEEDS_INTERVENTION',
  'CANCELLING',
  'CANCELLED',
  'WAIVED',
] as const;
export const ATTEMPT_STATUSES = [
  'CREATED',
  'DISPATCHING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLING',
  'CANCELLED',
  'UNKNOWN',
  'ABANDONED',
] as const;
export const DELIVERY_STATUSES = [
  'PREPARED',
  'SENDING',
  'DELIVERED',
  'RETRY_REQUIRED',
  'UNKNOWN',
  'ABANDONED',
] as const;
export const TRANSCRIPT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'UNKNOWN', 'SESSION_REBOUND'] as const;
export const CHANNEL_STATUSES = ['NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'FAILED', 'UNSUPPORTED', 'UNKNOWN'] as const;
export const DELIVERY_REQUIREMENTS = ['TRANSCRIPT', 'TRANSCRIPT_AND_CHANNEL'] as const;
export const ATTEMPT_KINDS = ['PLANNER', 'WORKER', 'SYNTHESIZER'] as const;
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const SIDE_EFFECT_CLASSES = ['READ_ONLY', 'LOCAL_WRITE', 'EXTERNAL_WRITE', 'DESTRUCTIVE'] as const;
export const RESIDUAL_EXECUTION_RISK_INTERVENTION_CODE = 'ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK' as const;

export const COLLABORATION_SESSION_MUTATION_ACTIONS = ['reset', 'delete'] as const;
export const COLLABORATION_SESSION_MUTATION_POLICIES = [
  'PROCEED',
  'CANCEL_AND_WAIT',
  'STOP_AND_RETARGET_LATER',
] as const;
export const COLLABORATION_SESSION_MUTATION_STRATEGIES = [
  ...COLLABORATION_SESSION_MUTATION_POLICIES,
  'ABORT',
  'RECOVER',
] as const;
export const COLLABORATION_SESSION_MUTATION_STATUSES = ['PREPARED', 'EXPIRED'] as const;

export type CollaborationDispatchState = (typeof DISPATCH_STATES)[number];
export type CollaborationArchiveState = (typeof ARCHIVE_STATES)[number];
export type CollaborationReconcileState = (typeof RECONCILE_STATES)[number];
export type CollaborationCompletionOutcome = 'FULL' | 'PARTIAL' | null;

export type CollaborationWorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export type CollaborationAttemptStatus = (typeof ATTEMPT_STATUSES)[number];
export type CollaborationDeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type CollaborationSessionMutationAction =
  (typeof COLLABORATION_SESSION_MUTATION_ACTIONS)[number];
export type CollaborationSessionMutationPolicy =
  (typeof COLLABORATION_SESSION_MUTATION_POLICIES)[number];
export type CollaborationSessionMutationStrategy =
  (typeof COLLABORATION_SESSION_MUTATION_STRATEGIES)[number];
export type CollaborationSessionMutationStatus =
  (typeof COLLABORATION_SESSION_MUTATION_STATUSES)[number];

export const COLLABORATION_ERROR_CODES = [
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'CAPACITY_EXCEEDED',
  'NOT_FOUND',
  'REVISION_CONFLICT',
  'INVALID_TRANSITION',
  'IDEMPOTENCY_CONFLICT',
  'ACTIVE_RUN_EXISTS',
  'ACTIVE_ATTEMPT_EXISTS',
  'CAPABILITY_CHANGED',
  'RUNTIME_NOT_DURABLE',
  'RUNTIME_TIMEOUT',
  'INSTANCE_MISMATCH',
  'ORIGIN_NOT_DURABLE',
  'SESSION_IDENTITY_MISMATCH',
  'PARTIAL_CLOSURE_REQUIRED',
  'DELIVERY_UNKNOWN',
  'SESSION_MUTATION_ACTIVE',
  'DELETE_REQUIRES_TERMINAL',
  'FLOW_RECONCILIATION_REQUIRED',
  'MAINTENANCE_ACTIVE',
  'PLUGIN_NOT_CONFIGURED',
  'VERSION_INCOMPATIBLE',
  'UNAVAILABLE',
  'INTERNAL_ERROR',
  'RPC_FAILED',
] as const;

export type CollaborationErrorCode = (typeof COLLABORATION_ERROR_CODES)[number];

const COLLABORATION_ERROR_CODE_SET = new Set<string>(COLLABORATION_ERROR_CODES);

export function isCollaborationErrorCode(value: unknown): value is CollaborationErrorCode {
  return typeof value === 'string' && COLLABORATION_ERROR_CODE_SET.has(value);
}

export interface CollaborationOriginRef {
  runtimeId: string;
  agentId: string;
  sessionKey: string;
  sessionId: string;
  nativeMessageId: string;
  clientMessageId?: string;
  channel?: string;
  accountId?: string;
  target?: string;
  threadId?: string | number;
}

export interface CollaborationCapabilityAgent {
  id: string;
  name?: string;
  description?: string;
  model?: unknown;
  runtimeType: 'native' | 'acp';
  allowed: boolean;
  coordinator: boolean;
}

export interface CollaborationCapabilities {
  collaborationInstanceId: string;
  pluginId?: string;
  schemaVersion: number;
  pluginVersion?: string;
  runtimeVersion?: string;
  runtimeId?: string;
  durableState?: boolean;
  durableRuntime: boolean;
  databaseIntegrity?: string;
  durableRuntimeDetails?: {
    supported: boolean;
    required?: boolean;
    reason?: string | null;
    [key: string]: unknown;
  };
  eventPush?: boolean;
  features?: Record<string, boolean>;
  featureEvidence?: {
    kind: 'DECLARED_PLUGIN_CONTRACT';
    behaviorVerified: boolean;
    structuralChecks?: Record<string, unknown>;
    requiredBehaviorGate?: string;
  };
  configured?: boolean;
  configuredAgents: CollaborationCapabilityAgent[];
  coordinatorAgentId: string | null;
  allowedAgentIds: string[];
  repairs: string[];
  trustTier?: string;
  workboard?: {
    supported: boolean;
    reason?: string | null;
  };
  sessionCapabilities: {
    deleteExpectedSessionId: boolean;
    resetExpectedSessionId: boolean;
  };
  maintenance?: {
    active: boolean;
    lease?: Record<string, unknown> | null;
    activeRuns?: Array<Record<string, unknown>>;
    activeRunCount?: number;
    activeRunsTruncated?: boolean;
  };
  diagnostics?: Record<string, unknown>;
}

export interface CollaborationRunSummary {
  runId: string;
  status: CollaborationRunStatus;
  dispatchState: CollaborationDispatchState;
  archiveState: CollaborationArchiveState;
  reconcileState: CollaborationReconcileState;
  completionOutcome: CollaborationCompletionOutcome;
  revision: number;
  lastEventSequence: number;
  goal: string;
  origin: CollaborationOriginRef;
  currentPlanRevisionId: string | null;
  allowedActions: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * The intentionally slim run projection returned by session-mutation prepare.
 * It is not a substitute for a full Run summary: no goal, action projection,
 * or event watermark is available on this wire path.
 */
export type CollaborationRunReference = Pick<
  CollaborationRunSummary,
  | 'runId'
  | 'status'
  | 'dispatchState'
  | 'archiveState'
  | 'reconcileState'
  | 'completionOutcome'
  | 'revision'
  | 'origin'
  | 'currentPlanRevisionId'
  | 'createdAt'
  | 'updatedAt'
>;

export interface CollaborationFlowReconciliationBlocker {
  commandId: string;
  commandStatus: string;
  flowId: string | null;
  flowRevision: number | null;
  diagnostic: string | null;
}

export interface CollaborationPartialPreview {
  runId: string;
  runRevision: number;
  closure: {
    waiveIds: string[];
    blockedDescendantIds: string[];
    activeIds: string[];
  };
  expiresAt: number;
  confirmationToken: string;
}

export interface CollaborationDeletePreview {
  runId: string;
  runRevision: number;
  digest: string;
  expiresAt: number;
  confirmationToken: string;
  flowReconciliationBlocker?: CollaborationFlowReconciliationBlocker;
}

export interface CollaborationActiveSessionMutation {
  mutationId: string;
  runtimeId: string;
  sessionKey: string;
  sessionId: string;
  action: CollaborationSessionMutationAction;
  policy: CollaborationSessionMutationPolicy;
  status: CollaborationSessionMutationStatus;
  expiresAt: number;
  result: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

/** Authoritative plugin projection before the Desktop adds its instance fence. */
export interface CollaborationSessionMutationImpactResponse {
  runtimeId: string;
  sessionKey: string;
  sessionId: string;
  action: CollaborationSessionMutationAction;
  activeRuns: CollaborationRunSummary[];
  activeMutation: CollaborationActiveSessionMutation | null;
  blocked: boolean;
  runtimeMatches: true;
  mutationFenceActive: boolean;
  recoveryRequired: boolean;
  coreRpcAllowed: boolean;
  resetCasSupported: boolean;
  strategies: CollaborationSessionMutationStrategy[];
}

export interface CollaborationWorkItemSnapshot {
  id: string;
  logicalId: string;
  planRevisionId: string;
  title: string;
  status: CollaborationWorkItemStatus;
  assignedAgentId?: string | null;
  inputScope: string[];
  dependencies: string[];
  requiredCapabilities: string[];
  candidateAgentIds: string[];
  acceptanceCriteria: string[];
  revision: number;
  riskLevel: (typeof RISK_LEVELS)[number];
  sideEffectClass: (typeof SIDE_EFFECT_CLASSES)[number];
}

export interface CollaborationAttemptSnapshot {
  id: string;
  workItemId?: string | null;
  kind: (typeof ATTEMPT_KINDS)[number];
  attemptNo: number;
  status: CollaborationAttemptStatus;
  workerAgentId: string;
  /** Frozen at dispatch approval; older plugins omitted this and are native by default. */
  executionRuntime?: 'native' | 'acp';
  executionTaskId?: string | null;
  agentRunId?: string | null;
  workerSessionKey?: string | null;
  workerSessionId?: string | null;
  /** Server-projected eligibility; omitted by older collaboration plugins. */
  canAbandonWithResidualRisk?: boolean;
  revision: number;
  startedAt?: number | null;
  endedAt?: number | null;
  lastError?: string | null;
}

export interface CollaborationInterventionSnapshot {
  id: string;
  code: string;
  entityRef?: { type: string; id: string } | null;
  requiredAction: string;
  diagnostics?: Record<string, unknown>;
  resumeStatus: CollaborationRunStatus;
  createdAt: number;
  resolvedAt?: number | null;
}

export interface CollaborationDeliverySnapshot {
  id: string;
  targetRevision: number;
  status: CollaborationDeliveryStatus;
  transcriptStatus: (typeof TRANSCRIPT_STATUSES)[number];
  channelStatus: (typeof CHANNEL_STATUSES)[number];
  requirement: (typeof DELIVERY_REQUIREMENTS)[number];
  revision: number;
  target: CollaborationOriginRef;
  messageId?: string | null;
}

/** Agent-independent definition returned by the durable workflow-template catalog. */
export interface CollaborationWorkflowTemplateDefinition {
  schemaVersion: number;
  goal: string;
  workItems: Array<{
    id: string;
    title: string;
    dependencies: string[];
  }>;
  synthesis: {
    requiredEvidence: string[];
    finalAnswerContract: string;
  };
}

export interface CollaborationWorkflowTemplate {
  id: string;
  name: string;
  status: 'PUBLISHED';
  sourceRunId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  currentVersion: {
    id: string;
    templateId: string;
    versionNo: number;
    digest: string;
    sourceRunId: string | null;
    sourcePlanRevisionId: string | null;
    createdBy: string;
    createdAt: number;
    definition: CollaborationWorkflowTemplateDefinition;
  };
}

export interface CollaborationWorkflowTemplateLink {
  templateId: string;
  templateVersionId: string;
  templateName: string;
  templateVersionNo: number;
  templateDigest: string;
  parameterDigest: string;
  instantiatedAt: number;
}

export interface CollaborationRunSnapshot extends CollaborationRunSummary {
  snapshotRevision: number;
  workItems: CollaborationWorkItemSnapshot[];
  attempts: CollaborationAttemptSnapshot[];
  interventions: CollaborationInterventionSnapshot[];
  deliveries: CollaborationDeliverySnapshot[];
  planRevisions?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  decisions?: Array<Record<string, unknown>>;
  workflowTemplate?: CollaborationWorkflowTemplateLink | null;
  finalArtifact?: Record<string, unknown> | null;
}

export interface CollaborationEvent {
  sequence: number;
  runId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  runRevision: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CollaborationRunGetResponse {
  collaborationInstanceId: string;
  snapshot: CollaborationRunSnapshot;
}

export interface CollaborationRunListResponse {
  collaborationInstanceId: string;
  runs: CollaborationRunSummary[];
  nextCursor: string | null;
  snapshotRevision?: number;
}

export interface CollaborationWorkflowTemplateListResponse {
  collaborationInstanceId: string;
  templates: CollaborationWorkflowTemplate[];
}

export type CollaborationTombstoneCleanupStatus = 'COMPLETED' | 'PENDING' | 'PARTIAL';
export type CollaborationDeletionJobStatus = 'PENDING' | 'FAILED' | 'PARTIAL' | 'COMPLETED';
export type CollaborationExportJobStatus = 'PENDING' | 'FAILED' | 'COMPLETED';

export interface CollaborationDeletionJob {
  id: string;
  runId: string;
  status: CollaborationDeletionJobStatus;
  confirmationDigest: string;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollaborationExportJob {
  id: string;
  runId: string;
  status: CollaborationExportJobStatus;
  format: 'json';
  artifactPath: string | null;
  digest: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CollaborationExportArtifact {
  jobId: string;
  format: 'json';
  digest: string;
  content: string;
}

export interface CollaborationTombstone {
  id: string;
  runId: string;
  actor: string;
  contentDigest: string;
  deletedAt: number;
  cleanupStatus: CollaborationTombstoneCleanupStatus;
  cleanupError: string | null;
  cleanupUpdatedAt: number;
  deletionJobId: string | null;
  deletionJobStatus: CollaborationDeletionJobStatus | null;
  flowReconciliationCommandId: string | null;
  openclawFlowId: string | null;
  openclawFlowRevision: number | null;
  flowReconciliationDiagnostic: string | null;
  flowReconciliationAbandonedAt: number | null;
  flowReconciliationAbandonReason: string | null;
}

export interface CollaborationTombstoneListResponse {
  collaborationInstanceId: string;
  tombstones: CollaborationTombstone[];
}

export interface CollaborationEventsPage {
  collaborationInstanceId: string;
  runId: string;
  events: CollaborationEvent[];
  nextSequence: number;
  lastSequence: number;
  hasMore: boolean;
  snapshotRevision: number;
  cursorInvalid?: boolean;
  cursorInvalidReason?: 'expired' | 'ahead' | 'compacted' | 'instance_changed' | string;
}

/**
 * Compile-time source of truth for the operational read RPCs consumed outside
 * the store. Decoder dispatch and the client facade are derived from this map.
 */
export interface CollaborationReadRpcContract {
  'junqi.collab.workflow.template.list': {
    params: { limit?: number };
    response: CollaborationWorkflowTemplateListResponse;
  };
  'junqi.collab.run.partial.preview': {
    params: { runId: string; workItemIds: string[] };
    response: CollaborationPartialPreview;
  };
  'junqi.collab.run.delete.preview': {
    params: { runId: string };
    response: CollaborationDeletePreview;
  };
  'junqi.collab.run.delete.get': {
    params: { jobId: string; expectedRunId: string };
    response: CollaborationDeletionJob;
  };
  'junqi.collab.export.get': {
    params: { jobId: string; expectedRunId: string };
    response: CollaborationExportJob;
  };
  'junqi.collab.export.download': {
    params: { jobId: string; expectedDigest: string };
    response: CollaborationExportArtifact;
  };
  'junqi.collab.session.mutationImpact': {
    params: {
      runtimeId: string;
      sessionKey: string;
      sessionId: string;
      action: CollaborationSessionMutationAction;
    };
    response: CollaborationSessionMutationImpactResponse;
  };
}

export type CollaborationReadMethod = keyof CollaborationReadRpcContract;
export type CollaborationReadParams<Method extends CollaborationReadMethod> =
  CollaborationReadRpcContract[Method]['params'];
export type CollaborationReadResponse<Method extends CollaborationReadMethod> =
  CollaborationReadRpcContract[Method]['response'];

export interface CollaborationChangedHint {
  collaborationInstanceId: string;
  runId: string;
  runRevision: number;
  lastSequence: number;
}

/**
 * Gateway events are an untrusted transport boundary. A changed hint may only
 * trigger authoritative RPC reads after every identity/watermark field passes
 * strict validation.
 */
export function parseCollaborationChangedHint(value: unknown): CollaborationChangedHint | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const collaborationInstanceId = record.collaborationInstanceId;
  const runId = record.runId;
  const runRevision = record.runRevision;
  const lastSequence = record.lastSequence;
  if (
    typeof collaborationInstanceId !== 'string'
    || !collaborationInstanceId.trim()
    || typeof runId !== 'string'
    || !runId.trim()
    || typeof runRevision !== 'number'
    || !Number.isSafeInteger(runRevision)
    || runRevision < 0
    || typeof lastSequence !== 'number'
    || !Number.isSafeInteger(lastSequence)
    || lastSequence < 0
  ) {
    return null;
  }
  return { collaborationInstanceId, runId, runRevision, lastSequence };
}

export interface CollaborationWriteEnvelope {
  commandId: string;
  payloadHash: string;
  expectedCollaborationInstanceId: string;
  expectedRunRevision?: number;
  currentPlanRevisionId?: string;
  expectedEntityRevision?: number;
}

export type CollaborationWriteRequest<T extends Record<string, unknown> = Record<string, unknown>> =
  T & CollaborationWriteEnvelope;

export interface CollaborationWriteResponse {
  accepted: boolean;
  replayed: boolean;
  commandId: string;
  collaborationInstanceId: string;
  runId?: string;
  newRunRevision?: number;
  newEntityRevision?: number;
  lastEventSequence?: number;
  [key: string]: unknown;
}

export type CollaborationWriteMethod =
  | 'junqi.collab.plan.create'
  | 'junqi.collab.plan.revise'
  | 'junqi.collab.plan.approve'
  | 'junqi.collab.run.dispatch.stop'
  | 'junqi.collab.run.dispatch.resume'
  | 'junqi.collab.run.partial.accept'
  | 'junqi.collab.run.cancel'
  | 'junqi.collab.run.reconcile'
  | 'junqi.collab.run.clone'
  | 'junqi.collab.workflow.template.createFromRun'
  | 'junqi.collab.workflow.template.instantiate'
  | 'junqi.collab.run.archive'
  | 'junqi.collab.run.unarchive'
  | 'junqi.collab.run.delete'
  | 'junqi.collab.run.delete.retry'
  | 'junqi.collab.workItem.input.append'
  | 'junqi.collab.workItem.reassign'
  | 'junqi.collab.workItem.retry'
  | 'junqi.collab.workItem.cancel'
  | 'junqi.collab.attempt.resolveUnknown'
  | 'junqi.collab.delivery.retry'
  | 'junqi.collab.delivery.retarget'
  | 'junqi.collab.delivery.abandon'
  | 'junqi.collab.session.mutation.prepare'
  | 'junqi.collab.session.mutation.complete'
  | 'junqi.collab.export.create'
  | 'junqi.collab.maintenance.enter'
  | 'junqi.collab.maintenance.exit';

export interface CollaborationSessionRef {
  sessionKey: string;
  sessionId: string;
}

export interface CollaborationEventCursor {
  afterSequence: number;
  snapshotRevision: number;
  complete: boolean;
  incompleteReason?: string;
  syncing: boolean;
  lastSyncedAt?: number;
  error?: string;
}

export function collaborationSessionIdentityKey(
  collaborationInstanceId: string,
  session: CollaborationSessionRef,
): string {
  return JSON.stringify([collaborationInstanceId, session.sessionKey, session.sessionId]);
}

export function isTerminalCollaborationRun(status: CollaborationRunStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'FAILED';
}

export function hasUnresolvedResidualExecutionRisk(
  run: Pick<CollaborationRunSnapshot, 'status' | 'interventions'>,
): boolean {
  return run.status === 'CANCELLED' && run.interventions.some((intervention) => (
    intervention.code === RESIDUAL_EXECUTION_RISK_INTERVENTION_CODE
    && intervention.resolvedAt == null
  ));
}
