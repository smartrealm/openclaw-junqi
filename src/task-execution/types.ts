export type TaskExecutionSource = 'chat' | 'quick_chat';

export type TaskRunStatus =
  | 'pending'
  | 'running'
  | 'cancel_requested'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'verification_required';

export type TaskNodeStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'cancel_requested'
  | 'cancelled'
  | 'rolled_back'
  | 'verification_required'
  | 'failed'
  | 'blocked';

export type TaskToolRecoveryMode = 'manual' | 'reconcile' | 'retry_with_same_effect_key';

export type TaskExecutionEdgeKind = 'observed_after' | 'supersedes';
export type TaskExecutionEdgeEvidence = 'junqi_intent' | 'openclaw_event';

export interface TaskExecutionRuntimeBinding {
  targetFingerprint: string;
  runtimeId: string | null;
  sessionKey: string;
  sessionId: string | null;
}

export interface TaskExecutionNode {
  id: string;
  kind: 'user_turn' | 'model_turn' | 'tool_invocation' | 'tool_reconciliation';
  status: TaskNodeStatus;
  runId: string;
  toolCallId?: string;
  toolName?: string;
  effectKey?: string;
  recoveryMode?: TaskToolRecoveryMode;
  sideEffect: 'unknown' | 'read_only' | 'idempotent' | 'verification_required';
  createdAt: number;
  updatedAt: number;
}

export interface TaskExecutionEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  kind: TaskExecutionEdgeKind;
  evidence: TaskExecutionEdgeEvidence;
  createdAt: number;
  updatedAt: number;
}

export interface TaskExecutionRun {
  runId: string;
  /** JunQi-local relationship for a native sessions.steer transition. */
  supersedesRunId?: string | null;
  source: TaskExecutionSource;
  status: TaskRunStatus;
  model: string | null;
  startedAt: number;
  updatedAt: number;
  stopRequestedAt: number | null;
  terminalReason: 'final' | 'aborted' | 'error' | null;
  historyVerifiedAt: number | null;
  historyActive: boolean | null;
}

export interface TaskExecutionCheckpoint {
  version: 1;
  taskId: string;
  binding: TaskExecutionRuntimeBinding;
  revision: number;
  updatedAt: number;
  lastHistoryVerifiedAt: number | null;
  lastHistorySessionId: string | null;
  runs: TaskExecutionRun[];
  nodes: TaskExecutionNode[];
  edges: TaskExecutionEdge[];
}

export interface TaskExecutionSnapshot {
  version: 1;
  tasks: TaskExecutionCheckpoint[];
}
