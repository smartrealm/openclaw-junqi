import assert from "node:assert/strict";
import test from "node:test";
import { runtimeOptionDisabled } from "./ModeSelectScreen";

test("运行方式提交期间锁定所有选项，Docker 不可用时继续保持禁用", () => {
  assert.equal(runtimeOptionDisabled(false), false);
  assert.equal(runtimeOptionDisabled(true), true);
  assert.equal(runtimeOptionDisabled(false, false), true);
  assert.equal(runtimeOptionDisabled(true, false), true);
});
