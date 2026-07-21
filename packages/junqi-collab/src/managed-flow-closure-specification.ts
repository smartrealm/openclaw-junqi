import { assertCondition } from "./errors.js";
import {
  verifyManagedFlowIdentity,
  type ManagedFlowIdentityExpectation,
  type VerifiedManagedFlowObservation,
} from "./managed-flow-observation-specification.js";
import type { ManagedFlowObservation } from "./types.js";

export type ClosingRunStatus = "CANCELLING" | "COMPLETED" | "CANCELLED" | "FAILED";

export interface ManagedFlowClosureExpectation extends Omit<ManagedFlowIdentityExpectation, "domainRevision"> {
  readonly runStatus: ClosingRunStatus;
  readonly provisionRevision: number;
  readonly currentRunRevision: number;
}

export type VerifiedManagedFlowClosure = VerifiedManagedFlowObservation & Readonly<{
  targetStatus: "succeeded" | "failed" | "cancelled";
  syncRequired: boolean;
}>;

export type ManagedFlowClosureConflictReason =
  | "TERMINAL_STATUS_CONFLICT"
  | "CANCELLATION_CONFLICT"
  | "RUNNING_REVISION_CONFLICT"
  | "TERMINAL_DOMAIN_STATUS_CONFLICT";

export type ManagedFlowClosureAssessment =
  | Readonly<{ kind: "ACCEPTED"; flow: VerifiedManagedFlowClosure }>
  | Readonly<{
      kind: "CONFLICT";
      flow: VerifiedManagedFlowObservation;
      targetStatus: "succeeded" | "failed" | "cancelled";
      reason: ManagedFlowClosureConflictReason;
    }>;

export function verifyManagedFlowClosure(
  observation: ManagedFlowObservation | null | undefined,
  expectation: ManagedFlowClosureExpectation,
): VerifiedManagedFlowClosure {
  const assessment = assessManagedFlowClosure(observation, expectation);
  assertCondition(
    assessment.kind === "ACCEPTED",
    assessment.kind === "CONFLICT" && (
      assessment.reason === "RUNNING_REVISION_CONFLICT"
      || assessment.reason === "TERMINAL_DOMAIN_STATUS_CONFLICT"
    )
      ? "REVISION_CONFLICT"
      : "INVALID_TRANSITION",
    "Managed Flow state conflicts with the closing collaboration Run",
    assessment.kind === "CONFLICT"
      ? {
          reason: assessment.reason,
          runStatus: expectation.runStatus,
          expectedFlowStatus: assessment.targetStatus,
          observedFlowStatus: assessment.flow.status,
        }
      : undefined,
  );
  return assessment.flow;
}

export function assessManagedFlowClosure(
  observation: ManagedFlowObservation | null | undefined,
  expectation: ManagedFlowClosureExpectation,
): ManagedFlowClosureAssessment {
  const verified = verifyManagedFlowIdentity(observation, {
    ...expectation,
    domainRevision: {
      minimum: expectation.provisionRevision,
      maximum: expectation.currentRunRevision,
    },
  });
  const targetStatus = targetFlowStatus(expectation.runStatus);
  if (verified.status !== "running" && verified.status !== targetStatus) {
    return { kind: "CONFLICT", flow: verified, targetStatus, reason: "TERMINAL_STATUS_CONFLICT" };
  }
  if (verified.status === "running" && verified.cancelRequestedAt !== null) {
    if (targetStatus !== "cancelled") {
      return { kind: "CONFLICT", flow: verified, targetStatus, reason: "CANCELLATION_CONFLICT" };
    }
  }
  if (verified.status === "running") {
    if (verified.state.domainRevision !== expectation.provisionRevision) {
      return { kind: "CONFLICT", flow: verified, targetStatus, reason: "RUNNING_REVISION_CONFLICT" };
    }
  }
  if (
    verified.status === targetStatus
    && targetStatus !== "cancelled"
    && expectation.runStatus !== "CANCELLING"
  ) {
    if (verified.state.status !== expectation.runStatus) {
      return { kind: "CONFLICT", flow: verified, targetStatus, reason: "TERMINAL_DOMAIN_STATUS_CONFLICT" };
    }
  }
  const flow = Object.freeze({
    ...verified,
    targetStatus,
    syncRequired: verified.status !== targetStatus,
  });
  return Object.freeze({ kind: "ACCEPTED", flow });
}

function targetFlowStatus(runStatus: ClosingRunStatus): "succeeded" | "failed" | "cancelled" {
  if (runStatus === "COMPLETED") return "succeeded";
  if (runStatus === "FAILED") return "failed";
  return "cancelled";
}
