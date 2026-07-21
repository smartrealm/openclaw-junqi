import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import {
  verifyManagedFlowProvisioning,
  type ManagedFlowProvisioningExpectation,
} from "./managed-flow-provisioning-specification.js";
import type { ManagedFlowObservation } from "./types.js";

const EXPECTATION: ManagedFlowProvisioningExpectation = {
  controllerId: "junqi-collab/run-1",
  runId: "run-1",
  domainRevision: 4,
};

const OBSERVATION: ManagedFlowObservation = {
  flowId: "flow-1",
  revision: 2,
  status: "running",
  controllerId: "junqi-collab/run-1",
  state: { runId: "run-1", domainRevision: 4, phase: "provisioning" },
  cancelRequestedAt: null,
};

function expectCollaborationError(
  operation: () => unknown,
  code: CollaborationError["code"],
): void {
  assert.throws(operation, (error: unknown) => (
    error instanceof CollaborationError && error.code === code
  ));
}

test("Managed Flow provisioning accepts and freezes one exact active observation", () => {
  const verified = verifyManagedFlowProvisioning(OBSERVATION, {
    ...EXPECTATION,
    flowId: "flow-1",
  });

  assert.deepEqual(verified, OBSERVATION);
  assert.equal(Object.isFrozen(verified), true);
  assert.equal(Object.isFrozen(verified.state), true);
  assert.notEqual(verified.state, OBSERVATION.state);
});

test("Managed Flow provisioning permits first observation without an expected Flow id", () => {
  assert.equal(
    verifyManagedFlowProvisioning(OBSERVATION, EXPECTATION).flowId,
    "flow-1",
  );
});

test("Managed Flow provisioning accepts the official initial revision zero", () => {
  const initial = verifyManagedFlowProvisioning({ ...OBSERVATION, revision: 0 }, EXPECTATION);
  assert.equal(initial.revision, 0);
});

const INVALID_RESPONSE_CASES: ReadonlyArray<{
  name: string;
  observation: ManagedFlowObservation | null;
}> = [
  { name: "a missing observation", observation: null },
  { name: "a blank Flow id", observation: { ...OBSERVATION, flowId: " " } },
  { name: "a negative Flow revision", observation: { ...OBSERVATION, revision: -1 } },
  { name: "a fractional Flow revision", observation: { ...OBSERVATION, revision: 1.5 } },
  { name: "an unsafe Flow revision", observation: { ...OBSERVATION, revision: Number.MAX_SAFE_INTEGER + 1 } },
  { name: "missing state", observation: { ...OBSERVATION, state: null } },
  {
    name: "a non-numeric domain revision",
    observation: { ...OBSERVATION, state: { runId: "run-1", domainRevision: "4" } },
  },
];

for (const entry of INVALID_RESPONSE_CASES) {
  test(`Managed Flow provisioning rejects ${entry.name}`, () => {
    expectCollaborationError(
      () => verifyManagedFlowProvisioning(entry.observation, EXPECTATION),
      "INVALID_RESPONSE",
    );
  });
}

for (const status of ["queued", "waiting", "blocked"] as const) {
  test(`Managed Flow provisioning rejects unsupported wire status ${status}`, () => {
    expectCollaborationError(
      () => verifyManagedFlowProvisioning({ ...OBSERVATION, status } as never, EXPECTATION),
      "INVALID_RESPONSE",
    );
  });
}

for (const status of ["succeeded", "failed", "cancelled", "lost"] as const) {
  test(`Managed Flow provisioning rejects ${status} status`, () => {
    expectCollaborationError(
      () => verifyManagedFlowProvisioning({ ...OBSERVATION, status }, EXPECTATION),
      "INVALID_TRANSITION",
    );
  });
}

test("Managed Flow provisioning rejects a cancel-requested Flow", () => {
  expectCollaborationError(
    () => verifyManagedFlowProvisioning({
      ...OBSERVATION,
      cancelRequestedAt: 1_784_253_600_000,
    }, EXPECTATION),
    "INVALID_TRANSITION",
  );
});

const OWNERSHIP_CONFLICT_CASES: ReadonlyArray<{
  name: string;
  observation: ManagedFlowObservation;
  expectation?: ManagedFlowProvisioningExpectation;
}> = [
  {
    name: "Flow id",
    observation: OBSERVATION,
    expectation: { ...EXPECTATION, flowId: "flow-other" },
  },
  {
    name: "controller identity",
    observation: { ...OBSERVATION, controllerId: "junqi-collab/run-other" },
  },
  {
    name: "state Run ownership",
    observation: { ...OBSERVATION, state: { runId: "run-other", domainRevision: 4 } },
  },
  {
    name: "state domain revision",
    observation: { ...OBSERVATION, state: { runId: "run-1", domainRevision: 3 } },
  },
];

for (const entry of OWNERSHIP_CONFLICT_CASES) {
  test(`Managed Flow provisioning rejects a mismatched ${entry.name}`, () => {
    expectCollaborationError(
      () => verifyManagedFlowProvisioning(
        entry.observation,
        entry.expectation ?? EXPECTATION,
      ),
      "REVISION_CONFLICT",
    );
  });
}

test("Managed Flow provisioning rejects invalid internal expectations", () => {
  const invalidExpectations: ManagedFlowProvisioningExpectation[] = [
    { ...EXPECTATION, controllerId: " " },
    { ...EXPECTATION, runId: " run-1" },
    { ...EXPECTATION, flowId: "" },
    { ...EXPECTATION, domainRevision: 0 },
  ];

  for (const expectation of invalidExpectations) {
    expectCollaborationError(
      () => verifyManagedFlowProvisioning(OBSERVATION, expectation),
      "INVALID_REQUEST",
    );
  }
});

test("Managed Flow provisioning rejects an unbounded Flow id before persistence", () => {
  expectCollaborationError(
    () => verifyManagedFlowProvisioning({
      ...OBSERVATION,
      flowId: "f".repeat(1_025),
    }, EXPECTATION),
    "CAPACITY_EXCEEDED",
  );
});
