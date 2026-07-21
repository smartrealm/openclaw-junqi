import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import {
  buildTranscriptDeliveryEffectKey,
  decideTranscriptDeliveryEffect,
  normalizeExactTranscriptTarget,
  normalizeTranscriptDeliverySpec,
  sameTranscriptTarget,
  type TranscriptDeliverySpec,
} from "./delivery-specification.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function validTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runtimeId: "openclaw",
    agentId: "coordinator",
    sessionKey: "agent:coordinator:main",
    sessionId: "session-1",
    nativeMessageId: "message-1",
    ...overrides,
  };
}

function validSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    runId: "run-1",
    deliveryId: "delivery-1",
    targetRevision: 1,
    artifactId: "artifact-1",
    artifactDigest: DIGEST_A,
    requirement: "TRANSCRIPT",
    target: validTarget(),
    ...overrides,
  };
}

function expectCollaborationError(
  operation: () => unknown,
  code: CollaborationError["code"],
): void {
  assert.throws(operation, (error: unknown) => (
    error instanceof CollaborationError && error.code === code
  ));
}

test("exact transcript target normalizes the four-field OpenClaw identity", () => {
  const target = normalizeExactTranscriptTarget(validTarget({
    runtimeId: "  openclaw  ",
    nativeMessageId: "message-metadata-is-not-identity",
    channel: "webchat",
  }));

  assert.deepEqual(target, {
    runtimeId: "openclaw",
    agentId: "coordinator",
    sessionKey: "agent:coordinator:main",
    sessionId: "session-1",
  });
  assert.equal(Object.isFrozen(target), true);
});

const INVALID_TARGET_CASES: ReadonlyArray<{
  name: string;
  target: unknown;
  code: CollaborationError["code"];
}> = [
  { name: "null", target: null, code: "INVALID_REQUEST" },
  { name: "array", target: [], code: "INVALID_REQUEST" },
  {
    name: "missing runtime",
    target: validTarget({ runtimeId: undefined }),
    code: "INVALID_REQUEST",
  },
  {
    name: "blank agent",
    target: validTarget({ agentId: "  " }),
    code: "INVALID_REQUEST",
  },
  {
    name: "oversized session key",
    target: validTarget({ sessionKey: "s".repeat(2_049) }),
    code: "CAPACITY_EXCEEDED",
  },
];

for (const entry of INVALID_TARGET_CASES) {
  test(`exact transcript target rejects ${entry.name}`, () => {
    expectCollaborationError(
      () => normalizeExactTranscriptTarget(entry.target),
      entry.code,
    );
  });
}

test("transcript delivery spec canonicalizes identifiers and SHA-256 digest", () => {
  const spec = normalizeTranscriptDeliverySpec(validSpec({
    runId: " run-1 ",
    deliveryId: " delivery-1 ",
    artifactId: " artifact-1 ",
    artifactDigest: DIGEST_A.toUpperCase(),
  }));

  assert.equal(spec.runId, "run-1");
  assert.equal(spec.deliveryId, "delivery-1");
  assert.equal(spec.artifactId, "artifact-1");
  assert.equal(spec.artifactDigest, DIGEST_A);
  assert.equal(spec.requirement, "TRANSCRIPT");
  assert.equal(Object.isFrozen(spec), true);
  assert.equal(Object.isFrozen(spec.target), true);
});

const INVALID_SPEC_CASES: ReadonlyArray<{
  name: string;
  spec: unknown;
  code: CollaborationError["code"];
}> = [
  {
    name: "a channel requirement",
    spec: validSpec({ requirement: "CHANNEL" }),
    code: "INVALID_REQUEST",
  },
  {
    name: "a zero target revision",
    spec: validSpec({ targetRevision: 0 }),
    code: "INVALID_REQUEST",
  },
  {
    name: "a fractional target revision",
    spec: validSpec({ targetRevision: 1.5 }),
    code: "INVALID_REQUEST",
  },
  {
    name: "an invalid artifact digest",
    spec: validSpec({ artifactDigest: "not-a-digest" }),
    code: "INVALID_REQUEST",
  },
  {
    name: "an unsupported field",
    spec: validSpec({ channelStrategy: "broadcast" }),
    code: "INVALID_REQUEST",
  },
];

for (const entry of INVALID_SPEC_CASES) {
  test(`transcript delivery spec rejects ${entry.name}`, () => {
    expectCollaborationError(
      () => normalizeTranscriptDeliverySpec(entry.spec),
      entry.code,
    );
  });
}

const SAME_TARGET_CASES: ReadonlyArray<{
  name: string;
  right: Record<string, unknown>;
  expected: boolean;
}> = [
  {
    name: "the same four-field identity",
    right: validTarget({
      nativeMessageId: "another-message",
      channel: "another-channel",
      threadId: "another-thread",
    }),
    expected: true,
  },
  {
    name: "a different runtime",
    right: validTarget({ runtimeId: "another-runtime" }),
    expected: false,
  },
  {
    name: "a different agent",
    right: validTarget({ agentId: "another-agent" }),
    expected: false,
  },
  {
    name: "a different session key",
    right: validTarget({ sessionKey: "agent:coordinator:other" }),
    expected: false,
  },
  {
    name: "a different session id",
    right: validTarget({ sessionId: "session-2" }),
    expected: false,
  },
];

for (const entry of SAME_TARGET_CASES) {
  test(`same transcript target identifies ${entry.name}`, () => {
    assert.equal(sameTranscriptTarget(validTarget(), entry.right), entry.expected);
  });
}

test("effect keys are deterministic and bind every immutable delivery field", () => {
  const baseSpec = normalizeTranscriptDeliverySpec(validSpec());
  const baseKey = buildTranscriptDeliveryEffectKey(baseSpec, 1);
  assert.equal(buildTranscriptDeliveryEffectKey(validSpec(), 1), baseKey);
  assert.match(baseKey, /^collab:transcript-delivery:v1:[a-f0-9]{64}:attempt:1$/);

  const variants: ReadonlyArray<{ name: string; spec: Record<string, unknown> }> = [
    { name: "runId", spec: validSpec({ runId: "run-2" }) },
    { name: "deliveryId", spec: validSpec({ deliveryId: "delivery-2" }) },
    { name: "targetRevision", spec: validSpec({ targetRevision: 2 }) },
    { name: "artifactId", spec: validSpec({ artifactId: "artifact-2" }) },
    { name: "artifactDigest", spec: validSpec({ artifactDigest: DIGEST_B }) },
    {
      name: "exact target",
      spec: validSpec({ target: validTarget({ sessionId: "session-2" }) }),
    },
  ];

  for (const variant of variants) {
    assert.notEqual(
      buildTranscriptDeliveryEffectKey(variant.spec, 1),
      baseKey,
      `${variant.name} must be bound into the key`,
    );
  }
});

test("PREPARED creates the first transcript delivery effect", () => {
  const decision = decideTranscriptDeliveryEffect(validSpec(), { status: "PREPARED" });
  assert.deepEqual(decision, {
    attemptNo: 1,
    effectKey: buildTranscriptDeliveryEffectKey(validSpec(), 1),
    mode: "INITIAL",
    reused: false,
  });
  assert.equal(Object.isFrozen(decision), true);
});

const EFFECT_TRANSITION_CASES: ReadonlyArray<{
  name: string;
  status: "UNKNOWN" | "RETRY_REQUIRED";
  expectedAttemptNo: number;
  expectedMode: "RECONCILE_SAME_EFFECT" | "NEW_ATTEMPT";
  expectedReused: boolean;
}> = [
  {
    name: "UNKNOWN reuses the original effect",
    status: "UNKNOWN",
    expectedAttemptNo: 1,
    expectedMode: "RECONCILE_SAME_EFFECT",
    expectedReused: true,
  },
  {
    name: "RETRY_REQUIRED advances to a new effect",
    status: "RETRY_REQUIRED",
    expectedAttemptNo: 2,
    expectedMode: "NEW_ATTEMPT",
    expectedReused: false,
  },
];

for (const entry of EFFECT_TRANSITION_CASES) {
  test(`transcript delivery effect strategy: ${entry.name}`, () => {
    const priorEffectKey = buildTranscriptDeliveryEffectKey(validSpec(), 1);
    const decision = decideTranscriptDeliveryEffect(validSpec(), {
      status: entry.status,
      priorAttempt: { attemptNo: 1, effectKey: priorEffectKey },
    });

    assert.equal(decision.attemptNo, entry.expectedAttemptNo);
    assert.equal(decision.mode, entry.expectedMode);
    assert.equal(decision.reused, entry.expectedReused);
    assert.equal(
      decision.effectKey,
      entry.status === "UNKNOWN"
        ? priorEffectKey
        : buildTranscriptDeliveryEffectKey(validSpec(), 2),
    );
  });
}

test("UNKNOWN and RETRY_REQUIRED reject a prior key from another delivery", () => {
  const foreignKey = buildTranscriptDeliveryEffectKey(
    validSpec({ deliveryId: "delivery-foreign" }),
    1,
  );

  for (const status of ["UNKNOWN", "RETRY_REQUIRED"] as const) {
    expectCollaborationError(
      () => decideTranscriptDeliveryEffect(validSpec(), {
        status,
        priorAttempt: { attemptNo: 1, effectKey: foreignKey },
      }),
      "IDEMPOTENCY_CONFLICT",
    );
  }
});

test("effect strategy rejects unsupported states and ambiguous transition shapes", () => {
  const firstKey = buildTranscriptDeliveryEffectKey(validSpec(), 1);
  const invalidTransitions: ReadonlyArray<{ value: unknown; code: CollaborationError["code"] }> = [
    { value: { status: "DELIVERED" }, code: "INVALID_TRANSITION" },
    {
      value: { status: "PREPARED", priorAttempt: { attemptNo: 1, effectKey: firstKey } },
      code: "INVALID_REQUEST",
    },
    { value: { status: "UNKNOWN" }, code: "INVALID_REQUEST" },
    {
      value: {
        status: "UNKNOWN",
        priorAttempt: { attemptNo: 1, effectKey: ` ${firstKey}` },
      },
      code: "INVALID_REQUEST",
    },
  ];

  for (const entry of invalidTransitions) {
    expectCollaborationError(
      () => decideTranscriptDeliveryEffect(validSpec(), entry.value),
      entry.code,
    );
  }
});

test("RETRY_REQUIRED enforces the bounded attempt policy", () => {
  const spec = normalizeTranscriptDeliverySpec(validSpec()) as TranscriptDeliverySpec;
  const lastAllowedKey = buildTranscriptDeliveryEffectKey(spec, 32);
  expectCollaborationError(
    () => decideTranscriptDeliveryEffect(spec, {
      status: "RETRY_REQUIRED",
      priorAttempt: { attemptNo: 32, effectKey: lastAllowedKey },
    }),
    "CAPACITY_EXCEEDED",
  );
});
