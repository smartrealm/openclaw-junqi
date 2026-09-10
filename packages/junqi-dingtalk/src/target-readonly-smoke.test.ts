import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE,
  runDingTalkTargetReadonlySmoke,
} from "./target-readonly-smoke.js";
import type { DingTalkToolSpec, DwsLeafSchema } from "./types.js";

function schemaFor(spec: DingTalkToolSpec): DwsLeafSchema {
  return {
    availability: "available",
    canonical_path: spec.canonicalPath,
    cli_path: spec.cliPath,
    effect: spec.effect,
    risk: spec.risk,
    confirmation: spec.confirmation,
    idempotency: spec.idempotency,
    parameters: {},
  };
}

test("目标租户核心只读冒烟只执行五个固定低风险工具", async () => {
  const calls: Array<{ command: readonly string[]; profile?: string }> = [];
  const result = await runDingTalkTargetReadonlySmoke(
    {
      async verify(spec) {
        assert.equal(spec.effect, "read");
        assert.equal(spec.risk, "low");
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run(command, options) {
        calls.push({ command, profile: options?.profile });
        return {
          data: {
            ok: true,
            outcome: "success",
            data: { sensitiveBusinessPayload: "discarded" },
          },
        };
      },
    },
    "corp:user",
    "core",
  );

  assert.deepEqual(result, {
    scope: "core",
    checkedCount: 5,
    passedCount: 5,
    failedCount: 0,
    failures: [],
  });
  assert.deepEqual(calls.map((call) => call.command), [
    ["contact", "user", "get-self"],
    ["calendar", "+today"],
    ["todo", "+overdue"],
    ["todo", "+due-today"],
    ["oa", "approval", "list-pending"],
  ]);
  assert.equal(calls.length, DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE.core.length);
  assert.equal(calls.every((call) => call.profile === "corp:user"), true);
  assert.doesNotMatch(JSON.stringify(result), /sensitiveBusinessPayload|discarded/);
});

test("目标租户扩展只读冒烟覆盖七个额外业务域且不保留业务结果", async () => {
  const calls: Array<{ command: readonly string[]; profile?: string }> = [];
  const result = await runDingTalkTargetReadonlySmoke(
    {
      async verify(spec) {
        assert.equal(spec.effect, "read");
        assert.equal(spec.risk, "low");
        assert.equal(spec.confirmation, "not_required");
        assert.equal(spec.idempotency, "idempotent");
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run(command, options) {
        calls.push({ command, profile: options?.profile });
        return {
          data: {
            ok: true,
            outcome: "success",
            data: { sensitiveBusinessPayload: "discarded" },
          },
        };
      },
    },
    "corp:user",
    "extended",
  );

  assert.deepEqual(result, {
    scope: "extended",
    checkedCount: 12,
    passedCount: 12,
    failedCount: 0,
    failures: [],
  });
  assert.deepEqual(calls.map((call) => call.command), [
    ["contact", "user", "get-self"],
    ["calendar", "+today"],
    ["todo", "+overdue"],
    ["todo", "+due-today"],
    ["oa", "approval", "list-pending"],
    ["minutes", "+latest"],
    ["wiki", "+space-list"],
    ["report", "+report-latest"],
    ["mail", "+triage"],
    ["chat", "+unread-chats"],
    ["recruit", "job", "list"],
    ["agoal", "+user-rules"],
  ]);
  assert.equal(calls.length, DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE.extended.length);
  assert.equal(calls.every((call) => call.profile === "corp:user"), true);
  assert.doesNotMatch(JSON.stringify(result), /sensitiveBusinessPayload|discarded/);
});

test("目标租户扩展只读冒烟保留逐工具失败且继续后续检查", async () => {
  let callCount = 0;
  const result = await runDingTalkTargetReadonlySmoke(
    {
      async verify(spec) {
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run() {
        callCount += 1;
        if (callCount === 2) {
          throw new DingTalkRuntimeError("DWS_COMMAND_FAILED", "private upstream error");
        }
        return { data: { ok: true, outcome: "success", data: {} } };
      },
    },
    "corp:user",
    "extended",
  );

  assert.equal(callCount, 12);
  assert.equal(result.scope, "extended");
  assert.equal(result.checkedCount, 12);
  assert.equal(result.passedCount, 11);
  assert.equal(result.failedCount, 1);
  assert.equal(result.failures[0]?.toolName, "junqi_dingtalk_calendar_today");
  assert.deepEqual(result.failures[0]?.error, {
    code: "DWS_COMMAND_FAILED",
    message: "DWS command failed",
  });
});

test("目标租户只读冒烟拒绝零退出的失败或畸形结果信封", async () => {
  let callCount = 0;
  const result = await runDingTalkTargetReadonlySmoke(
    {
      async verify(spec) {
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run() {
        callCount += 1;
        if (callCount === 2) {
          return { data: { ok: false, outcome: "failure", error: { private: "discarded" } } };
        }
        if (callCount === 4) {
          return { data: { ok: true, outcome: "success" } };
        }
        return { data: { ok: true, outcome: "success", data: {} } };
      },
    },
    "corp:user",
    "core",
  );

  assert.equal(callCount, 5);
  assert.equal(result.passedCount, 3);
  assert.equal(result.failedCount, 2);
  assert.deepEqual(result.failures.map((failure) => ({
    toolName: failure.toolName,
    error: failure.error,
  })), [
    {
      toolName: "junqi_dingtalk_calendar_today",
      error: {
        code: "DWS_RESULT_INVALID",
        message: "DWS returned an invalid result envelope",
      },
    },
    {
      toolName: "junqi_dingtalk_todo_due_today",
      error: {
        code: "DWS_RESULT_INVALID",
        message: "DWS returned an invalid result envelope",
      },
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|discarded/);
});

test("目标租户只读冒烟要求显式选择核心或扩展范围", async () => {
  await assert.rejects(
    runDingTalkTargetReadonlySmoke(
      { async verify(spec) { return { schema: schemaFor(spec) }; } },
      { async run() { return { data: { ok: true, outcome: "success", data: {} } }; } },
      "corp:user",
      "all",
    ),
    /scope must be core or extended/,
  );
});
