import assert from "node:assert/strict";
import test from "node:test";
import type { GuidedSetupDetection } from "@/services/gateway/OpenClawGuidedSetupClient";
import { activateFirstWorkingGuidedCandidate } from "./guidedSetupCandidateLadder";

const detection: GuidedSetupDetection = {
  candidates: [
    {
      kind: "existing-model",
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
  manualProviders: [],
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

test("guided setup preserves the last official failure after exhausting candidates", async () => {
  const result = await activateFirstWorkingGuidedCandidate(detection, {
    activateCandidate: async () => ({ ok: false, status: "billing", error: "billing unavailable" }),
  });

  assert.deepEqual(result, {
    activated: false,
    lastResult: { ok: false, status: "billing", error: "billing unavailable" },
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
