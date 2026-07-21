import assert from "node:assert/strict";
import test from "node:test";
import {
  ResidualExecutionRiskSpecification,
  type ResidualExecutionRiskFacts,
} from "./residual-execution-risk-specification.js";

const specification = new ResidualExecutionRiskSpecification();

function facts(overrides: Partial<ResidualExecutionRiskFacts> = {}): ResidualExecutionRiskFacts {
  return {
    runStatus: "CANCELLING",
    attemptStatus: "UNKNOWN",
    acceptResidualRisk: true,
    actionableCancellationCommandId: null,
    cancellationEvidence: {
      commandId: "cancel-attempt-1",
      status: "SUCCEEDED",
      leaseGeneration: 1,
      effectStartedAt: 1_700_000_000_000,
    },
    lastReconciledAt: null,
    ...overrides,
  };
}

test("residual execution risk requires a cancelling Run and UNKNOWN Attempt", () => {
  assert.deepEqual(
    specification.assess(facts({ runStatus: "AWAITING_INTERVENTION" })),
    { kind: "DENIED", reason: "RUN_NOT_CANCELLING" },
  );
  assert.deepEqual(
    specification.assess(facts({ attemptStatus: "RUNNING" })),
    { kind: "DENIED", reason: "ATTEMPT_NOT_UNKNOWN" },
  );
});

test("residual execution risk requires explicit acceptance and no actionable cancellation", () => {
  assert.deepEqual(
    specification.assess(facts({ acceptResidualRisk: false })),
    { kind: "DENIED", reason: "RESIDUAL_RISK_NOT_ACCEPTED" },
  );
  assert.deepEqual(
    specification.assess(facts({ actionableCancellationCommandId: "cancel-pending" })),
    { kind: "DENIED", reason: "CANCELLATION_STILL_ACTIONABLE" },
  );
});

test("residual execution risk rejects fabricated or unexecuted cancellation evidence", () => {
  for (const cancellationEvidence of [
    null,
    { commandId: "", status: "SUCCEEDED" as const, leaseGeneration: 1, effectStartedAt: 1 },
    { commandId: "cancel-never-claimed", status: "CANCELLED" as const, leaseGeneration: 0, effectStartedAt: 1 },
    { commandId: "cancel-no-effect", status: "FAILED" as const, leaseGeneration: 2, effectStartedAt: null as never },
  ]) {
    assert.deepEqual(
      specification.assess(facts({ cancellationEvidence })),
      { kind: "DENIED", reason: "NO_DURABLE_CANCELLATION_OR_RECONCILIATION_EVIDENCE" },
    );
  }
});

test("residual execution risk accepts exact command or Attempt reconciliation evidence", () => {
  const commandDecision = specification.assess(facts());
  assert.equal(commandDecision.kind, "ALLOWED");
  if (commandDecision.kind === "ALLOWED") {
    assert.equal(commandDecision.cancellationEvidence?.commandId, "cancel-attempt-1");
    assert.equal(commandDecision.lastReconciledAt, null);
  }

  const reconciliationDecision = specification.assess(facts({
    cancellationEvidence: null,
    lastReconciledAt: 1_700_000_000_000,
  }));
  assert.equal(reconciliationDecision.kind, "ALLOWED");
  if (reconciliationDecision.kind === "ALLOWED") {
    assert.equal(reconciliationDecision.cancellationEvidence, null);
    assert.equal(reconciliationDecision.lastReconciledAt, 1_700_000_000_000);
  }
});
