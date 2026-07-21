import type {
  AgentTaskLookupResult,
  AgentTaskStatus,
  AttemptStatus,
} from "./types.js";

export interface ObservedAgentTask {
  status: AgentTaskStatus;
  terminalOutcome?: "succeeded" | "blocked";
  terminalSummary?: string;
  error?: string;
}

export type TaskRecoveryDecision =
  | { kind: "WAIT" }
  | { kind: "COMPLETE" }
  | { kind: "FAIL"; code: "AGENT_TASK_FAILED" | "AGENT_TASK_BLOCKED"; diagnostic: string }
  | { kind: "TIME_OUT"; diagnostic: string }
  | { kind: "UNEXPECTED_CANCEL" }
  | { kind: "UNKNOWN_LOST"; diagnostic: string }
  | {
      kind: "SETTLE_CANCELLATION";
      status: "succeeded" | "failed" | "timed_out" | "cancelled";
    }
  | { kind: "RETRY_CANCELLATION" };

export type TaskLookupObservation = AgentTaskLookupResult | {
  kind: "LOOKUP_FAILED";
  reason: string;
};

type SettlingTaskDecision = Exclude<
  TaskRecoveryDecision,
  { kind: "WAIT" | "RETRY_CANCELLATION" | "UNKNOWN_LOST" }
>;

export interface AttemptRecoveryContext {
  attemptStatus: AttemptStatus;
  expectedTaskId?: string;
  expectedRunId?: string;
  cancellationRequested: boolean;
  cancellationAttemptCount: number;
  maxCancellationAttempts: number;
  lookup: TaskLookupObservation;
}

export type AttemptRecoveryDecision =
  | { kind: "NOOP" }
  | {
      kind: "KEEP_UNKNOWN";
      code:
        | "TASK_LOOKUP_FAILED"
        | "TASK_NOT_OBSERVED"
        | "TASK_AMBIGUOUS"
        | "TASK_IDENTITY_MISMATCH"
        | "AGENT_TASK_LOST"
        | "CANCEL_RETRY_LIMIT_REACHED";
      diagnostic: string;
      details: Record<string, unknown>;
    }
  | {
      kind: "CAPTURE_AND_WATCH";
      task: Extract<AgentTaskLookupResult, { kind: "FOUND" }>;
    }
  | {
      kind: "REQUEST_CANCEL";
      task: Extract<AgentTaskLookupResult, { kind: "FOUND" }>;
    }
  | {
      kind: "SETTLE";
      task: Extract<AgentTaskLookupResult, { kind: "FOUND" }>;
      decision: SettlingTaskDecision;
    };

const RECOVERABLE_ATTEMPT_STATUSES = new Set<AttemptStatus>([
  "DISPATCHING",
  "RUNNING",
  "CANCELLING",
  "UNKNOWN",
]);

/**
 * Pure recovery reducer. Deliberately, no output variant can dispatch a new
 * Agent run: an uncertain external effect must converge through Task evidence
 * or explicit operator resolution.
 */
export function decideAttemptRecovery(context: AttemptRecoveryContext): AttemptRecoveryDecision {
  if (!RECOVERABLE_ATTEMPT_STATUSES.has(context.attemptStatus)) return { kind: "NOOP" };
  if (context.lookup.kind === "LOOKUP_FAILED") {
    return keepUnknown("TASK_LOOKUP_FAILED", context.lookup.reason);
  }
  if (context.lookup.kind === "ABSENT") {
    return keepUnknown(
      "TASK_NOT_OBSERVED",
      "The exact persistent OpenClaw Task is not observable; automatic redispatch is forbidden",
    );
  }
  if (context.lookup.kind === "AMBIGUOUS") {
    return keepUnknown("TASK_AMBIGUOUS", context.lookup.reason, {
      matchCount: context.lookup.matchCount,
    });
  }
  if (context.lookup.kind === "MISMATCH") {
    return keepUnknown("TASK_IDENTITY_MISMATCH", context.lookup.reason);
  }

  const task = context.lookup;
  if (
    (context.expectedTaskId !== undefined && task.taskId !== context.expectedTaskId)
    || (context.expectedRunId !== undefined && task.runId !== context.expectedRunId)
  ) {
    return keepUnknown(
      "TASK_IDENTITY_MISMATCH",
      "The observed OpenClaw Task does not match the Attempt's persisted identity",
      { observedTaskId: task.taskId, observedRunId: task.runId },
    );
  }
  const cancellationRequested = context.cancellationRequested || context.attemptStatus === "CANCELLING";
  const taskDecision = decideTaskRecovery(task, cancellationRequested);
  if (taskDecision.kind === "UNKNOWN_LOST") {
    return keepUnknown("AGENT_TASK_LOST", taskDecision.diagnostic);
  }
  if (taskDecision.kind === "RETRY_CANCELLATION") {
    if (context.cancellationAttemptCount >= context.maxCancellationAttempts) {
      return keepUnknown(
        "CANCEL_RETRY_LIMIT_REACHED",
        "The OpenClaw Task remains active after the bounded automatic cancellation attempts",
        { cancellationAttemptCount: context.cancellationAttemptCount },
      );
    }
    return { kind: "REQUEST_CANCEL", task };
  }
  if (taskDecision.kind === "WAIT") return { kind: "CAPTURE_AND_WATCH", task };
  return { kind: "SETTLE", task, decision: taskDecision };
}

function keepUnknown(
  code: Extract<AttemptRecoveryDecision, { kind: "KEEP_UNKNOWN" }>["code"],
  diagnostic: string,
  details: Record<string, unknown> = {},
): Extract<AttemptRecoveryDecision, { kind: "KEEP_UNKNOWN" }> {
  return { kind: "KEEP_UNKNOWN", code, diagnostic, details };
}

export function decideTaskRecovery(
  task: ObservedAgentTask,
  cancellationRequested: boolean,
): TaskRecoveryDecision {
  if (task.status === "lost") {
    return {
      kind: "UNKNOWN_LOST",
      diagnostic: task.terminalSummary
        ?? task.error
        ?? "The persistent OpenClaw Task is marked lost; automatic redispatch is forbidden",
    };
  }

  if (cancellationRequested) {
    if (task.status === "queued" || task.status === "running") {
      return { kind: "RETRY_CANCELLATION" };
    }
    return {
      kind: "SETTLE_CANCELLATION",
      status: task.status === "succeeded" && task.terminalOutcome === "blocked"
        ? "failed"
        : task.status,
    };
  }

  switch (task.status) {
    case "queued":
    case "running":
      return { kind: "WAIT" };
    case "succeeded":
      return task.terminalOutcome === "blocked"
        ? {
            kind: "FAIL",
            code: "AGENT_TASK_BLOCKED",
            diagnostic: task.terminalSummary
              ?? "The persistent OpenClaw Task completed without its required deliverable",
          }
        : { kind: "COMPLETE" };
    case "failed":
      return {
        kind: "FAIL",
        code: "AGENT_TASK_FAILED",
        diagnostic: task.error ?? task.terminalSummary ?? "The persistent OpenClaw Task reported failure",
      };
    case "timed_out":
      return {
        kind: "TIME_OUT",
        diagnostic: task.error ?? task.terminalSummary ?? "The persistent OpenClaw Task reported a timeout",
      };
    case "cancelled":
      return { kind: "UNEXPECTED_CANCEL" };
  }
}
