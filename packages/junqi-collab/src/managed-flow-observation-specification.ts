import { assertCondition } from "./errors.js";
import {
  PERSISTENCE_LIMITS,
  assertPersistableText,
} from "./persistence-policy.js";
import type {
  ManagedFlowObservation,
  ManagedFlowStatus,
} from "./types.js";

export interface ManagedFlowIdentityExpectation {
  readonly flowId?: string;
  readonly controllerId: string;
  readonly runId: string;
  readonly domainRevision: number | Readonly<{ minimum: number; maximum: number }>;
}

export type VerifiedManagedFlowObservation = Readonly<{
  flowId: string;
  revision: number;
  status: ManagedFlowStatus;
  controllerId: string;
  state: Readonly<Record<string, unknown> & {
    runId: string;
    domainRevision: number;
  }>;
  cancelRequestedAt: number | null;
}>;

const MANAGED_FLOW_STATUSES = new Set<ManagedFlowStatus>([
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "lost",
]);

export function verifyManagedFlowIdentity(
  observation: ManagedFlowObservation | null | undefined,
  expectation: ManagedFlowIdentityExpectation,
): VerifiedManagedFlowObservation {
  assertExpectation(expectation);
  assertCondition(
    observation !== null && typeof observation === "object",
    "INVALID_RESPONSE",
    "OpenClaw did not return a Managed Flow observation",
  );
  assertCondition(
    isExactIdentifier(observation.flowId),
    "INVALID_RESPONSE",
    "Managed Flow observation returned an invalid Flow id",
  );
  assertPersistableText(
    observation.flowId,
    "OpenClaw managed flow id",
    PERSISTENCE_LIMITS.externalReferenceBytes,
  );
  assertCondition(
    Number.isSafeInteger(observation.revision) && observation.revision >= 0,
    "INVALID_RESPONSE",
    "Managed Flow observation returned an invalid revision",
  );
  assertCondition(
    MANAGED_FLOW_STATUSES.has(observation.status),
    "INVALID_RESPONSE",
    "Managed Flow observation returned an invalid status",
  );
  assertCondition(
    observation.cancelRequestedAt === null
      || (Number.isSafeInteger(observation.cancelRequestedAt) && observation.cancelRequestedAt >= 0),
    "INVALID_RESPONSE",
    "Managed Flow observation returned an invalid cancellation timestamp",
  );
  if (expectation.flowId !== undefined) {
    assertCondition(
      observation.flowId === expectation.flowId,
      "REVISION_CONFLICT",
      "Managed Flow observation returned a different Flow identity",
      { expectedFlowId: expectation.flowId, observedFlowId: observation.flowId },
    );
  }
  assertCondition(
    observation.controllerId === expectation.controllerId,
    "REVISION_CONFLICT",
    "Managed Flow observation returned a different controller identity",
    {
      expectedControllerId: expectation.controllerId,
      observedControllerId: observation.controllerId,
    },
  );
  assertCondition(
    isRecord(observation.state),
    "INVALID_RESPONSE",
    "Managed Flow observation returned no object state",
  );
  assertCondition(
    observation.state.runId === expectation.runId,
    "REVISION_CONFLICT",
    "Managed Flow state belongs to a different collaboration Run",
    { expectedRunId: expectation.runId, observedRunId: observation.state.runId },
  );
  assertCondition(
    Number.isSafeInteger(observation.state.domainRevision)
      && (observation.state.domainRevision as number) > 0,
    "INVALID_RESPONSE",
    "Managed Flow state contains an invalid domain revision",
  );
  const observedDomainRevision = observation.state.domainRevision as number;
  if (typeof expectation.domainRevision === "number") {
    assertCondition(
      observedDomainRevision === expectation.domainRevision,
      "REVISION_CONFLICT",
      "Managed Flow state belongs to a different collaboration revision",
      {
        expectedDomainRevision: expectation.domainRevision,
        observedDomainRevision,
      },
    );
  } else {
    assertCondition(
      observedDomainRevision >= expectation.domainRevision.minimum
        && observedDomainRevision <= expectation.domainRevision.maximum,
      "REVISION_CONFLICT",
      "Managed Flow state falls outside the collaboration revision fence",
      {
        minimumDomainRevision: expectation.domainRevision.minimum,
        maximumDomainRevision: expectation.domainRevision.maximum,
        observedDomainRevision,
      },
    );
  }

  return Object.freeze({
    flowId: observation.flowId,
    revision: observation.revision,
    status: observation.status,
    controllerId: expectation.controllerId,
    state: Object.freeze({
      ...observation.state,
      runId: expectation.runId,
      domainRevision: observedDomainRevision,
    }),
    cancelRequestedAt: observation.cancelRequestedAt,
  });
}

function assertExpectation(expectation: ManagedFlowIdentityExpectation): void {
  assertCondition(
    isExactIdentifier(expectation.controllerId),
    "INVALID_REQUEST",
    "Managed Flow observation requires an exact controller id",
  );
  assertCondition(
    isExactIdentifier(expectation.runId),
    "INVALID_REQUEST",
    "Managed Flow observation requires an exact Run id",
  );
  if (expectation.flowId !== undefined) {
    assertCondition(
      isExactIdentifier(expectation.flowId),
      "INVALID_REQUEST",
      "Managed Flow observation requires an exact expected Flow id",
    );
  }
  if (typeof expectation.domainRevision === "number") {
    assertCondition(
      Number.isSafeInteger(expectation.domainRevision) && expectation.domainRevision > 0,
      "INVALID_REQUEST",
      "Managed Flow observation requires a positive domain revision",
    );
  } else {
    assertCondition(
      Number.isSafeInteger(expectation.domainRevision.minimum)
        && expectation.domainRevision.minimum > 0
        && Number.isSafeInteger(expectation.domainRevision.maximum)
        && expectation.domainRevision.maximum >= expectation.domainRevision.minimum,
      "INVALID_REQUEST",
      "Managed Flow observation requires a valid domain revision range",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}
