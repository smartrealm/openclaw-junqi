import assert from "node:assert/strict";
import test from "node:test";
import { decideWorkerPhaseRestoration } from "./worker-phase-restoration-policy.js";

const noFences = {
  hasPendingPartialDecision: false,
  maintenanceGateActive: false,
  hasUnresolvedIntervention: false,
  hasActiveSessionMutation: false,
} as const;

test("Worker phase restoration proceeds only when every suspension fence is clear", () => {
  assert.deepEqual(decideWorkerPhaseRestoration(noFences), { kind: "RESTORE" });

  assert.deepEqual(decideWorkerPhaseRestoration({
    ...noFences,
    hasUnresolvedIntervention: true,
  }), {
    kind: "DEFER",
    fences: ["OPEN_INTERVENTION"],
  });
});

test("Worker phase restoration reports all durable fences deterministically", () => {
  assert.deepEqual(decideWorkerPhaseRestoration({
    hasPendingPartialDecision: true,
    maintenanceGateActive: true,
    hasUnresolvedIntervention: true,
    hasActiveSessionMutation: true,
  }), {
    kind: "DEFER",
    fences: [
      "PARTIAL_DECISION_PENDING",
      "MAINTENANCE_GATE_ACTIVE",
      "OPEN_INTERVENTION",
      "SESSION_MUTATION_ACTIVE",
    ],
  });
});
