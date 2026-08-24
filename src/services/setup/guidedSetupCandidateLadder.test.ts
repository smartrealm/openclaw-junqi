import assert from "node:assert/strict";
import test from "node:test";
import type { GuidedSetupDetection } from "@/services/gateway/OpenClawGuidedSetupClient";
import { activateFirstWorkingGuidedCandidate } from "./guidedSetupCandidateLadder";

const detection: GuidedSetupDetection = {
  methodFamily: "openclaw",
  candidates: [
    {
      kind: "codex-cli",
      label: "First",
      detail: "First candidate",
      modelRef: "first/model",
      recommended: true,
    },
    {
      kind: "codex-cli",
      label: "Second",
      detail: "Second candidate",
      modelRef: "second/model",
      recommended: false,
    },
  ],
  unavailableCandidates: [],
  manualProviders: [],
  authOptions: [],
  recommendedInstalls: [],
  workspace: "/workspace",
  setupComplete: false,
};

test("guided setup activates candidates in the OpenClaw response order", async () => {
  const calls: string[] = [];
  const result = await activateFirstWorkingGuidedCandidate(detection, {
    activateCandidate: async (candidate) => {
      calls.push(candidate.modelRef);
      return candidate.modelRef === "second/model"
        ? { ok: true, modelRef: candidate.modelRef }
        : { ok: false, status: "auth", error: "unavailable" };
    },
  });

  assert.deepEqual(calls, ["first/model", "second/model"]);
  assert.equal(result.activated, true);
  if (result.activated) assert.equal(result.candidate.modelRef, "second/model");
});

test("guided setup skips candidates whose credentials are explicitly unavailable", async () => {
  const calls: string[] = [];
  const result = await activateFirstWorkingGuidedCandidate({
    ...detection,
    candidates: [
      { ...detection.candidates[0], credentials: false },
      detection.candidates[1],
    ],
  }, {
    activateCandidate: async (candidate) => {
      calls.push(candidate.modelRef);
      return { ok: true, modelRef: candidate.modelRef };
    },
  });

  assert.deepEqual(calls, ["second/model"]);
  assert.equal(result.activated, true);
});

test("guided setup stops after an existing model fails verification", async () => {
  const calls: string[] = [];
  const result = await activateFirstWorkingGuidedCandidate({
    ...detection,
    candidates: [
      { ...detection.candidates[0], kind: "existing-model" },
      detection.candidates[1],
    ],
  }, {
    activateCandidate: async (candidate) => {
      calls.push(candidate.modelRef);
      return { ok: false, status: "auth", error: "unavailable" };
    },
  });

  assert.deepEqual(calls, ["first/model"]);
  assert.deepEqual(result, {
    activated: false,
    lastResult: { ok: false, status: "auth", error: "unavailable" },
  });
});

test("guided setup preserves the last official failure after exhausting candidates", async () => {
  const result = await activateFirstWorkingGuidedCandidate(detection, {
    activateCandidate: async () => ({ ok: false, status: "billing", error: "billing unavailable" }),
  });

  assert.deepEqual(result, {
    activated: false,
    lastResult: { ok: false, status: "billing", error: "billing unavailable" },
  });
});

test("guided setup stops automatic activation after a request interruption", async () => {
  const interruption = new Error("temporary SQLite cleanup failed");
  const calls: string[] = [];
  const result = await activateFirstWorkingGuidedCandidate(detection, {
    activateCandidate: async (candidate) => {
      calls.push(candidate.modelRef);
      throw interruption;
    },
  });

  assert.deepEqual(calls, ["first/model"]);
  assert.deepEqual(result, {
    activated: false,
    lastResult: null,
    interruptedCause: interruption,
  });
});

test("guided setup does not continue after an interruption following an official failure", async () => {
  const interruption = new Error("gateway interrupted");
  const calls: string[] = [];
  const result = await activateFirstWorkingGuidedCandidate(detection, {
    activateCandidate: async (candidate) => {
      calls.push(candidate.modelRef);
      if (candidate.modelRef === "first/model") {
        return { ok: false, status: "auth", error: "missing credential" };
      }
      throw interruption;
    },
  });

  assert.deepEqual(calls, ["first/model", "second/model"]);
  assert.deepEqual(result, {
    activated: false,
    lastResult: { ok: false, status: "auth", error: "missing credential" },
    interruptedCause: interruption,
  });
});

test("guided setup does not invent a candidate when detection returns none", async () => {
  let called = false;
  const result = await activateFirstWorkingGuidedCandidate(
    { ...detection, candidates: [] },
    {
      activateCandidate: async () => {
        called = true;
        return { ok: true, modelRef: "unexpected/model" };
      },
    },
  );

  assert.equal(called, false);
  assert.deepEqual(result, { activated: false, lastResult: null });
});
