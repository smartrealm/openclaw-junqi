import { assertCondition } from "./errors.js";
import {
  PERSISTENCE_LIMITS,
  assertAttemptNumber,
  assertPersistableText,
} from "./persistence-policy.js";
import type { DeliveryStatus, OriginRef } from "./types.js";
import { sha256 } from "./util.js";

export const TRANSCRIPT_DELIVERY_REQUIREMENT = "TRANSCRIPT" as const;

const EFFECT_KEY_NAMESPACE = "collab:transcript-delivery:v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SPEC_FIELDS = new Set([
  "runId",
  "deliveryId",
  "targetRevision",
  "artifactId",
  "artifactDigest",
  "requirement",
  "target",
]);

type TranscriptTargetField = "runtimeId" | "agentId" | "sessionKey" | "sessionId";

/**
 * The OpenClaw transcript identity used for delivery ownership and retargeting.
 * Message and channel metadata are deliberately excluded: they do not identify
 * a different transcript.
 */
export type ExactTranscriptTarget = Readonly<Pick<OriginRef, TranscriptTargetField>>;

/** An immutable binding between one delivery revision and one final artifact. */
export interface TranscriptDeliverySpec {
  readonly runId: string;
  readonly deliveryId: string;
  readonly targetRevision: number;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly requirement: typeof TRANSCRIPT_DELIVERY_REQUIREMENT;
  readonly target: ExactTranscriptTarget;
}

export interface PriorTranscriptDeliveryAttempt {
  readonly attemptNo: number;
  readonly effectKey: string;
}

export type TranscriptDeliveryEffectTransition =
  | { readonly status: "PREPARED" }
  | {
      readonly status: Extract<DeliveryStatus, "UNKNOWN" | "RETRY_REQUIRED">;
      readonly priorAttempt: PriorTranscriptDeliveryAttempt;
    };

export type TranscriptDeliveryEffectDecision = Readonly<{
  attemptNo: number;
  effectKey: string;
  mode: "INITIAL" | "RECONCILE_SAME_EFFECT" | "NEW_ATTEMPT";
  reused: boolean;
}>;

export function normalizeExactTranscriptTarget(
  input: unknown,
  field = "target",
): ExactTranscriptTarget {
  const value = readRecord(input, field);
  return Object.freeze({
    runtimeId: readIdentifier(
      value.runtimeId,
      `${field}.runtimeId`,
      PERSISTENCE_LIMITS.originRuntimeIdBytes,
    ),
    agentId: readIdentifier(
      value.agentId,
      `${field}.agentId`,
      PERSISTENCE_LIMITS.originAgentIdBytes,
    ),
    sessionKey: readIdentifier(
      value.sessionKey,
      `${field}.sessionKey`,
      PERSISTENCE_LIMITS.originSessionKeyBytes,
    ),
    sessionId: readIdentifier(
      value.sessionId,
      `${field}.sessionId`,
      PERSISTENCE_LIMITS.originSessionIdBytes,
    ),
  });
}

export function normalizeTranscriptDeliverySpec(input: unknown): TranscriptDeliverySpec {
  const value = readRecord(input, "deliverySpec");
  rejectUnknownFields(value, SPEC_FIELDS, "deliverySpec");

  const requirement = readTrimmedString(value.requirement, "deliverySpec.requirement");
  assertCondition(
    requirement === TRANSCRIPT_DELIVERY_REQUIREMENT,
    "INVALID_REQUEST",
    "deliverySpec.requirement must be TRANSCRIPT",
  );

  const targetRevision = readPositiveSafeInteger(
    value.targetRevision,
    "deliverySpec.targetRevision",
  );
  const artifactDigest = readTrimmedString(
    value.artifactDigest,
    "deliverySpec.artifactDigest",
  ).toLowerCase();
  assertCondition(
    SHA256_PATTERN.test(artifactDigest),
    "INVALID_REQUEST",
    "deliverySpec.artifactDigest must be a SHA-256 digest",
  );

  return Object.freeze({
    runId: readIdentifier(
      value.runId,
      "deliverySpec.runId",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    ),
    deliveryId: readIdentifier(
      value.deliveryId,
      "deliverySpec.deliveryId",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    ),
    targetRevision,
    artifactId: readIdentifier(
      value.artifactId,
      "deliverySpec.artifactId",
      PERSISTENCE_LIMITS.externalReferenceBytes,
    ),
    artifactDigest,
    requirement: TRANSCRIPT_DELIVERY_REQUIREMENT,
    target: normalizeExactTranscriptTarget(value.target, "deliverySpec.target"),
  });
}

export function sameTranscriptTarget(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeExactTranscriptTarget(left, "leftTarget");
  const normalizedRight = normalizeExactTranscriptTarget(right, "rightTarget");
  return normalizedLeft.runtimeId === normalizedRight.runtimeId
    && normalizedLeft.agentId === normalizedRight.agentId
    && normalizedLeft.sessionKey === normalizedRight.sessionKey
    && normalizedLeft.sessionId === normalizedRight.sessionId;
}

/**
 * Derives a bounded key from the complete immutable binding. The digest keeps
 * identifiers out of the external key while still making every bound field,
 * including the exact transcript identity, collision-resistant.
 */
export function buildTranscriptDeliveryEffectKey(
  specInput: unknown,
  attemptNoInput: unknown,
): string {
  const spec = normalizeTranscriptDeliverySpec(specInput);
  const attemptNo = readAttemptNo(attemptNoInput, "attemptNo");
  const bindingDigest = sha256({
    version: 1,
    runId: spec.runId,
    deliveryId: spec.deliveryId,
    targetRevision: spec.targetRevision,
    artifactId: spec.artifactId,
    artifactDigest: spec.artifactDigest,
    requirement: spec.requirement,
    target: spec.target,
  });
  return `${EFFECT_KEY_NAMESPACE}:${bindingDigest}:attempt:${attemptNo}`;
}

/**
 * Chooses an idempotency effect for the current delivery state.
 *
 * UNKNOWN is reconciliation of an uncertain external outcome, so it must use
 * the exact original key. RETRY_REQUIRED is a known failed outcome, so it must
 * advance to a new attempt and key.
 */
export function decideTranscriptDeliveryEffect(
  specInput: unknown,
  transitionInput: unknown,
): TranscriptDeliveryEffectDecision {
  const spec = normalizeTranscriptDeliverySpec(specInput);
  const transition = normalizeEffectTransition(transitionInput);

  if (transition.status === "PREPARED") {
    const attemptNo = 1;
    return Object.freeze({
      attemptNo,
      effectKey: buildTranscriptDeliveryEffectKey(spec, attemptNo),
      mode: "INITIAL",
      reused: false,
    });
  }

  const expectedPriorKey = buildTranscriptDeliveryEffectKey(
    spec,
    transition.priorAttempt.attemptNo,
  );
  assertCondition(
    transition.priorAttempt.effectKey === expectedPriorKey,
    "IDEMPOTENCY_CONFLICT",
    "The prior delivery effect key does not belong to this transcript delivery specification",
    {
      deliveryId: spec.deliveryId,
      attemptNo: transition.priorAttempt.attemptNo,
    },
  );

  if (transition.status === "UNKNOWN") {
    return Object.freeze({
      attemptNo: transition.priorAttempt.attemptNo,
      effectKey: transition.priorAttempt.effectKey,
      mode: "RECONCILE_SAME_EFFECT",
      reused: true,
    });
  }

  const attemptNo = transition.priorAttempt.attemptNo + 1;
  readAttemptNo(attemptNo, "nextAttemptNo");
  return Object.freeze({
    attemptNo,
    effectKey: buildTranscriptDeliveryEffectKey(spec, attemptNo),
    mode: "NEW_ATTEMPT",
    reused: false,
  });
}

function normalizeEffectTransition(input: unknown): TranscriptDeliveryEffectTransition {
  const value = readRecord(input, "effectTransition");
  const status = readTrimmedString(value.status, "effectTransition.status");
  assertCondition(
    status === "PREPARED" || status === "UNKNOWN" || status === "RETRY_REQUIRED",
    "INVALID_TRANSITION",
    "Transcript delivery effects can only be selected from PREPARED, UNKNOWN, or RETRY_REQUIRED",
  );

  if (status === "PREPARED") {
    rejectUnknownFields(value, new Set(["status"]), "effectTransition");
    return Object.freeze({ status });
  }

  rejectUnknownFields(value, new Set(["status", "priorAttempt"]), "effectTransition");
  const priorAttemptValue = readRecord(value.priorAttempt, "effectTransition.priorAttempt");
  rejectUnknownFields(
    priorAttemptValue,
    new Set(["attemptNo", "effectKey"]),
    "effectTransition.priorAttempt",
  );
  const effectKey = readTrimmedString(
    priorAttemptValue.effectKey,
    "effectTransition.priorAttempt.effectKey",
  );
  assertCondition(
    effectKey === priorAttemptValue.effectKey,
    "INVALID_REQUEST",
    "effectTransition.priorAttempt.effectKey must not contain surrounding whitespace",
  );
  const priorAttempt = Object.freeze({
    attemptNo: readAttemptNo(
      priorAttemptValue.attemptNo,
      "effectTransition.priorAttempt.attemptNo",
    ),
    effectKey,
  });
  return Object.freeze({ status, priorAttempt });
}

function readRecord(input: unknown, field: string): Record<string, unknown> {
  assertCondition(
    input !== null && typeof input === "object" && !Array.isArray(input),
    "INVALID_REQUEST",
    `${field} must be an object`,
  );
  return input as Record<string, unknown>;
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  field: string,
): void {
  const unknownFields = Object.keys(value).filter((key) => !allowed.has(key));
  assertCondition(
    unknownFields.length === 0,
    "INVALID_REQUEST",
    `${field} contains unsupported fields`,
    { field, unknownFields },
  );
}

function readTrimmedString(input: unknown, field: string): string {
  assertCondition(
    typeof input === "string" && input.trim().length > 0,
    "INVALID_REQUEST",
    `${field} must be a non-empty string`,
  );
  return input.trim();
}

function readIdentifier(input: unknown, field: string, maxBytes: number): string {
  return assertPersistableText(readTrimmedString(input, field), field, maxBytes);
}

function readPositiveSafeInteger(input: unknown, field: string): number {
  assertCondition(
    typeof input === "number" && Number.isSafeInteger(input) && input >= 1,
    "INVALID_REQUEST",
    `${field} must be a positive safe integer`,
  );
  return input;
}

function readAttemptNo(input: unknown, field: string): number {
  const attemptNo = readPositiveSafeInteger(input, field);
  assertAttemptNumber(attemptNo, field);
  return attemptNo;
}
