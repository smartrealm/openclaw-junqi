import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_TARGET_TODO_SMOKE_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_TODO_SMOKE_TOOL_NAMES,
  parseDingTalkTargetTodoSmokeArguments,
  runDingTalkTargetTodoSmoke,
} from "./target-todo-smoke.js";
import { DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE } from "./target-readonly-smoke.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsLeafSchema } from "./types.js";

function schemaFor(spec: DingTalkToolSpec): DwsLeafSchema {
  const parameters = spec.effect === "read"
    ? {}
    : spec.name === "junqi_dingtalk_todo_create"
    ? {
        title: { type: "string", required: true },
        executors: { type: "array", required: true },
      }
    : spec.name === "junqi_dingtalk_todo_update"
      ? {
          "task-id": { type: "string", required: true },
          title: { type: "string" },
        }
      : { "task-id": { type: "string", required: true } };
  return {
    canonical_path: spec.canonicalPath,
    cli_path: spec.cliPath,
    effect: spec.effect,
    risk: spec.risk,
    confirmation: spec.confirmation,
    idempotency: spec.idempotency,
    parameters,
  };
}

function input() {
  return {
    profile: "corp:user",
    executor: "user",
    title: "受控验收待办",
    updatedTitle: "受控验收待办已更新",
  };
}

function readSuccess(): { readonly data: Record<string, unknown> } {
  return { data: { ok: true, outcome: "success", data: {} } };
}

function schemas(options: { failAt?: string } = {}) {
  const verified: string[] = [];
  return {
    verified,
    registry: {
      async verify(spec: DingTalkToolSpec) {
        verified.push(spec.name);
        if (spec.name === options.failAt) {
          throw new DingTalkRuntimeError("DWS_SCHEMA_DRIFT", "private schema details");
        }
        return { schema: schemaFor(spec), digest: spec.name.padEnd(64, "0").slice(0, 64) };
      },
    },
  };
}

test("目标租户待办验收命令要求精确确认且执行人必须显式提供", () => {
  const argumentsList = [
    "--dws-path",
    "/opt/dws",
    "--profile",
    "corp:user",
    "--executor",
    "user",
    "--title",
    "受控验收待办",
    "--updated-title",
    "受控验收待办已更新",
    "--acknowledge-writes",
    DINGTALK_TARGET_TODO_SMOKE_ACKNOWLEDGEMENT,
  ];
  assert.deepEqual(parseDingTalkTargetTodoSmokeArguments(argumentsList), {
    dwsPath: "/opt/dws",
    profile: "corp:user",
    executor: "user",
    title: "受控验收待办",
    updatedTitle: "受控验收待办已更新",
  });
  assert.throws(
    () => parseDingTalkTargetTodoSmokeArguments(argumentsList.slice(0, -2)),
    /required argument is missing/,
  );
  assert.throws(
    () => parseDingTalkTargetTodoSmokeArguments([
      ...argumentsList.slice(0, -1),
      "todo-create-only",
    ]),
    /acknowledgement is invalid/,
  );
  assert.throws(
    () => parseDingTalkTargetTodoSmokeArguments([...argumentsList, "--executor", "other"]),
    /duplicate argument/,
  );
});

test("目标租户待办验收按同一 ID 创建更新完成重开并最终完成", async () => {
  const fixture = schemas();
  const calls: Array<{
    command: readonly string[];
    options: { profile?: string; confirmed?: boolean; sideEffect?: boolean } | undefined;
  }> = [];
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run(command, options) {
        calls.push({ command, options });
        return {
          data: {
            ok: true,
            outcome: "success",
            data: { taskId: "task-1", verified: true },
          },
        };
      },
    },
    input(),
  );

  assert.deepEqual(fixture.verified, [
    ...DINGTALK_TARGET_TODO_SMOKE_TOOL_NAMES,
    ...DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE.core,
  ]);
  assert.deepEqual(result, {
    status: "verified",
    checkedContractCount: 4,
    readonlyPreflight: {
      scope: "core",
      checkedCount: 5,
      passedCount: 5,
      failedCount: 0,
      failures: [],
    },
    completedSteps: ["create", "update", "complete_initial", "reopen", "complete_final"],
    resourceId: "task-1",
    verificationStatus: "verified",
    recovery: "none",
  });
  assert.deepEqual(calls.map((call) => call.command), [
    ...DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE.core.map((name) => {
      const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
      assert.ok(spec);
      return spec.cliPath.split(" ");
    }),
    ["todo", "+create", "--title", "受控验收待办", "--executors", "user"],
    ["todo", "+update", "--task-id", "task-1", "--title", "受控验收待办已更新"],
    ["todo", "+complete", "--task-id", "task-1"],
    ["todo", "+reopen", "--task-id", "task-1"],
    ["todo", "+complete", "--task-id", "task-1"],
  ]);
  assert.equal(calls.every((call) => call.options?.profile === "corp:user"), true);
  assert.equal(calls.slice(0, 5).every((call) => call.options?.confirmed === undefined), true);
  assert.equal(calls.slice(0, 5).every((call) => call.options?.sideEffect === undefined), true);
  assert.equal(calls.slice(5).every((call) => call.options?.confirmed === true), true);
  assert.equal(calls.slice(5).every((call) => call.options?.sideEffect === true), true);
  assert.doesNotMatch(JSON.stringify(result), /corp:user|受控验收待办/);
});

test("目标租户待办验收在核心只读预检失败时收集完整结果且不执行写入", async () => {
  const fixture = schemas();
  let readCallCount = 0;
  let writeCallCount = 0;
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run(command, options) {
        if (options?.sideEffect) {
          writeCallCount += 1;
          return readSuccess();
        }
        readCallCount += 1;
        if (command.includes("+overdue")) {
          throw new DingTalkRuntimeError("DWS_COMMAND_FAILED", "private tenant details");
        }
        return readSuccess();
      },
    },
    input(),
  );

  assert.equal(readCallCount, 5);
  assert.equal(writeCallCount, 0);
  assert.equal(result.status, "failed_before_write");
  assert.equal(result.failedStage, "readonly_preflight");
  assert.equal(result.recovery, "fix_read_access_before_retry");
  assert.deepEqual(result.readonlyPreflight, {
    scope: "core",
    checkedCount: 5,
    passedCount: 4,
    failedCount: 1,
    failures: [{
      toolName: "junqi_dingtalk_todo_overdue",
      canonicalPath: "todo.shortcut_overdue",
      error: {
        code: "DWS_COMMAND_FAILED",
        message: "DWS command failed",
      },
    }],
  });
});

test("目标租户待办验收拒绝把任务分配给 Profile 外的用户", async () => {
  const fixture = schemas();
  let callCount = 0;
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        return readSuccess();
      },
    },
    { ...input(), executor: "other" },
  );

  assert.equal(callCount, 0);
  assert.equal(fixture.verified.length, 0);
  assert.equal(result.status, "failed_before_write");
  assert.equal(result.failedStage, "contract");
  assert.equal(result.recovery, "fix_contract_before_retry");
});

test("目标租户待办验收在任一契约失败时不执行写入", async () => {
  const fixture = schemas({ failAt: "junqi_dingtalk_todo_complete" });
  let callCount = 0;
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        return readSuccess();
      },
    },
    input(),
  );

  assert.equal(callCount, 0);
  assert.equal(result.status, "failed_before_write");
  assert.equal(result.failedStage, "contract");
  assert.deepEqual(result.error, {
    code: "DWS_SCHEMA_DRIFT",
    message: "DWS schema differs from the reviewed contract",
  });
});

test("目标租户待办验收在更新身份不一致时停止后续状态写入", async () => {
  const fixture = schemas();
  const calls: string[][] = [];
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run(command, options) {
        if (!options?.sideEffect) return readSuccess();
        calls.push([...command]);
        return command.includes("+create")
          ? { data: { ok: true, outcome: "success", data: { taskId: "task-1", verified: true } } }
          : { data: { ok: true, outcome: "success", data: { taskId: "task-other", verified: true } } };
      },
    },
    input(),
  );

  assert.equal(calls.length, 2);
  assert.equal(result.status, "unknown");
  assert.equal(result.failedStage, "update");
  assert.equal(result.resourceId, "task-1");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
  assert.equal(result.recovery, "inspect_exact_task_before_any_action");
});

test("目标租户待办验收在创建结果未知时禁止继续或重试", async () => {
  const fixture = schemas();
  let writeCallCount = 0;
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run(_command, options) {
        if (!options?.sideEffect) return readSuccess();
        writeCallCount += 1;
        throw new DingTalkRuntimeError("DWS_SIDE_EFFECT_UNVERIFIED", "private runtime details");
      },
    },
    input(),
  );

  assert.equal(writeCallCount, 1);
  assert.equal(result.status, "unknown");
  assert.equal(result.failedStage, "create");
  assert.equal(result.resourceId, undefined);
  assert.equal(result.recovery, "inspect_by_unique_title_before_any_retry");
});

test("目标租户待办验收在最终完成结果未知时不自动重试", async () => {
  const fixture = schemas();
  let writeCallCount = 0;
  const result = await runDingTalkTargetTodoSmoke(
    fixture.registry,
    {
      async run(_command, options) {
        if (!options?.sideEffect) return readSuccess();
        writeCallCount += 1;
        if (writeCallCount < 5) {
          return { data: { ok: true, outcome: "success", data: { taskId: "task-1", verified: true } } };
        }
        throw new DingTalkRuntimeError("DWS_SIDE_EFFECT_UNVERIFIED", "private runtime details");
      },
    },
    input(),
  );

  assert.equal(writeCallCount, 5);
  assert.equal(result.status, "unknown");
  assert.equal(result.failedStage, "complete_final");
  assert.equal(result.resourceId, "task-1");
  assert.deepEqual(result.completedSteps, ["create", "update", "complete_initial", "reopen"]);
  assert.equal(result.recovery, "inspect_exact_task_before_any_action");
});
