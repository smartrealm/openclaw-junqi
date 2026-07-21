import assert from "node:assert/strict";
import test from "node:test";
import {
  decideAttemptRecovery,
  decideTaskRecovery,
  type AttemptRecoveryContext,
  type AttemptRecoveryDecision,
  type ObservedAgentTask,
  type TaskRecoveryDecision,
} from "./task-recovery-policy.js";

interface DecisionCase {
  name: string;
  task: ObservedAgentTask;
  cancellationRequested: boolean;
  expected: TaskRecoveryDecision;
}

const FOUND_RUNNING = {
  kind: "FOUND" as const,
  taskId: "task-1",
  runId: "run-1",
  status: "running" as const,
};

const RECOVERY_BASE: AttemptRecoveryContext = {
  attemptStatus: "UNKNOWN",
  expectedTaskId: "task-1",
  expectedRunId: "run-1",
  cancellationRequested: false,
  cancellationAttemptCount: 0,
  maxCancellationAttempts: 3,
  lookup: FOUND_RUNNING,
};

const ATTEMPT_CASES: Array<{
  name: string;
  input: AttemptRecoveryContext;
  expected: AttemptRecoveryDecision;
}> = [
  {
    name: "terminal Attempt is a no-op",
    input: { ...RECOVERY_BASE, attemptStatus: "SUCCEEDED" },
    expected: { kind: "NOOP" },
  },
  {
    name: "lookup failure remains unknown",
    input: { ...RECOVERY_BASE, lookup: { kind: "LOOKUP_FAILED", reason: "gateway unavailable" } },
    expected: {
      kind: "KEEP_UNKNOWN",
      code: "TASK_LOOKUP_FAILED",
      diagnostic: "gateway unavailable",
      details: {},
    },
  },
  {
    name: "absent Task forbids redispatch",
    input: { ...RECOVERY_BASE, lookup: { kind: "ABSENT" } },
    expected: {
      kind: "KEEP_UNKNOWN",
      code: "TASK_NOT_OBSERVED",
      diagnostic: "The exact persistent OpenClaw Task is not observable; automatic redispatch is forbidden",
      details: {},
    },
  },
  {
    name: "ambiguous Task remains unknown with evidence",
    input: {
      ...RECOVERY_BASE,
      lookup: { kind: "AMBIGUOUS", matchCount: 2, reason: "duplicate child Task" },
    },
    expected: {
      kind: "KEEP_UNKNOWN",
      code: "TASK_AMBIGUOUS",
      diagnostic: "duplicate child Task",
      details: { matchCount: 2 },
    },
  },
  {
    name: "running Task is captured and watched",
    input: RECOVERY_BASE,
    expected: { kind: "CAPTURE_AND_WATCH", task: FOUND_RUNNING },
  },
  {
    name: "persisted identity mismatch remains unknown",
    input: { ...RECOVERY_BASE, expectedRunId: "another-run" },
    expected: {
      kind: "KEEP_UNKNOWN",
      code: "TASK_IDENTITY_MISMATCH",
      diagnostic: "The observed OpenClaw Task does not match the Attempt's persisted identity",
      details: { observedTaskId: "task-1", observedRunId: "run-1" },
    },
  },
  {
    name: "sticky cancellation requests cancellation",
    input: { ...RECOVERY_BASE, cancellationRequested: true },
    expected: { kind: "REQUEST_CANCEL", task: FOUND_RUNNING },
  },
  {
    name: "bounded cancellation remains unknown after retry limit",
    input: {
      ...RECOVERY_BASE,
      attemptStatus: "CANCELLING",
      cancellationAttemptCount: 3,
    },
    expected: {
      kind: "KEEP_UNKNOWN",
      code: "CANCEL_RETRY_LIMIT_REACHED",
      diagnostic: "The OpenClaw Task remains active after the bounded automatic cancellation attempts",
      details: { cancellationAttemptCount: 3 },
    },
  },
  {
    name: "terminal Task produces an explicit settle decision",
    input: { ...RECOVERY_BASE, lookup: { ...FOUND_RUNNING, status: "succeeded" } },
    expected: {
      kind: "SETTLE",
      task: { ...FOUND_RUNNING, status: "succeeded" },
      decision: { kind: "COMPLETE" },
    },
  },
  {
    name: "lost Task can never be redispatched",
    input: {
      ...RECOVERY_BASE,
      lookup: { ...FOUND_RUNNING, status: "lost", terminalSummary: "task lease expired" },
    },
    expected: {
      kind: "KEEP_UNKNOWN",
      code: "AGENT_TASK_LOST",
      diagnostic: "task lease expired",
      details: {},
    },
  },
];

for (const entry of ATTEMPT_CASES) {
  test(`attempt recovery reducer: ${entry.name}`, () => {
    assert.deepEqual(decideAttemptRecovery(entry.input), entry.expected);
  });
}

const CASES: readonly DecisionCase[] = [
  {
    name: "queued task waits",
    task: { status: "queued" },
    cancellationRequested: false,
    expected: { kind: "WAIT" },
  },
  {
    name: "running task waits",
    task: { status: "running" },
    cancellationRequested: false,
    expected: { kind: "WAIT" },
  },
  {
    name: "successful task completes",
    task: { status: "succeeded" },
    cancellationRequested: false,
    expected: { kind: "COMPLETE" },
  },
  {
    name: "blocked success fails with its terminal summary",
    task: { status: "succeeded", terminalOutcome: "blocked", terminalSummary: "approval required" },
    cancellationRequested: false,
    expected: { kind: "FAIL", code: "AGENT_TASK_BLOCKED", diagnostic: "approval required" },
  },
  {
    name: "failed task preserves the runtime error",
    task: { status: "failed", error: "provider failed" },
    cancellationRequested: false,
    expected: { kind: "FAIL", code: "AGENT_TASK_FAILED", diagnostic: "provider failed" },
  },
  {
    name: "timed-out task preserves the terminal summary",
    task: { status: "timed_out", terminalSummary: "runtime deadline" },
    cancellationRequested: false,
    expected: { kind: "TIME_OUT", diagnostic: "runtime deadline" },
  },
  {
    name: "unexpected cancellation is surfaced",
    task: { status: "cancelled" },
    cancellationRequested: false,
    expected: { kind: "UNEXPECTED_CANCEL" },
  },
  {
    name: "lost task remains unknown",
    task: { status: "lost", error: "task record lost" },
    cancellationRequested: false,
    expected: { kind: "UNKNOWN_LOST", diagnostic: "task record lost" },
  },
  {
    name: "queued task retries requested cancellation",
    task: { status: "queued" },
    cancellationRequested: true,
    expected: { kind: "RETRY_CANCELLATION" },
  },
  {
    name: "running task retries requested cancellation",
    task: { status: "running" },
    cancellationRequested: true,
    expected: { kind: "RETRY_CANCELLATION" },
  },
  {
    name: "successful task settles an active cancellation",
    task: { status: "succeeded" },
    cancellationRequested: true,
    expected: { kind: "SETTLE_CANCELLATION", status: "succeeded" },
  },
  {
    name: "blocked success settles an active cancellation as failed",
    task: { status: "succeeded", terminalOutcome: "blocked" },
    cancellationRequested: true,
    expected: { kind: "SETTLE_CANCELLATION", status: "failed" },
  },
  {
    name: "failed task settles an active cancellation",
    task: { status: "failed" },
    cancellationRequested: true,
    expected: { kind: "SETTLE_CANCELLATION", status: "failed" },
  },
  {
    name: "timed-out task settles an active cancellation",
    task: { status: "timed_out" },
    cancellationRequested: true,
    expected: { kind: "SETTLE_CANCELLATION", status: "timed_out" },
  },
  {
    name: "cancelled task settles an active cancellation",
    task: { status: "cancelled" },
    cancellationRequested: true,
    expected: { kind: "SETTLE_CANCELLATION", status: "cancelled" },
  },
  {
    name: "lost task remains unknown during cancellation",
    task: { status: "lost", terminalSummary: "durable task missing" },
    cancellationRequested: true,
    expected: { kind: "UNKNOWN_LOST", diagnostic: "durable task missing" },
  },
];

for (const entry of CASES) {
  test(`task recovery policy: ${entry.name}`, () => {
    assert.deepEqual(
      decideTaskRecovery(entry.task, entry.cancellationRequested),
      entry.expected,
    );
  });
}
