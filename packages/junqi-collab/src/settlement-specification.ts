import { CollaborationError } from "./errors.js";
import type { RunStatus } from "./types.js";

const SETTLED_WORK_ITEM_STATUSES = new Set(["SUCCEEDED", "WAIVED"]);
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);

export interface SettlementWorkItemFact {
  readonly id: string;
  readonly logicalId: string;
  readonly status: string;
}

export interface SettlementAttemptFact {
  readonly id: string;
  readonly status: string;
}

export interface SynthesisReadiness {
  readonly ready: boolean;
  readonly unsettledWorkItemIds: readonly string[];
  readonly activeAttemptIds: readonly string[];
}

/**
 * Domain Specification for the two irreversible workflow boundaries:
 * entering synthesis and entering a terminal Run state.
 */
export class SettlementSpecification {
  evaluateSynthesisReadiness(params: {
    readonly workItems: readonly SettlementWorkItemFact[];
    readonly activeAttempts: readonly SettlementAttemptFact[];
    readonly projectedWaiverLogicalIds?: readonly string[];
  }): SynthesisReadiness {
    const projectedWaivers = new Set(params.projectedWaiverLogicalIds ?? []);
    const unsettledWorkItemIds = params.workItems
      .filter((item) => (
        !SETTLED_WORK_ITEM_STATUSES.has(item.status)
        && !projectedWaivers.has(item.logicalId)
      ))
      .map((item) => item.id)
      .sort();
    const activeAttemptIds = params.activeAttempts
      .map((attempt) => attempt.id)
      .sort();
    return {
      ready: unsettledWorkItemIds.length === 0 && activeAttemptIds.length === 0,
      unsettledWorkItemIds,
      activeAttemptIds,
    };
  }

  assertSynthesisReady(readiness: SynthesisReadiness): void {
    if (readiness.activeAttemptIds.length > 0) {
      throw new CollaborationError(
        "ACTIVE_ATTEMPT_EXISTS",
        "Current-plan Attempts must settle before synthesis can start",
        { activeAttemptIds: readiness.activeAttemptIds },
      );
    }
    if (readiness.unsettledWorkItemIds.length > 0) {
      throw new CollaborationError(
        "INVALID_TRANSITION",
        "Every required current-plan work item must be succeeded or waived before synthesis can start",
        { unsettledWorkItemIds: readiness.unsettledWorkItemIds },
      );
    }
  }

  assertTerminalRunQuiescent(to: RunStatus, activeAttemptIds: readonly string[]): void {
    if (!TERMINAL_RUN_STATUSES.has(to) || activeAttemptIds.length === 0) return;
    throw new CollaborationError(
      "ACTIVE_ATTEMPT_EXISTS",
      "A Run cannot enter a terminal state while an Attempt is active or uncertain",
      { to, activeAttemptIds: [...activeAttemptIds].sort() },
    );
  }
}
