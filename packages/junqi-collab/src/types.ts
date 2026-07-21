export const RUN_STATUSES = [
  "DRAFT",
  "PLANNING",
  "AWAITING_APPROVAL",
  "PROVISIONING",
  "RUNNING",
  "AWAITING_INTERVENTION",
  "SYNTHESIZING",
  "FINALIZING",
  "DELIVERY_PENDING",
  "COMPLETED",
  "CANCELLING",
  "CANCELLED",
  "FAILED",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];
export type DispatchState = "OPEN" | "STOPPED" | "CLOSED";
export type ArchiveState = "ACTIVE" | "ARCHIVED";
export type ReconcileState = "IDLE" | "RUNNING" | "ATTENTION_REQUIRED";
export type CompletionOutcome = "FULL" | "PARTIAL" | null;

export type WorkItemStatus =
  | "PLANNED"
  | "BLOCKED"
  | "READY"
  | "DISPATCHING"
  | "RUNNING"
  | "SUCCEEDED"
  | "NEEDS_INTERVENTION"
  | "CANCELLING"
  | "CANCELLED"
  | "WAIVED";

export type AttemptKind = "PLANNER" | "WORKER" | "SYNTHESIZER";
export type AgentExecutionRuntime = "native" | "acp";
export type AgentTaskRuntime = "subagent" | "acp";
export type AttemptStatus =
  | "CREATED"
  | "DISPATCHING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMED_OUT"
  | "CANCELLING"
  | "CANCELLED"
  | "UNKNOWN"
  | "ABANDONED";

export type DeliveryStatus =
  | "PREPARED"
  | "SENDING"
  | "DELIVERED"
  | "RETRY_REQUIRED"
  | "UNKNOWN"
  | "ABANDONED";

export type TranscriptStatus =
  | "PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "UNKNOWN"
  | "SESSION_REBOUND";

export type SessionMutationAction = "reset" | "delete";
export type SessionMutationPolicy = "PROCEED" | "CANCEL_AND_WAIT" | "STOP_AND_RETARGET_LATER";
export type SessionMutationStatus = "PREPARED" | "EXPIRED" | "COMPLETED" | "FAILED";

export type CommandKind =
  | "PLAN"
  | "PROVISION"
  | "DISPATCH"
  | "SYNTHESIZE"
  | "DELIVER"
  | "CANCEL_ATTEMPT"
  | "FLOW_SYNC"
  | "EXPORT"
  | "DELETE";

export const COMMAND_KINDS = [
  "PLAN",
  "PROVISION",
  "DISPATCH",
  "SYNTHESIZE",
  "DELIVER",
  "CANCEL_ATTEMPT",
  "FLOW_SYNC",
  "EXPORT",
  "DELETE",
] as const satisfies readonly CommandKind[];

export type CommandStatus =
  | "PENDING"
  | "LEASED"
  | "SUCCEEDED"
  | "FAILED"
  | "UNKNOWN"
  | "CANCELLED";

export interface OriginRef {
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

export interface CapabilityAgent {
  id: string;
  name?: string;
  description?: string;
  model?: unknown;
  runtimeType: "native" | "acp";
  allowed: boolean;
  coordinator: boolean;
}

export interface CapabilitySnapshotInput {
  desktopObservedFacts?: Record<string, unknown>;
  capturedAt?: number;
  configHash?: string;
}

export interface PlanWorkItem {
  id: string;
  title: string;
  inputScope: string[];
  dependencies: string[];
  requiredCapabilities: string[];
  candidateAgentIds: string[];
  acceptanceCriteria: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  sideEffectClass: "READ_ONLY" | "LOCAL_WRITE" | "EXTERNAL_WRITE" | "DESTRUCTIVE";
}

export interface CollaborationPlan {
  goal: string;
  workItems: PlanWorkItem[];
  synthesis: {
    requiredEvidence: string[];
    finalAnswerContract: string;
  };
}

export interface WorkerResult {
  summary: string;
  outcome: "SUCCEEDED" | "FAILED";
  evidence: Array<{
    type: string;
    title: string;
    reference: string;
    verification: string;
    warning?: string;
  }>;
  createdArtifacts: string[];
  handoffNotes: string[];
}

export interface PluginConfig {
  coordinatorAgentId?: string;
  allowedAgentIds: string[];
  maxConcurrency: number;
  maxWorkItems: number;
  attemptTimeoutMs: number;
  retentionDays: number;
}

export interface WriteEnvelope {
  commandId: string;
  payloadHash: string;
  expectedCollaborationInstanceId: string;
  expectedRunRevision?: number;
  currentPlanRevisionId?: string;
  expectedEntityRevision?: number;
}

export interface EventRecord {
  sequence: number;
  runId: string;
  eventType: string;
  entityType?: string;
  entityId?: string;
  runRevision: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  dispatchState: DispatchState;
  archiveState: ArchiveState;
  reconcileState: ReconcileState;
  completionOutcome: CompletionOutcome;
  revision: number;
  goal: string;
  origin: OriginRef;
  currentPlanRevisionId: string | null;
  cancelRequestedAt: number | null;
  allowedActions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface CommandRecord {
  id: string;
  runId: string;
  kind: CommandKind;
  entityId: string | null;
  payload: Record<string, unknown>;
  effectKey: string;
  status: CommandStatus;
  attempts: number;
  failureCount: number;
  effectStartedAt: number | null;
  availableAt: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
}

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "lost";

export type AgentTaskLookupResult =
  | {
      kind: "FOUND";
      taskId: string;
      runId: string;
      status: AgentTaskStatus;
      childSessionKey?: string;
      terminalOutcome?: "succeeded" | "blocked";
      terminalSummary?: string;
      error?: string;
    }
  | { kind: "ABSENT" }
  | { kind: "MISMATCH"; reason: string }
  | { kind: "AMBIGUOUS"; matchCount: number; reason: string };

export type ManagedFlowStatus =
  | "queued"
  | "running"
  | "waiting"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "lost";

/**
 * Stable JunQi view of an OpenClaw Managed Flow record.
 *
 * Nullable ownership fields are intentional: callers must validate the exact
 * controller and state they own before accepting an observed Flow.
 */
export interface ManagedFlowObservation {
  flowId: string;
  revision: number;
  status: ManagedFlowStatus;
  controllerId: string | null;
  state: Record<string, unknown> | null;
  cancelRequestedAt: number | null;
}

export type ManagedFlowControllerLookup =
  | Readonly<{ kind: "FOUND"; flow: ManagedFlowObservation }>
  | Readonly<{ kind: "ABSENT" }>
  | Readonly<{ kind: "AMBIGUOUS"; matchCount: number }>;

export interface RuntimeAdapter {
  readonly runtimeVersion: string;
  readOrigin(origin: OriginRef): Promise<{ found: boolean; role?: string; text?: string }>;
  listConfiguredAgents(): CapabilityAgent[];
  createManagedFlow(params: {
    sessionKey: string;
    controllerId: string;
    goal: string;
    state: Record<string, unknown>;
  }): ManagedFlowObservation;
  findManagedFlowByController(params: {
    sessionKey: string;
    controllerId: string;
  }): ManagedFlowControllerLookup;
  updateManagedFlow(params: {
    sessionKey: string;
    flowId: string;
    expectedRevision: number;
    state: Record<string, unknown>;
    terminal?: "finished" | "failed" | "cancelled";
  }): Promise<{ revision: number } | null>;
  getManagedFlow(params: {
    sessionKey: string;
    flowId: string;
  }): ManagedFlowObservation | null;
  runAgent(params: {
    ownerAgentId: string;
    childSessionKey: string;
    message: string;
    idempotencyKey: string;
    executionRuntime?: AgentExecutionRuntime;
  }): Promise<{ runId: string; taskId?: string; childSessionKey?: string }>;
  findAgentTask(params: {
    ownerSessionKey: string;
    childSessionKey: string;
    expectedTaskId?: string;
    expectedRunId?: string;
    expectedIdempotencyKey?: string;
    taskRuntime?: AgentTaskRuntime;
  }): Promise<AgentTaskLookupResult>;
  waitForRun(runId: string, timeoutMs: number): Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
  getSessionMessages(sessionKey: string, limit: number): Promise<unknown[]>;
  cancelRun(params: {
    ownerSessionKey: string;
    childSessionKey: string;
    runId: string;
    taskId?: string;
    taskRuntime?: AgentTaskRuntime;
  }): Promise<{ found: boolean; cancelled: boolean; reason?: string }>;
  /**
   * Persistent create-or-get by idempotency key in the exact target transcript.
   * JunQi binds that key to an immutable target and artifact digest before calling this API.
   * A thrown error is an unknown outcome; callers must reconcile with the same tuple and key.
   */
  appendTranscript(params: {
    origin: OriginRef;
    text: string;
    idempotencyKey: string;
  }): Promise<{ ok: true; messageId: string } | { ok: false; code?: string; reason: string }>;
  emitChanged(event: { instanceId: string; runId: string; runRevision: number; lastSequence: number }): void;
}
