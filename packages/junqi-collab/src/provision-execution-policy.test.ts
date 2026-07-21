import assert from "node:assert/strict";
import test from "node:test";
import { decideProvisionExecution } from "./provision-execution-policy.js";
import type { RunStatus } from "./types.js";

test("provision execution policy permits create-or-recover only while provisioning is unfenced", () => {
  assert.equal(decideProvisionExecution({
    runStatus: "PROVISIONING",
    infrastructureFenced: false,
  }).kind, "CREATE_OR_RECOVER");
  assert.equal(decideProvisionExecution({
    runStatus: "PROVISIONING",
    infrastructureFenced: true,
  }).kind, "DEFER");
});

test("closing runs stay observe-only across infrastructure fences to avoid shutdown deadlock", () => {
  for (const runStatus of ["CANCELLING", "COMPLETED", "CANCELLED", "FAILED"] as const) {
    assert.equal(decideProvisionExecution({
      runStatus,
      infrastructureFenced: false,
    }).kind, "OBSERVE_ONLY");
    assert.equal(decideProvisionExecution({
      runStatus,
      infrastructureFenced: true,
    }).kind, "OBSERVE_ONLY");
  }
});

test("provision execution policy rejects unrelated run states", () => {
  const invalidStates: RunStatus[] = [
    "PLANNING",
    "AWAITING_APPROVAL",
    "RUNNING",
    "AWAITING_INTERVENTION",
    "SYNTHESIZING",
    "PARTIAL_PENDING",
    "DELIVERY_PENDING",
  ];
  for (const runStatus of invalidStates) {
    assert.equal(decideProvisionExecution({
      runStatus,
      infrastructureFenced: false,
    }).kind, "INVALID_STATE");
  }
});
