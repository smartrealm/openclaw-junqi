import assert from "node:assert/strict";
import test from "node:test";
import type { SetupStep } from "@/stores/setup-navigation";
import {
  cacheGatewayTarget,
  settleRuntimeStepsAfterGatewayReady,
  shouldRollbackRuntimeReconfigurationOnBack,
  setupBackPolicy,
} from "./helpers";

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

test("运行时恢复失败页返回时保留待恢复事务并退出当前页面", () => {
  assert.equal(shouldRollbackRuntimeReconfigurationOnBack("storage", false), true);
  assert.equal(shouldRollbackRuntimeReconfigurationOnBack("storage", true), false);
  assert.equal(shouldRollbackRuntimeReconfigurationOnBack("choosing-mode", true), true);
});

test("Native Gateway 核验成功会原子收敛恢复路径遗留的步骤状态", () => {
  assert.deepEqual(
    settleRuntimeStepsAfterGatewayReady([
      { id: "node", label: "Node.js", status: "running", detail: "正在检测" },
      { id: "npm", label: "npm", status: "pending" },
      { id: "openclaw", label: "OpenClaw", status: "done", detail: "2026.7.1-2", progress: 100 },
      { id: "gateway", label: "Gateway", status: "running", detail: "正在连接" },
    ], "native"),
    [
      { id: "node", label: "Node.js", status: "done", detail: undefined, progress: 100 },
      { id: "npm", label: "npm", status: "skipped", detail: undefined, progress: 100 },
      { id: "openclaw", label: "OpenClaw", status: "done", detail: "2026.7.1-2", progress: 100 },
      { id: "gateway", label: "Gateway", status: "done", detail: undefined, progress: 100 },
    ],
  );
});

test("已核验的 npm 版本和 Docker 拉取结果不会被 Gateway 终态覆盖", () => {
  assert.deepEqual(
    settleRuntimeStepsAfterGatewayReady([
      { id: "npm", label: "npm", status: "done", detail: "11.9.0", progress: 100 },
      { id: "gateway", label: "Gateway", status: "running" },
    ], "native"),
    [
      { id: "npm", label: "npm", status: "done", detail: "11.9.0", progress: 100 },
      { id: "gateway", label: "Gateway", status: "done", detail: undefined, progress: 100 },
    ],
  );
  assert.deepEqual(
    settleRuntimeStepsAfterGatewayReady([
      { id: "pull", label: "Docker Image", status: "done", detail: "已复用", progress: 100 },
      { id: "container", label: "Container", status: "running" },
      { id: "gateway", label: "Gateway", status: "running" },
    ], "docker"),
    [
      { id: "pull", label: "Docker Image", status: "done", detail: "已复用", progress: 100 },
      { id: "container", label: "Container", status: "done", detail: undefined, progress: 100 },
      { id: "gateway", label: "Gateway", status: "done", detail: undefined, progress: 100 },
    ],
  );
});
