import assert from "node:assert/strict";
import test from "node:test";
import { shouldBlockWorkspaceEntry } from "./setupEntryGate";

test("持久安装和官方配置任一仍在核验时阻止工作台渲染", () => {
  assert.equal(shouldBlockWorkspaceEntry({
    setupComplete: true,
    installationValidationPending: true,
    officialSetupValidationPending: false,
  }), true);
  assert.equal(shouldBlockWorkspaceEntry({
    setupComplete: true,
    installationValidationPending: false,
    officialSetupValidationPending: true,
  }), true);
});

test("仅完成标记和两项核验都收敛后允许工作台渲染", () => {
  assert.equal(shouldBlockWorkspaceEntry({
    setupComplete: true,
    installationValidationPending: false,
    officialSetupValidationPending: false,
  }), false);
  assert.equal(shouldBlockWorkspaceEntry({
    setupComplete: null,
    installationValidationPending: true,
    officialSetupValidationPending: true,
  }), false);
});
