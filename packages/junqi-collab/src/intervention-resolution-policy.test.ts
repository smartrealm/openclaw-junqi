import assert from "node:assert/strict";
import test from "node:test";
import {
  decideRunCancellationInterventionResolution,
  decideWorkItemRetryInterventionResolution,
} from "./intervention-resolution-policy.js";

test("work-item retry resolves only its local recovery facts and terminal predecessors", () => {
  assert.equal(decideWorkItemRetryInterventionResolution({
    code: "WORK_ITEM_CANCEL_REQUESTED",
    entityType: "work_item",
    attemptStatus: null,
  }), "RESOLVE_AS_SUPERSEDED");
  assert.equal(decideWorkItemRetryInterventionResolution({
    code: "WORKER_REPORTED_FAILURE",
    entityType: "attempt",
    attemptStatus: "FAILED",
  }), "RESOLVE_AS_SUPERSEDED");
  for (const attemptStatus of ["RUNNING", "UNKNOWN", "ABANDONED"]) {
    assert.equal(decideWorkItemRetryInterventionResolution({
      code: "DISPATCH_OUTCOME_UNKNOWN",
      entityType: "attempt",
      attemptStatus,
    }), "PRESERVE_AS_BLOCKER");
  }
});

test("run cancellation preserves external and residual-risk recovery facts", () => {
  for (const facts of [
    { code: "ATTEMPT_ABANDONED_WITH_RESIDUAL_RISK", entityType: "attempt", attemptStatus: "ABANDONED" },
    { code: "FLOW_RECOVERY_CONFLICT", entityType: "command", attemptStatus: null },
    { code: "MAINTENANCE_LEASE_EXPIRED", entityType: "maintenance_lease", attemptStatus: null },
    { code: "SESSION_MUTATION_EXPIRED", entityType: "session_mutation", attemptStatus: null },
  ]) {
    assert.equal(
      decideRunCancellationInterventionResolution(facts),
      "PRESERVE_AS_BLOCKER",
    );
  }
});

test("run cancellation resolves local choices that cancellation supersedes", () => {
  for (const facts of [
    { code: "ATTEMPT_FAILED", entityType: "attempt", attemptStatus: "FAILED" },
    { code: "WORK_ITEM_CANCEL_REQUESTED", entityType: "work_item", attemptStatus: null },
    { code: "PARTIAL_DECISION_CORRUPT", entityType: "decision", attemptStatus: null },
    { code: "DISPATCH_STOPPED", entityType: null, attemptStatus: null },
  ]) {
    assert.equal(
      decideRunCancellationInterventionResolution(facts),
      "RESOLVE_AS_SUPERSEDED",
    );
  }
});
