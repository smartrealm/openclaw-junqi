import type { AttemptStatus, CommandStatus, RunStatus } from "./types.js";

export interface ResidualCancellationEvidence {
  readonly commandId: string;
  readonly status: Exclude<CommandStatus, "PENDING" | "LEASED">;
  /** Command lease fencing generation; not evidence that the effect ran. */
  readonly leaseGeneration: number;
  /** Durable effect-intent timestamp written immediately before cancelRun. */
  readonly effectStartedAt: number;
}

export interface ResidualExecutionRiskFacts {
  readonly runStatus: RunStatus;
  readonly attemptStatus: AttemptStatus;
  readonly acceptResidualRisk: boolean;
  readonly actionableCancellationCommandId: string | null;
  readonly cancellationEvidence: ResidualCancellationEvidence | null;
  readonly lastReconciledAt: number | null;
}

export type ResidualExecutionRiskDenialReason =
  | "RUN_NOT_CANCELLING"
  | "ATTEMPT_NOT_UNKNOWN"
  | "RESIDUAL_RISK_NOT_ACCEPTED"
  | "CANCELLATION_STILL_ACTIONABLE"
  | "NO_DURABLE_CANCELLATION_OR_RECONCILIATION_EVIDENCE";

export type ResidualExecutionRiskDecision =
  | Readonly<{
      kind: "ALLOWED";
      cancellationEvidence: ResidualCancellationEvidence | null;
      lastReconciledAt: number | null;
    }>
  | Readonly<{
      kind: "DENIED";
      reason: ResidualExecutionRiskDenialReason;
    }>;

/**
 * Fail-closed policy for the one destructive exception to UNKNOWN-attempt
 * reconciliation. It authorizes stopping local orchestration only; it never
 * asserts that the remote OpenClaw Task is terminal.
 */
export class ResidualExecutionRiskSpecification {
  assess(facts: ResidualExecutionRiskFacts): ResidualExecutionRiskDecision {
    if (facts.runStatus !== "CANCELLING") return denied("RUN_NOT_CANCELLING");
    if (facts.attemptStatus !== "UNKNOWN") return denied("ATTEMPT_NOT_UNKNOWN");
    if (!facts.acceptResidualRisk) return denied("RESIDUAL_RISK_NOT_ACCEPTED");
    if (facts.actionableCancellationCommandId !== null) {
      return denied("CANCELLATION_STILL_ACTIONABLE");
    }

    const cancellationEvidence = validCancellationEvidence(facts.cancellationEvidence)
      ? Object.freeze({ ...facts.cancellationEvidence })
      : null;
    const lastReconciledAt = validTimestamp(facts.lastReconciledAt)
      ? facts.lastReconciledAt
      : null;
    if (cancellationEvidence === null && lastReconciledAt === null) {
      return denied("NO_DURABLE_CANCELLATION_OR_RECONCILIATION_EVIDENCE");
    }
    return Object.freeze({ kind: "ALLOWED", cancellationEvidence, lastReconciledAt });
  }
}

function validCancellationEvidence(
  evidence: ResidualCancellationEvidence | null,
): evidence is ResidualCancellationEvidence {
  return evidence !== null
    && evidence.commandId.length > 0
    && ["SUCCEEDED", "FAILED", "UNKNOWN", "CANCELLED"].includes(evidence.status)
    && Number.isSafeInteger(evidence.leaseGeneration)
    && evidence.leaseGeneration > 0
    && validTimestamp(evidence.effectStartedAt);
}

function validTimestamp(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

function denied(reason: ResidualExecutionRiskDenialReason): ResidualExecutionRiskDecision {
  return Object.freeze({ kind: "DENIED", reason });
}
