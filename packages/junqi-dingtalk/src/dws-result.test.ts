import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";
import { requireDwsSuccessResult } from "./dws-result.js";

test("DWS 成功结果只接受完整统一信封并返回业务数据", () => {
  const data = { value: "private" };
  assert.equal(requireDwsSuccessResult({
    data: { ok: true, outcome: "success", data },
  }), data);
});

test("DWS 成功结果拒绝失败、等待和缺少数据的信封", () => {
  for (const data of [
    { ok: false, outcome: "failure", error: { private: "discarded" } },
    { ok: true, outcome: "pending", data: {} },
    { ok: true, outcome: "success" },
    [],
    null,
  ]) {
    assert.throws(
      () => requireDwsSuccessResult({ data }),
      (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_RESULT_INVALID",
    );
  }
  assert.deepEqual(serializeRuntimeError(new DingTalkRuntimeError(
    "DWS_RESULT_INVALID",
    "private result details",
  )), {
    code: "DWS_RESULT_INVALID",
    message: "DWS returned an invalid result envelope",
  });
});
