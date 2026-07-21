import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import {
  assessManagedFlowClosure,
  verifyManagedFlowClosure,
} from "./managed-flow-closure-specification.js";
import type { ManagedFlowObservation } from "./types.js";

const base: ManagedFlowObservation = {
  flowId: "flow-1",
  revision: 2,
  status: "running",
  controllerId: "junqi-collab/run-1",
  state: { runId: "run-1", domainRevision: 3 },
  cancelRequestedAt: null,
};

const expectation = {
  flowId: "flow-1",
  controllerId: "junqi-collab/run-1",
  runId: "run-1",
  provisionRevision: 3,
  currentRunRevision: 8,
} as const;

test("closure specification accepts a running Flow that still requires terminal sync", () => {
  const verified = verifyManagedFlowClosure(base, { ...expectation, runStatus: "FAILED" });
  assert.equal(verified.targetStatus, "failed");
  assert.equal(verified.syncRequired, true);
});

test("closure specification accepts exact terminal Flow states including native cancellation state", () => {
  const failed = verifyManagedFlowClosure({
    ...base,
    status: "failed",
    state: { ...base.state, domainRevision: 8, status: "FAILED" },
  }, { ...expectation, runStatus: "FAILED" });
  assert.equal(failed.syncRequired, false);

  const cancelled = verifyManagedFlowClosure({
    ...base,
    status: "cancelled",
    cancelRequestedAt: 123,
  }, { ...expectation, runStatus: "CANCELLED" });
  assert.equal(cancelled.syncRequired, false);
});

test("closure specification rejects a conflicting terminal Flow and cancellation request", () => {
  for (const observation of [
    { ...base, status: "succeeded" as const, state: { ...base.state, status: "COMPLETED" } },
    { ...base, cancelRequestedAt: 123 },
  ]) {
    assert.throws(
      () => verifyManagedFlowClosure(observation, { ...expectation, runStatus: "FAILED" }),
      (error: unknown) => error instanceof CollaborationError && error.code === "INVALID_TRANSITION",
    );
  }
});

test("closure assessment preserves verified identity for an operator-visible lifecycle conflict", () => {
  const assessment = assessManagedFlowClosure({
    ...base,
    status: "succeeded",
    state: { ...base.state, domainRevision: 8, status: "COMPLETED" },
  }, { ...expectation, runStatus: "FAILED" });
  assert.equal(assessment.kind, "CONFLICT");
  if (assessment.kind !== "CONFLICT") return;
  assert.equal(assessment.flow.flowId, "flow-1");
  assert.equal(assessment.reason, "TERMINAL_STATUS_CONFLICT");
});
