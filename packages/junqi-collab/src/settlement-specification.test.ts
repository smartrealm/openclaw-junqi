import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import { SettlementSpecification } from "./settlement-specification.js";
import type { RunStatus } from "./types.js";

const specification = new SettlementSpecification();

test("synthesis readiness requires every item settled after projected waivers and no active attempt", () => {
  const workItems = [
    { id: "work-a", logicalId: "a", status: "RUNNING" },
    { id: "work-b", logicalId: "b", status: "SUCCEEDED" },
  ];

  assert.deepEqual(specification.evaluateSynthesisReadiness({
    workItems,
    activeAttempts: [{ id: "attempt-a", status: "RUNNING" }],
    projectedWaiverLogicalIds: ["a"],
  }), {
    ready: false,
    unsettledWorkItemIds: [],
    activeAttemptIds: ["attempt-a"],
  });
  assert.deepEqual(specification.evaluateSynthesisReadiness({
    workItems,
    activeAttempts: [],
    projectedWaiverLogicalIds: ["a"],
  }), {
    ready: true,
    unsettledWorkItemIds: [],
    activeAttemptIds: [],
  });
  assert.deepEqual(specification.evaluateSynthesisReadiness({
    workItems: [{ id: "work-b", logicalId: "b", status: "NEEDS_INTERVENTION" }],
    activeAttempts: [],
    projectedWaiverLogicalIds: ["a"],
  }), {
    ready: false,
    unsettledWorkItemIds: ["work-b"],
    activeAttemptIds: [],
  });
});

test("every terminal Run status rejects every active or uncertain Attempt", () => {
  const terminalStatuses: RunStatus[] = ["COMPLETED", "CANCELLED", "FAILED"];
  for (const status of terminalStatuses) {
    assert.throws(
      () => specification.assertTerminalRunQuiescent(status, ["attempt-running", "attempt-unknown"]),
      (error: unknown) => (
        error instanceof CollaborationError
        && error.code === "ACTIVE_ATTEMPT_EXISTS"
        && error.details?.to === status
      ),
    );
  }
});

test("terminal quiescence permits nonterminal transitions and terminal Runs with no active Attempts", () => {
  assert.doesNotThrow(() => specification.assertTerminalRunQuiescent("FINALIZING", ["attempt-running"]));
  assert.doesNotThrow(() => specification.assertTerminalRunQuiescent("COMPLETED", []));
});
