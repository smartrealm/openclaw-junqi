import type { AttemptKind, RunStatus } from "./types.js";

const ACTIVE_PHASE_BY_ATTEMPT_KIND = {
  PLANNER: "PLANNING",
  WORKER: "RUNNING",
  SYNTHESIZER: "SYNTHESIZING",
} as const satisfies Readonly<Record<AttemptKind, RunStatus>>;

export type TerminalAttemptCompletionDecision =
  | {
      kind: "ACCEPT";
      mode: "ACTIVE" | "SUSPENDED";
      expectedRunStatus: RunStatus;
    }
  | {
      kind: "REJECT";
      expectedRunStatus: RunStatus | null;
      reason: "UNSUPPORTED_ATTEMPT_KIND" | "RUN_PHASE_MISMATCH";
    };

/**
 * Authorizes local settlement of a terminal Agent result against the Run state
 * that launched it. A suspended Run is still eligible only when its durable
 * resume phase proves that the result belongs to the interrupted phase.
 */
export function decideTerminalAttemptCompletion(input: {
  attemptKind: unknown;
  runStatus: RunStatus;
  resumeStatus: unknown;
}): TerminalAttemptCompletionDecision {
  if (!isAttemptKind(input.attemptKind)) {
    return {
      kind: "REJECT",
      expectedRunStatus: null,
      reason: "UNSUPPORTED_ATTEMPT_KIND",
    };
  }

  const expectedRunStatus = ACTIVE_PHASE_BY_ATTEMPT_KIND[input.attemptKind];
  if (input.runStatus === expectedRunStatus) {
    return { kind: "ACCEPT", mode: "ACTIVE", expectedRunStatus };
  }
  if (input.runStatus === "AWAITING_INTERVENTION" && input.resumeStatus === expectedRunStatus) {
    return { kind: "ACCEPT", mode: "SUSPENDED", expectedRunStatus };
  }
  return {
    kind: "REJECT",
    expectedRunStatus,
    reason: "RUN_PHASE_MISMATCH",
  };
}

function isAttemptKind(value: unknown): value is AttemptKind {
  return value === "PLANNER" || value === "WORKER" || value === "SYNTHESIZER";
}
