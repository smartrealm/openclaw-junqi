import assert from "node:assert/strict";
import test from "node:test";
import type { GuidedSetupDetection } from "@/services/gateway/OpenClawGuidedSetupClient";
import { resolveOpenClawSetupCapability } from "./openClawSetupCapability";

const detection: GuidedSetupDetection = {
  methodFamily: "openclaw",
  setupComplete: false,
  workspace: "/workspace",
  candidates: [],
  unavailableCandidates: [],
  manualProviders: [],
  authOptions: [],
  prepareOptions: [],
  recommendedInstalls: [],
};

function unavailable(availability: "unsupported" | "connection-unavailable") {
  return Object.assign(new Error(`guided setup unavailable: ${availability}`), {
    code: "OPENCLAW_GUIDED_SETUP_METHOD_UNAVAILABLE",
    availability,
  });
}

test("Guided RPC 可用时保留官方检测结果", async () => {
  assert.deepEqual(
    await resolveOpenClawSetupCapability(async () => detection),
    { mode: "guided", detection },
  );
});

test("Guided RPC 明确不支持时选择官方经典 Wizard", async () => {
  assert.deepEqual(
    await resolveOpenClawSetupCapability(async () => {
      throw unavailable("unsupported");
    }),
    { mode: "classic" },
  );
});

test("连接失败不能被降级为协议不支持", async () => {
  await assert.rejects(
    resolveOpenClawSetupCapability(async () => {
      throw unavailable("connection-unavailable");
    }),
    /connection-unavailable/,
  );
});
