import assert from "node:assert/strict";
import test from "node:test";
import { CollaborationError } from "./errors.js";
import {
  PERSISTENCE_LIMITS,
  assertBoundedText,
  assertPersistableText,
  boundedDiagnostic,
  sanitizeDesktopObservedFacts,
  sanitizeStoredJsonForOutput,
} from "./persistence-policy.js";

test("desktop facts use an exact allowlist and discard sensitive or unknown fields", () => {
  const facts = sanitizeDesktopObservedFacts({
    targetFingerprint: "target-1",
    deploymentKind: "system_service",
    persistence: "desktop_independent",
    gatewayVersion: "2026.7.1",
    token: "PRIVATE_GATEWAY_TOKEN",
    prompt: "PRIVATE_PROMPT",
    reasoning: "PRIVATE_REASONING",
    toolOutput: "PRIVATE_TOOL_OUTPUT",
    arbitrary: { nested: true },
  });
  assert.deepEqual(facts, {
    targetFingerprint: "target-1",
    deploymentKind: "system_service",
    persistence: "desktop_independent",
    gatewayVersion: "2026.7.1",
  });
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE_/);
});

test("stored JSON output drops legacy sensitive keys recursively", () => {
  const output = sanitizeStoredJsonForOutput({
    safe: "business evidence",
    nested: {
      prompt: "PRIVATE_PROMPT",
      reasoning: "PRIVATE_REASONING",
      token: "PRIVATE_TOKEN",
      evidence: "verified",
    },
  }, "legacy payload", 4096);
  assert.deepEqual(output, { safe: "business evidence", nested: { evidence: "verified" } });
});

test("diagnostics are redacted or wholly omitted while business text is never truncated", () => {
  const redacted = boundedDiagnostic(
    "request failed: authorization=Bearer secret-value token=secret-token reasoning=private thoughts",
  );
  assert.doesNotMatch(redacted, /secret-value|secret-token|private thoughts/);
  assert.match(redacted, /REDACTED/);
  const prefixedCredential = boundedDiagnostic("runtime rejected sk-proj-1234567890abcdef");
  assert.match(prefixedCredential, /^Diagnostic redacted/);
  assert.doesNotMatch(prefixedCredential, /sk-proj-/);

  const oversizedDiagnostic = "runtime output ".repeat(PERSISTENCE_LIMITS.diagnosticBytes);
  const omitted = boundedDiagnostic(oversizedDiagnostic);
  assert.match(omitted, /^Diagnostic omitted/);
  assert.match(omitted, /sha256:[a-f0-9]{64}/);
  assert.doesNotMatch(omitted, /runtime output/);

  const businessText = "x".repeat(PERSISTENCE_LIMITS.goalBytes + 1);
  assert.throws(
    () => assertBoundedText(businessText, "goal", PERSISTENCE_LIMITS.goalBytes),
    (error: unknown) => error instanceof CollaborationError
      && error.code === "CAPACITY_EXCEEDED"
      && error.details?.actualBytes === PERSISTENCE_LIMITS.goalBytes + 1,
  );

  assert.throws(
    () => assertPersistableText(
      "Call the service with Authorization=Bearer live-secret-value",
      "evidence.verification",
      PERSISTENCE_LIMITS.evidenceVerificationBytes,
    ),
    (error: unknown) => error instanceof CollaborationError
      && error.code === "INVALID_REQUEST"
      && /credential material/.test(error.message),
  );
  assert.equal(
    assertPersistableText(
      "The example uses token=[REDACTED] and keeps the business explanation.",
      "evidence.verification",
      PERSISTENCE_LIMITS.evidenceVerificationBytes,
    ),
    "The example uses token=[REDACTED] and keeps the business explanation.",
  );
});
