import assert from "node:assert/strict";
import test from "node:test";
import { decidePartialApplication } from "./partial-application-policy.js";

test("partial application proceeds only when every external fence is clear", () => {
  assert.deepEqual(decidePartialApplication({
    maintenanceGateActive: false,
    hasUnresolvedInterventionOutsideClosure: false,
    hasActiveSessionMutation: false,
  }), { kind: "PROCEED" });
});

test("partial application reports every external fence deterministically", () => {
  assert.deepEqual(decidePartialApplication({
    maintenanceGateActive: true,
    hasUnresolvedInterventionOutsideClosure: true,
    hasActiveSessionMutation: true,
  }), {
    kind: "DEFER",
    fences: [
      "MAINTENANCE_GATE_ACTIVE",
      "OPEN_INTERVENTION_OUTSIDE_CLOSURE",
      "SESSION_MUTATION_ACTIVE",
    ],
  });
});
