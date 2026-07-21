import { assertCondition } from "./errors.js";
import {
  verifyManagedFlowIdentity,
  type ManagedFlowIdentityExpectation,
  type VerifiedManagedFlowObservation,
} from "./managed-flow-observation-specification.js";
import type { ManagedFlowObservation } from "./types.js";

export interface ManagedFlowProvisioningExpectation extends ManagedFlowIdentityExpectation {}

export type VerifiedManagedFlowProvisioning = VerifiedManagedFlowObservation & Readonly<{
  status: "running";
  cancelRequestedAt: null;
}>;

/** Pure acceptance specification for a create-or-observe provisioning result. */
export function verifyManagedFlowProvisioning(
  observation: ManagedFlowObservation | null | undefined,
  expectation: ManagedFlowProvisioningExpectation,
): VerifiedManagedFlowProvisioning {
  const verified = verifyManagedFlowIdentity(observation, expectation);
  assertCondition(
    verified.status === "running",
    "INVALID_TRANSITION",
    "Managed Flow provisioning requires an active running Flow",
    { observedStatus: verified.status },
  );
  assertCondition(
    verified.cancelRequestedAt === null,
    "INVALID_TRANSITION",
    "Managed Flow provisioning cannot reuse a Flow with cancellation requested",
  );
  return Object.freeze({
    ...verified,
    status: "running",
    cancelRequestedAt: null,
  });
}
