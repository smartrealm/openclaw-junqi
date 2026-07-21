import assert from "node:assert/strict";
import test from "node:test";
import { decideTerminalAttemptCompletion } from "./terminal-attempt-completion-policy.js";

test("terminal attempt completion accepts an active phase and its exact suspended resume phase", () => {
  assert.deepEqual(decideTerminalAttemptCompletion({
    attemptKind: "PLANNER",
    runStatus: "PLANNING",
    resumeStatus: null,
  }), {
    kind: "ACCEPT",
    mode: "ACTIVE",
    expectedRunStatus: "PLANNING",
  });
  assert.deepEqual(decideTerminalAttemptCompletion({
    attemptKind: "SYNTHESIZER",
    runStatus: "AWAITING_INTERVENTION",
    resumeStatus: "SYNTHESIZING",
  }), {
    kind: "ACCEPT",
    mode: "SUSPENDED",
    expectedRunStatus: "SYNTHESIZING",
  });
});

test("terminal attempt completion rejects mismatched suspended phases and unsupported kinds", () => {
  assert.deepEqual(decideTerminalAttemptCompletion({
    attemptKind: "PLANNER",
    runStatus: "AWAITING_INTERVENTION",
    resumeStatus: "SYNTHESIZING",
  }), {
    kind: "REJECT",
    expectedRunStatus: "PLANNING",
    reason: "RUN_PHASE_MISMATCH",
  });
  assert.deepEqual(decideTerminalAttemptCompletion({
    attemptKind: "SYNTHESIZER",
    runStatus: "RUNNING",
    resumeStatus: "SYNTHESIZING",
  }), {
    kind: "REJECT",
    expectedRunStatus: "SYNTHESIZING",
    reason: "RUN_PHASE_MISMATCH",
  });
  assert.deepEqual(decideTerminalAttemptCompletion({
    attemptKind: "DELIVERY",
    runStatus: "AWAITING_INTERVENTION",
    resumeStatus: "SYNTHESIZING",
  }), {
    kind: "REJECT",
    expectedRunStatus: null,
    reason: "UNSUPPORTED_ATTEMPT_KIND",
  });
});
