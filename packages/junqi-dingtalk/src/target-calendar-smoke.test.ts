import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_TARGET_CALENDAR_SMOKE_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_CALENDAR_SMOKE_TOOL_NAMES,
  parseDingTalkTargetCalendarSmokeArguments,
  runDingTalkTargetCalendarSmoke,
} from "./target-calendar-smoke.js";
import { DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE } from "./target-readonly-smoke.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsLeafSchema } from "./types.js";

function schemaFor(spec: DingTalkToolSpec): DwsLeafSchema {
  const parameters = spec.effect === "read"
    ? {}
    : spec.name === "junqi_dingtalk_calendar_create"
    ? {
        title: { type: "string", required: true },
        start: { type: "string", required: true },
        end: { type: "string", required: true },
        timezone: { type: "string" },
      }
    : spec.name === "junqi_dingtalk_calendar_update"
      ? {
          event: { type: "string", required: true },
          title: { type: "string" },
        }
      : { event: { type: "string", required: true } };
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
    title: "受控验收日程",
    updatedTitle: "受控验收日程已更新",
    start: "2026-09-10T10:00:00+08:00",
    end: "2026-09-10T10:30:00+08:00",
    timezone: "Asia/Shanghai",
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

test("目标租户日程验收命令要求精确写入确认且拒绝歧义参数", () => {
  const argumentsList = [
    "--dws-path",
    "/opt/dws",
    "--profile",
    "corp:user",
    "--title",
    "受控验收日程",
    "--updated-title",
    "受控验收日程已更新",
    "--start",
    "2026-09-10T10:00:00+08:00",
    "--end",
    "2026-09-10T10:30:00+08:00",
    "--acknowledge-writes",
    DINGTALK_TARGET_CALENDAR_SMOKE_ACKNOWLEDGEMENT,
  ];
  assert.deepEqual(parseDingTalkTargetCalendarSmokeArguments(argumentsList), {
    dwsPath: "/opt/dws",
    profile: "corp:user",
    title: "受控验收日程",
    updatedTitle: "受控验收日程已更新",
    start: "2026-09-10T10:00:00+08:00",
    end: "2026-09-10T10:30:00+08:00",
  });
  assert.throws(
    () => parseDingTalkTargetCalendarSmokeArguments(argumentsList.slice(0, -2)),
    /required argument is missing/,
  );
  assert.throws(
    () => parseDingTalkTargetCalendarSmokeArguments([
      ...argumentsList.slice(0, -1),
      "calendar-create-only",
    ]),
    /acknowledgement is invalid/,
  );
  assert.throws(
    () => parseDingTalkTargetCalendarSmokeArguments([...argumentsList, "--title", "重复"]),
    /duplicate argument/,
  );
  assert.throws(
    () => parseDingTalkTargetCalendarSmokeArguments([...argumentsList, "--unknown", "value"]),
    /unsupported argument/,
  );
});

test("目标租户日程验收先核验全部契约再按同一 ID 创建更新取消", async () => {
  const fixture = schemas();
  const calls: Array<{
    command: readonly string[];
    options: { profile?: string; confirmed?: boolean; sideEffect?: boolean } | undefined;
  }> = [];
  const result = await runDingTalkTargetCalendarSmoke(
    fixture.registry,
    {
      async run(command, options) {
        calls.push({ command, options });
        if (command.includes("+create")) {
          return { data: { ok: true, outcome: "success", data: { eventId: "event-1", verified: true } } };
        }
        if (command.includes("+update")) {
          return { data: { ok: true, outcome: "success", data: { eventId: "event-1", verified: true } } };
        }
        return {
          data: {
            ok: true,
            outcome: "success",
            data: { eventId: "event-1", deleted: true, verified: true },
          },
        };
      },
    },
    input(),
  );

  assert.deepEqual(fixture.verified, [
    ...DINGTALK_TARGET_CALENDAR_SMOKE_TOOL_NAMES,
    ...DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE.core,
  ]);
  assert.deepEqual(result, {
    status: "verified",
    checkedContractCount: 3,
    readonlyPreflight: {
      scope: "core",
      checkedCount: 5,
      passedCount: 5,
      failedCount: 0,
      failures: [],
    },
    completedSteps: ["create", "update", "cancel"],
    resourceId: "event-1",
    verificationStatus: "verified",
    recovery: "none",
  });
  assert.deepEqual(calls.map((call) => call.command), [
    ...DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE.core.map((name) => {
      const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
      assert.ok(spec);
      return spec.cliPath.split(" ");
    }),
    [
      "calendar",
      "+create",
      "--title",
      "受控验收日程",
      "--start",
      "2026-09-10T10:00:00+08:00",
      "--end",
      "2026-09-10T10:30:00+08:00",
      "--timezone",
      "Asia/Shanghai",
    ],
    ["calendar", "+update", "--event", "event-1", "--title", "受控验收日程已更新"],
    ["calendar", "+cancel-event", "--event", "event-1"],
  ]);
  assert.equal(calls.every((call) => call.options?.profile === "corp:user"), true);
  assert.equal(calls.slice(0, 5).every((call) => call.options?.confirmed === undefined), true);
  assert.equal(calls.slice(0, 5).every((call) => call.options?.sideEffect === undefined), true);
  assert.equal(calls.slice(5).every((call) => call.options?.confirmed === true), true);
  assert.equal(calls.slice(5).every((call) => call.options?.sideEffect === true), true);
  assert.doesNotMatch(JSON.stringify(result), /corp:user|受控验收日程|Asia\/Shanghai/);
});

test("目标租户日程验收在核心只读预检失败时收集完整结果且不执行写入", async () => {
  const fixture = schemas();
  let readCallCount = 0;
  let writeCallCount = 0;
  const result = await runDingTalkTargetCalendarSmoke(
    fixture.registry,
    {
      async run(command, options) {
        if (options?.sideEffect) {
          writeCallCount += 1;
          return readSuccess();
        }
        readCallCount += 1;
        if (command.includes("+today")) {
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
      toolName: "junqi_dingtalk_calendar_today",
      canonicalPath: "calendar.shortcut_today",
      error: {
        code: "DWS_COMMAND_FAILED",
        message: "DWS command failed",
      },
    }],
  });
});

test("目标租户日程验收在任一契约失败时不执行写入", async () => {
  const fixture = schemas({ failAt: "junqi_dingtalk_calendar_update" });
  let callCount = 0;
  const result = await runDingTalkTargetCalendarSmoke(
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
  assert.equal(result.recovery, "fix_contract_before_retry");
  assert.deepEqual(result.error, {
    code: "DWS_SCHEMA_DRIFT",
    message: "DWS schema differs from the reviewed contract",
  });
});

test("目标租户日程验收在更新身份不一致时停止且不取消", async () => {
  const fixture = schemas();
  const calls: string[][] = [];
  const result = await runDingTalkTargetCalendarSmoke(
    fixture.registry,
    {
      async run(command, options) {
        if (!options?.sideEffect) return readSuccess();
        calls.push([...command]);
        return command.includes("+create")
          ? { data: { ok: true, outcome: "success", data: { eventId: "event-1", verified: true } } }
          : { data: { ok: true, outcome: "success", data: { eventId: "event-other", verified: true } } };
      },
    },
    input(),
  );

  assert.equal(calls.length, 2);
  assert.equal(result.status, "unknown");
  assert.equal(result.failedStage, "update");
  assert.equal(result.resourceId, "event-1");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
  assert.equal(result.recovery, "inspect_exact_event_before_any_action");
});

test("目标租户日程验收在创建结果丢失时禁止继续或重试", async () => {
  const fixture = schemas();
  let writeCallCount = 0;
  const result = await runDingTalkTargetCalendarSmoke(
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
  assert.deepEqual(result.error, {
    code: "DWS_SIDE_EFFECT_UNVERIFIED",
    message: "DWS side effect status is unverified",
  });
});

test("目标租户日程验收在取消结果未知时不自动重试", async () => {
  const fixture = schemas();
  let writeCallCount = 0;
  const result = await runDingTalkTargetCalendarSmoke(
    fixture.registry,
    {
      async run(_command, options) {
        if (!options?.sideEffect) return readSuccess();
        writeCallCount += 1;
        if (writeCallCount < 3) {
          return { data: { ok: true, outcome: "success", data: { eventId: "event-1", verified: true } } };
        }
        throw new DingTalkRuntimeError("DWS_SIDE_EFFECT_UNVERIFIED", "private runtime details");
      },
    },
    input(),
  );

  assert.equal(writeCallCount, 3);
  assert.equal(result.status, "unknown");
  assert.equal(result.failedStage, "cancel");
  assert.equal(result.resourceId, "event-1");
  assert.deepEqual(result.completedSteps, ["create", "update"]);
  assert.equal(result.recovery, "inspect_exact_event_before_any_action");
});
