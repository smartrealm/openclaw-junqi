import type { CollaborationErrorCode } from "./errors.js";
import type { ReconcileState, RunStatus } from "./types.js";

export interface FlowReconciliationBlocker {
  readonly commandId: string;
  readonly commandStatus: "FAILED";
  readonly flowId: string | null;
  readonly flowRevision: number | null;
  readonly diagnostic: string | null;
}

export interface FlowReconciliationAbandonment extends FlowReconciliationBlocker {
  readonly reason: string;
}

export interface RunDeletionSnapshot {
  readonly runId: string;
  readonly status: RunStatus;
  readonly reconcileState: ReconcileState;
  readonly endedAt: number | null;
  readonly hasActiveAttempt: boolean;
  readonly hasOtherActiveOrUncertainCommand: boolean;
  readonly hasPendingExport: boolean;
  readonly hasIncompleteDeletionJob: boolean;
  readonly hasOpenResidualExecutionRisk: boolean;
  /** At most two entries are required to distinguish zero, one, and many. */
  readonly failedFlowReconciliations: readonly FlowReconciliationBlocker[];
}

export type RunDeletionBlockerCode =
  | "RUN_NOT_TERMINAL"
  | "RETENTION_NOT_EXPIRED"
  | "RECONCILIATION_NOT_IDLE"
  | "ACTIVE_OR_UNCERTAIN_WORK"
  | "PENDING_EXPORT"
  | "INCOMPLETE_DELETION_JOB"
  | "OPEN_RESIDUAL_EXECUTION_RISK"
  | "FLOW_RECONCILIATION_REQUIRED"
  | "AMBIGUOUS_FLOW_RECONCILIATION"
  | "STALE_FLOW_RECONCILIATION";

export type RunDeletionAssessment =
  | Readonly<{
      kind: "SATISFIED";
      blocker: FlowReconciliationBlocker | null;
      abandonment: FlowReconciliationAbandonment | null;
    }>
  | Readonly<{
      kind: "BLOCKED";
      reason: RunDeletionBlockerCode;
      errorCode: CollaborationErrorCode;
      blockers: readonly FlowReconciliationBlocker[];
    }>;

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);

export function assessRunDeletionPreview(snapshot: RunDeletionSnapshot): RunDeletionAssessment {
  const terminal = terminalAssessment(snapshot);
  if (terminal) return terminal;
  const residualRisk = residualRiskAssessment(snapshot);
  if (residualRisk) return residualRisk;
  const flow = flowCardinalityAssessment(snapshot);
  if (flow) return flow;
  return satisfied(snapshot.failedFlowReconciliations[0] ?? null, null);
}

export function assessExplicitRunDeletion(
  snapshot: RunDeletionSnapshot,
  abandonment: FlowReconciliationAbandonment | null,
): RunDeletionAssessment {
  const terminal = terminalAssessment(snapshot);
  if (terminal) return terminal;
  const residualRisk = residualRiskAssessment(snapshot);
  if (residualRisk) return residualRisk;
  // A single tombstone can preserve one abandonment only. Detect cardinality
  // before other transient blockers so callers never mistake an ambiguous
  // reconciliation set for a retryable competing-work condition.
  const flow = flowCardinalityAssessment(snapshot);
  if (flow) return flow;
  if (snapshot.hasActiveAttempt || snapshot.hasOtherActiveOrUncertainCommand) {
    return blocked("ACTIVE_OR_UNCERTAIN_WORK", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  if (snapshot.hasPendingExport) {
    return blocked("PENDING_EXPORT", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  const blocker = snapshot.failedFlowReconciliations[0] ?? null;
  if (!blocker && abandonment) {
    return blocked("STALE_FLOW_RECONCILIATION", "REVISION_CONFLICT", []);
  }
  if (blocker && !abandonment) {
    return blocked("FLOW_RECONCILIATION_REQUIRED", "FLOW_RECONCILIATION_REQUIRED", [blocker]);
  }
  if (blocker && abandonment && !sameFlowReconciliationBlocker(blocker, abandonment)) {
    return blocked("STALE_FLOW_RECONCILIATION", "REVISION_CONFLICT", [blocker]);
  }
  return satisfied(blocker, abandonment);
}

export function assessRetentionRunDeletion(
  snapshot: RunDeletionSnapshot,
  cutoff: number,
): RunDeletionAssessment {
  const terminal = terminalAssessment(snapshot);
  if (terminal) return terminal;
  const residualRisk = residualRiskAssessment(snapshot);
  if (residualRisk) return residualRisk;
  if (snapshot.endedAt === null || snapshot.endedAt >= cutoff) {
    return blocked("RETENTION_NOT_EXPIRED", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  if (snapshot.reconcileState !== "IDLE") {
    return blocked("RECONCILIATION_NOT_IDLE", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  if (snapshot.hasActiveAttempt || snapshot.hasOtherActiveOrUncertainCommand) {
    return blocked("ACTIVE_OR_UNCERTAIN_WORK", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  if (snapshot.hasPendingExport) {
    return blocked("PENDING_EXPORT", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  if (snapshot.hasIncompleteDeletionJob) {
    return blocked("INCOMPLETE_DELETION_JOB", "INVALID_TRANSITION", snapshot.failedFlowReconciliations);
  }
  if (snapshot.failedFlowReconciliations.length > 0) {
    const reason = snapshot.failedFlowReconciliations.length > 1
      ? "AMBIGUOUS_FLOW_RECONCILIATION"
      : "FLOW_RECONCILIATION_REQUIRED";
    return blocked(reason, "FLOW_RECONCILIATION_REQUIRED", snapshot.failedFlowReconciliations);
  }
  return satisfied(null, null);
}

export function recoverFlowReconciliationAbandonment(
  snapshot: RunDeletionSnapshot,
  previous: FlowReconciliationAbandonment | null,
): RunDeletionAssessment {
  const terminal = terminalAssessment(snapshot);
  if (terminal) return terminal;
  const residualRisk = residualRiskAssessment(snapshot);
  if (residualRisk) return residualRisk;
  const flow = flowCardinalityAssessment(snapshot);
  if (flow) return flow;
  const blocker = snapshot.failedFlowReconciliations[0] ?? null;
  if (!blocker) return satisfied(null, null);
  if (!previous || !sameFlowReconciliationBlocker(blocker, previous)) {
    return blocked("FLOW_RECONCILIATION_REQUIRED", "FLOW_RECONCILIATION_REQUIRED", [blocker]);
  }
  return satisfied(blocker, previous);
}

export function sameFlowReconciliationBlocker(
  left: FlowReconciliationBlocker,
  right: FlowReconciliationBlocker,
): boolean {
  return left.commandId === right.commandId
    && left.commandStatus === right.commandStatus
    && left.flowId === right.flowId
    && left.flowRevision === right.flowRevision
    && left.diagnostic === right.diagnostic;
}

function terminalAssessment(snapshot: RunDeletionSnapshot): RunDeletionAssessment | null {
  return TERMINAL_RUN_STATUSES.has(snapshot.status)
    ? null
    : blocked("RUN_NOT_TERMINAL", "DELETE_REQUIRES_TERMINAL", snapshot.failedFlowReconciliations);
}

function residualRiskAssessment(snapshot: RunDeletionSnapshot): RunDeletionAssessment | null {
  return snapshot.hasOpenResidualExecutionRisk
    ? blocked("OPEN_RESIDUAL_EXECUTION_RISK", "INVALID_TRANSITION", snapshot.failedFlowReconciliations)
    : null;
}

function flowCardinalityAssessment(snapshot: RunDeletionSnapshot): RunDeletionAssessment | null {
  return snapshot.failedFlowReconciliations.length > 1
    ? blocked(
        "AMBIGUOUS_FLOW_RECONCILIATION",
        "FLOW_RECONCILIATION_REQUIRED",
        snapshot.failedFlowReconciliations,
      )
    : null;
}

function satisfied(
  blocker: FlowReconciliationBlocker | null,
  abandonment: FlowReconciliationAbandonment | null,
): RunDeletionAssessment {
  return Object.freeze({ kind: "SATISFIED", blocker, abandonment });
}

function blocked(
  reason: RunDeletionBlockerCode,
  errorCode: CollaborationErrorCode,
  blockers: readonly FlowReconciliationBlocker[],
): RunDeletionAssessment {
  return Object.freeze({
    kind: "BLOCKED",
    reason,
    errorCode,
    blockers: Object.freeze([...blockers]),
  });
}
