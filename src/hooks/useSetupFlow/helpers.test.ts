import assert from "node:assert/strict";
import test from "node:test";
import type { SetupStep } from "@/stores/setup-navigation";
import { cacheGatewayTarget, setupBackPolicy } from "./helpers";

const ALL_SETUP_STEPS: SetupStep[] = [
  "welcome",
  "detecting",
  "environment-review",
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
  "update-openclaw",
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
      ["environment-review", "navigate"],
      ["storage", "rollback-storage"],
      ["gateway-stopped", "cancel-run"],
      ["choosing-mode", "rollback-storage"],
      ["checking", "cancel-install"],
      ["install-git", "cancel-install"],
      ["git-missing", "cancel-install"],
      ["node-missing", "cancel-install"],
      ["install-node", "cancel-install"],
      ["install-openclaw", "cancel-install"],
      ["gateway-ready", "navigate"],
      ["update-openclaw", "navigate"],
      ["configure-openclaw", "navigate"],
      ["ready", "navigate"],
      ["error", "navigate"],
    ],
  );
});

test("setup caches only the selected Gateway endpoint in its dedicated preference", () => {
  localStorage.clear();

  cacheGatewayTarget(28789);

  assert.equal(localStorage.getItem("aegis-gateway-url"), "ws://127.0.0.1:28789");
  assert.equal(localStorage.getItem("aegis-config"), null);
});
