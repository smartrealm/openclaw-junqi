export type InterventionResolutionDecision =
  | "PRESERVE_AS_BLOCKER"
  | "RESOLVE_AS_SUPERSEDED";

export interface InterventionResolutionFacts {
  readonly code: string;
  readonly entityType: string | null;
  readonly attemptStatus: string | null;
}

const RETRY_SUPERSEDED_ATTEMPT_STATUSES = new Set([
  "SUCCEEDED",
  "FAILED",
  "TIMED_OUT",
  "CANCELLED",
]);

/**
 * A retry owns recovery only for its WorkItem and terminal predecessor
 * Attempts. UNKNOWN/active and explicitly abandoned Attempts remain blockers.
 */
export function decideWorkItemRetryInterventionResolution(
  facts: InterventionResolutionFacts,
): InterventionResolutionDecision {
  if (facts.entityType === "work_item") return "RESOLVE_AS_SUPERSEDED";
  if (
    facts.entityType === "attempt"
    && facts.attemptStatus != null
    && RETRY_SUPERSEDED_ATTEMPT_STATUSES.has(facts.attemptStatus)
  ) {
    return "RESOLVE_AS_SUPERSEDED";
  }
  return "PRESERVE_AS_BLOCKER";
}

/**
 * Run cancellation supersedes local execution choices, but not facts that
 * still require external reconciliation or acknowledge residual execution.
 */
export function decideRunCancellationInterventionResolution(
  facts: InterventionResolutionFacts,
): InterventionResolutionDecision {
  if (facts.code === "ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK") {
    return "PRESERVE_AS_BLOCKER";
  }
  if (facts.entityType === "work_item") return "RESOLVE_AS_SUPERSEDED";
  if (
    facts.entityType === "attempt"
    && facts.attemptStatus != null
    && RETRY_SUPERSEDED_ATTEMPT_STATUSES.has(facts.attemptStatus)
  ) {
    return "RESOLVE_AS_SUPERSEDED";
  }
  if (facts.entityType === "decision" && facts.code === "PARTIAL_DECISION_CORRUPT") {
    return "RESOLVE_AS_SUPERSEDED";
  }
  if (facts.entityType == null && facts.code === "DISPATCH_STOPPED") {
    return "RESOLVE_AS_SUPERSEDED";
  }
  return "PRESERVE_AS_BLOCKER";
}
