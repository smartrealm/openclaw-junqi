import assert from "node:assert/strict";
import test from "node:test";
import {
  assessExplicitRunDeletion,
  assessRetentionRunDeletion,
  assessRunDeletionPreview,
  recoverFlowReconciliationAbandonment,
  type FlowReconciliationAbandonment,
  type FlowReconciliationBlocker,
  type RunDeletionAssessment,
  type RunDeletionSnapshot,
} from "./run-deletion-policy.js";
import { RUN_STATUSES, type RunStatus } from "./types.js";

const CUTOFF = 10_000;

function blocker(overrides: Partial<FlowReconciliationBlocker> = {}): FlowReconciliationBlocker {
  return {
    commandId: "flow-sync-1",
    commandStatus: "FAILED",
    flowId: "flow-1",
    flowRevision: 7,
    diagnostic: "Flow state could not be confirmed",
    ...overrides,
  };
}

function abandonment(
  overrides: Partial<FlowReconciliationAbandonment> = {},
): FlowReconciliationAbandonment {
  return {
    ...blocker(),
    reason: "The external Flow was inspected separately.",
    ...overrides,
  };
}

function snapshot(overrides: Partial<RunDeletionSnapshot> = {}): RunDeletionSnapshot {
  return {
    runId: "run-1",
    status: "COMPLETED",
    reconcileState: "IDLE",
    endedAt: CUTOFF - 1,
    hasActiveAttempt: false,
    hasOtherActiveOrUncertainCommand: false,
    hasPendingExport: false,
    hasIncompleteDeletionJob: false,
    hasOpenResidualExecutionRisk: false,
    failedFlowReconciliations: [],
    ...overrides,
  };
}

function assertBlocked(
  assessment: RunDeletionAssessment,
  reason: Extract<RunDeletionAssessment, { kind: "BLOCKED" }>["reason"],
): asserts assessment is Extract<RunDeletionAssessment, { kind: "BLOCKED" }> {
  assert.equal(assessment.kind, "BLOCKED");
  if (assessment.kind === "BLOCKED") assert.equal(assessment.reason, reason);
}

test("run deletion preview accepts exactly terminal run statuses", () => {
  const terminal = new Set<RunStatus>(["COMPLETED", "CANCELLED", "FAILED"]);
  for (const status of RUN_STATUSES) {
    const assessment = assessRunDeletionPreview(snapshot({ status }));
    if (terminal.has(status)) {
      assert.equal(assessment.kind, "SATISFIED", status);
    } else {
      assertBlocked(assessment, "RUN_NOT_TERMINAL");
    }
  }
});

test("open residual execution risk blocks every deletion path with a stable reason", () => {
  const facts = snapshot({ hasOpenResidualExecutionRisk: true });
  for (const assessment of [
    assessRunDeletionPreview(facts),
    assessExplicitRunDeletion(facts, null),
    assessRetentionRunDeletion(facts, CUTOFF),
    recoverFlowReconciliationAbandonment(facts, null),
  ]) {
    assertBlocked(assessment, "OPEN_RESIDUAL_EXECUTION_RISK");
    assert.equal(assessment.errorCode, "INVALID_TRANSITION");
  }
});

test("run deletion preview exposes zero or one blocker and fails closed for many", () => {
  const noBlocker = assessRunDeletionPreview(snapshot());
  assert.equal(noBlocker.kind, "SATISFIED");
  if (noBlocker.kind === "SATISFIED") assert.equal(noBlocker.blocker, null);

  const current = blocker();
  const oneBlocker = assessRunDeletionPreview(snapshot({ failedFlowReconciliations: [current] }));
  assert.equal(oneBlocker.kind, "SATISFIED");
  if (oneBlocker.kind === "SATISFIED") assert.deepEqual(oneBlocker.blocker, current);

  const many = assessRunDeletionPreview(snapshot({
    failedFlowReconciliations: [current, blocker({ commandId: "provision-2" })],
  }));
  assertBlocked(many, "AMBIGUOUS_FLOW_RECONCILIATION");
  assert.equal(many.errorCode, "FLOW_RECONCILIATION_REQUIRED");
  assert.equal(many.blockers.length, 2);
});

test("explicit deletion binds abandonment to every blocker evidence field", () => {
  const current = blocker();
  const facts = snapshot({ failedFlowReconciliations: [current] });

  const missing = assessExplicitRunDeletion(facts, null);
  assertBlocked(missing, "FLOW_RECONCILIATION_REQUIRED");

  const exact = assessExplicitRunDeletion(facts, abandonment());
  assert.equal(exact.kind, "SATISFIED");
  if (exact.kind === "SATISFIED") assert.deepEqual(exact.abandonment, abandonment());

  const changes: Partial<FlowReconciliationAbandonment>[] = [
    { commandId: "flow-sync-other" },
    { flowId: "flow-other" },
    { flowRevision: 8 },
    { diagnostic: "A newer diagnostic" },
  ];
  for (const change of changes) {
    const stale = assessExplicitRunDeletion(facts, abandonment(change));
    assertBlocked(stale, "STALE_FLOW_RECONCILIATION");
    assert.equal(stale.errorCode, "REVISION_CONFLICT");
  }

  const fabricated = assessExplicitRunDeletion(snapshot(), abandonment());
  assertBlocked(fabricated, "STALE_FLOW_RECONCILIATION");
});

test("explicit deletion evaluates ambiguous Flow evidence before transient work", () => {
  const assessment = assessExplicitRunDeletion(
    snapshot({
      hasActiveAttempt: true,
      hasOtherActiveOrUncertainCommand: true,
      hasPendingExport: true,
      failedFlowReconciliations: [blocker(), blocker({ commandId: "provision-2" })],
    }),
    abandonment(),
  );
  assertBlocked(assessment, "AMBIGUOUS_FLOW_RECONCILIATION");
});

test("explicit deletion rejects each competing-work category independently", () => {
  const cases: Array<{
    label: string;
    facts: Partial<RunDeletionSnapshot>;
    reason: "ACTIVE_OR_UNCERTAIN_WORK" | "PENDING_EXPORT";
  }> = [
    { label: "active attempt", facts: { hasActiveAttempt: true }, reason: "ACTIVE_OR_UNCERTAIN_WORK" },
    {
      label: "other active command",
      facts: { hasOtherActiveOrUncertainCommand: true },
      reason: "ACTIVE_OR_UNCERTAIN_WORK",
    },
    { label: "pending export", facts: { hasPendingExport: true }, reason: "PENDING_EXPORT" },
  ];
  for (const entry of cases) {
    const assessment = assessExplicitRunDeletion(snapshot(entry.facts), null);
    assertBlocked(assessment, entry.reason);
  }
});

test("retention deletion uses a strict cutoff and independent eligibility facts", () => {
  const cutoffCases: Array<[number | null, boolean]> = [
    [null, false],
    [CUTOFF - 1, true],
    [CUTOFF, false],
    [CUTOFF + 1, false],
  ];
  for (const [endedAt, allowed] of cutoffCases) {
    const assessment = assessRetentionRunDeletion(snapshot({ endedAt }), CUTOFF);
    assert.equal(assessment.kind === "SATISFIED", allowed, `endedAt=${endedAt}`);
    if (!allowed) assertBlocked(assessment, "RETENTION_NOT_EXPIRED");
  }

  const cases: Array<{
    facts: Partial<RunDeletionSnapshot>;
    reason: Extract<RunDeletionAssessment, { kind: "BLOCKED" }>["reason"];
  }> = [
    { facts: { reconcileState: "RUNNING" }, reason: "RECONCILIATION_NOT_IDLE" },
    { facts: { reconcileState: "ATTENTION_REQUIRED" }, reason: "RECONCILIATION_NOT_IDLE" },
    { facts: { hasActiveAttempt: true }, reason: "ACTIVE_OR_UNCERTAIN_WORK" },
    { facts: { hasOtherActiveOrUncertainCommand: true }, reason: "ACTIVE_OR_UNCERTAIN_WORK" },
    { facts: { hasPendingExport: true }, reason: "PENDING_EXPORT" },
    { facts: { hasIncompleteDeletionJob: true }, reason: "INCOMPLETE_DELETION_JOB" },
    {
      facts: { failedFlowReconciliations: [blocker()] },
      reason: "FLOW_RECONCILIATION_REQUIRED",
    },
    {
      facts: { failedFlowReconciliations: [blocker(), blocker({ commandId: "provision-2" })] },
      reason: "AMBIGUOUS_FLOW_RECONCILIATION",
    },
  ];
  for (const entry of cases) {
    assertBlocked(assessRetentionRunDeletion(snapshot(entry.facts), CUTOFF), entry.reason);
  }
});

test("delete retry preserves abandonment only for the exact current blocker", () => {
  const current = blocker();
  const exact = recoverFlowReconciliationAbandonment(
    snapshot({ failedFlowReconciliations: [current] }),
    abandonment(),
  );
  assert.equal(exact.kind, "SATISFIED");
  if (exact.kind === "SATISFIED") assert.deepEqual(exact.abandonment, abandonment());

  const missing = recoverFlowReconciliationAbandonment(
    snapshot({ failedFlowReconciliations: [current] }),
    null,
  );
  assertBlocked(missing, "FLOW_RECONCILIATION_REQUIRED");

  const changed = recoverFlowReconciliationAbandonment(
    snapshot({ failedFlowReconciliations: [blocker({ diagnostic: "Changed" })] }),
    abandonment(),
  );
  assertBlocked(changed, "FLOW_RECONCILIATION_REQUIRED");

  const disappeared = recoverFlowReconciliationAbandonment(snapshot(), abandonment());
  assert.equal(disappeared.kind, "SATISFIED");
  if (disappeared.kind === "SATISFIED") assert.equal(disappeared.abandonment, null);

  const ambiguous = recoverFlowReconciliationAbandonment(
    snapshot({ failedFlowReconciliations: [current, blocker({ commandId: "provision-2" })] }),
    abandonment(),
  );
  assertBlocked(ambiguous, "AMBIGUOUS_FLOW_RECONCILIATION");
});

test("run deletion policy maps every blocker reason to its stable API error code", () => {
  const current = blocker();
  const cases: Array<{
    assessment: RunDeletionAssessment;
    reason: Extract<RunDeletionAssessment, { kind: "BLOCKED" }>["reason"];
    errorCode: Extract<RunDeletionAssessment, { kind: "BLOCKED" }>["errorCode"];
  }> = [
    {
      assessment: assessRunDeletionPreview(snapshot({ status: "RUNNING" })),
      reason: "RUN_NOT_TERMINAL",
      errorCode: "DELETE_REQUIRES_TERMINAL",
    },
    {
      assessment: assessRetentionRunDeletion(snapshot({ endedAt: CUTOFF }), CUTOFF),
      reason: "RETENTION_NOT_EXPIRED",
      errorCode: "INVALID_TRANSITION",
    },
    {
      assessment: assessRetentionRunDeletion(snapshot({ reconcileState: "RUNNING" }), CUTOFF),
      reason: "RECONCILIATION_NOT_IDLE",
      errorCode: "INVALID_TRANSITION",
    },
    {
      assessment: assessExplicitRunDeletion(snapshot({ hasActiveAttempt: true }), null),
      reason: "ACTIVE_OR_UNCERTAIN_WORK",
      errorCode: "INVALID_TRANSITION",
    },
    {
      assessment: assessExplicitRunDeletion(snapshot({ hasPendingExport: true }), null),
      reason: "PENDING_EXPORT",
      errorCode: "INVALID_TRANSITION",
    },
    {
      assessment: assessRetentionRunDeletion(snapshot({ hasIncompleteDeletionJob: true }), CUTOFF),
      reason: "INCOMPLETE_DELETION_JOB",
      errorCode: "INVALID_TRANSITION",
    },
    {
      assessment: assessExplicitRunDeletion(snapshot({ failedFlowReconciliations: [current] }), null),
      reason: "FLOW_RECONCILIATION_REQUIRED",
      errorCode: "FLOW_RECONCILIATION_REQUIRED",
    },
    {
      assessment: assessRunDeletionPreview(snapshot({
        failedFlowReconciliations: [current, blocker({ commandId: "provision-2" })],
      })),
      reason: "AMBIGUOUS_FLOW_RECONCILIATION",
      errorCode: "FLOW_RECONCILIATION_REQUIRED",
    },
    {
      assessment: assessExplicitRunDeletion(
        snapshot({ failedFlowReconciliations: [current] }),
        abandonment({ diagnostic: "Changed" }),
      ),
      reason: "STALE_FLOW_RECONCILIATION",
      errorCode: "REVISION_CONFLICT",
    },
  ];
  for (const entry of cases) {
    assertBlocked(entry.assessment, entry.reason);
    assert.equal(entry.assessment.errorCode, entry.errorCode, entry.reason);
  }
});
