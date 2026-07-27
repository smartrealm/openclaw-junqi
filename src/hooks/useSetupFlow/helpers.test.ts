import assert from "node:assert/strict";
import test from "node:test";
import type { SetupStep } from "@/stores/setup-navigation";
import { setupBackPolicy } from "./helpers";

const ALL_SETUP_STEPS: SetupStep[] = [
  "welcome",
  "detecting",
  "storage",
  "gateway-stopped",
  "choosing-mode",
  "checking",
  "install-git",
  "git-missing",
  "node-missing",
  "install-node",
  "install-openclaw",
  "gateway-ready",
  "configure-openclaw",
  "ready",
  "error",
];

test("every setup page has an explicit Back side-effect policy", () => {
  assert.deepEqual(
    ALL_SETUP_STEPS.map((step) => [step, setupBackPolicy(step)]),
    [
      ["welcome", "navigate"],
      ["detecting", "cancel-run"],
      ["storage", "rollback-storage"],
      ["gateway-stopped", "cancel-run"],
      ["choosing-mode", "rollback-storage"],
      ["checking", "navigate"],
      ["install-git", "navigate"],
      ["git-missing", "navigate"],
      ["node-missing", "navigate"],
      ["install-node", "navigate"],
      ["install-openclaw", "navigate"],
      ["gateway-ready", "navigate"],
      ["configure-openclaw", "navigate"],
      ["ready", "navigate"],
      ["error", "navigate"],
    ],
  );
});
