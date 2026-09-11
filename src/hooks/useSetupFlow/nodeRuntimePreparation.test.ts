import assert from "node:assert/strict";
import test from "node:test";
import type { NodeStatus, SetupNodeStatus } from "@/api/tauri-commands";
import {
  describeNodeRuntimePreparation,
  nextSetupNodeRepairAction,
} from "./nodeRuntimePreparation";

function node(overrides: Partial<NodeStatus> = {}): NodeStatus {
  return {
    available: false,
    version: null,
    path: null,
    source: null,
    ...overrides,
  };
}

function setupNode(
  nodeAvailable: boolean,
  npmAvailable: boolean,
): SetupNodeStatus {
  return {
    node: node({ available: nodeAvailable }),
    npm: {
      available: npmAvailable,
      version: null,
      path: null,
      source: null,
      reason: null,
    },
    requirement: ">=24.15.0 <25",
    requirementError: null,
  };
}

test("检测到但不兼容的 Node 会展示实际版本和目标版本范围", () => {
  assert.deepEqual(
    describeNodeRuntimePreparation(
      node({ version: "v23.8.0", path: "/runtime/node" }),
      ">=22.22.3 <23 || >=24.15.0 <25",
    ),
    {
      key: "setup.node.autoRepairDetected",
      params: {
        version: "v23.8.0",
        requirement: ">=22.22.3 <23 || >=24.15.0 <25",
      },
    },
  );
});

test("未发现 Node 时只展示目标包要求，不伪称检测到已有运行时", () => {
  assert.deepEqual(
    describeNodeRuntimePreparation(node(), ">=24.15.0 <25"),
    {
      key: "setup.node.autoRepair",
      params: { requirement: ">=24.15.0 <25" },
    },
  );
});

test("目标包要求暂时未知时保留中性的安装提示", () => {
  assert.deepEqual(
    describeNodeRuntimePreparation(node(), null),
    { key: "setup.installingNode", params: {} },
  );
});

test("存储恢复只在 Node 不可用时安装，Node 可用但 npm 缺失时修复", () => {
  assert.equal(nextSetupNodeRepairAction(setupNode(false, false)), "install");
  assert.equal(nextSetupNodeRepairAction(setupNode(true, false)), "repair-npm");
  assert.equal(nextSetupNodeRepairAction(setupNode(true, true)), "ready");
});
