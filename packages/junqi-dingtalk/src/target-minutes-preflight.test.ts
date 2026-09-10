import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_MINUTES_TOOL_NAMES,
  parseDingTalkTargetMinutesFixture,
  parseDingTalkTargetMinutesPreflightArguments,
  runDingTalkTargetMinutesPreflight,
  validateMinutesReadAcknowledgement,
} from "./target-minutes-preflight.js";
import type { DingTalkToolSpec, DwsLeafSchema, DwsParameterSchema } from "./types.js";

const FIXTURE = {
  query: "唯一项目周会 2026-09-09",
  taskId: "minutes-task-1",
} as const;

const PARAMETERS_BY_TOOL_NAME: Record<string, Record<string, DwsParameterSchema>> = {
  junqi_dingtalk_minutes_search: {
    query: { type: "string" },
    scope: { type: "string", enum: ["mine", "shared", "all"] },
    "page-all": { type: "boolean" },
    "page-limit": { type: "integer" },
  },
  junqi_dingtalk_minutes_detail: {
    id: { type: "string" },
    artifacts: {
      type: "array",
      enum: ["basic", "summary", "keywords", "transcript", "todos"],
    },
  },
  junqi_dingtalk_minutes_transcript: {
    id: { type: "string" },
    "page-limit": { type: "integer" },
  },
  junqi_dingtalk_minutes_action_items: {
    id: { type: "string" },
  },
};

function schemaFor(spec: DingTalkToolSpec): DwsLeafSchema {
  return {
    availability: "available",
    canonical_path: spec.canonicalPath,
    cli_path: spec.cliPath,
    effect: spec.effect,
    risk: spec.risk,
    confirmation: spec.confirmation,
    idempotency: spec.idempotency,
    parameters: PARAMETERS_BY_TOOL_NAME[spec.name] ?? {},
  };
}

function readSuccess(data: unknown): { readonly data: Record<string, unknown> } {
  return { data: { ok: true, outcome: "success", data } };
}

const SUCCESS_DATA = {
  search: {
    scope: "all",
    count: 1,
    minutes: [{ taskUuid: FIXTURE.taskId, title: FIXTURE.query }],
    pages: 2,
    complete: true,
  },
  detail: {
    taskUuid: FIXTURE.taskId,
    complete: true,
    failureCount: 0,
    basic: { result: { taskUuid: FIXTURE.taskId } },
    summary: { result: { fullSummary: "discarded" } },
    keywords: { result: { keywords: [] } },
  },
  transcript: {
    taskUuid: FIXTURE.taskId,
    direction: "0",
    complete: true,
    pages: 2,
    paragraphCount: 2,
    duplicateCount: 1,
    paragraphList: [{ paragraphId: "p1" }, { paragraphId: "p2" }],
  },
  actionItems: {
    actions: [{ task: "discarded" }, { task: "discarded" }],
  },
} as const;

function successForCommand(command: readonly string[]) {
  if (command[1] === "+search") return readSuccess(SUCCESS_DATA.search);
  if (command[1] === "+detail") return readSuccess(SUCCESS_DATA.detail);
  if (command[1] === "+transcript") return readSuccess(SUCCESS_DATA.transcript);
  return readSuccess(SUCCESS_DATA.actionItems);
}

test("听记目标预检先核验全部契约和参数再按同一任务完成四阶段读取", async () => {
  const events: string[] = [];
  const calls: Array<{ readonly command: readonly string[]; readonly profile?: string }> = [];
  const result = await runDingTalkTargetMinutesPreflight(
    {
      async verify(spec) {
        events.push(`schema:${spec.name}`);
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run(command, options) {
        events.push(`read:${command[1]}`);
        calls.push({ command, profile: options?.profile });
        return successForCommand(command);
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.deepEqual(result, {
    status: "passed",
    checkedCount: 4,
    schemaVerifiedCount: 4,
    argumentValidatedCount: 4,
    readAttemptedCount: 4,
    passedCount: 4,
    unattemptedCount: 0,
    completedStages: ["search", "detail", "transcript", "action_items"],
    writeExecuted: false,
    businessPayloadRetained: false,
    sameTaskVerified: true,
    transcriptComplete: true,
    failures: [],
    searchMatchCount: 1,
    transcriptPages: 2,
    transcriptParagraphCount: 2,
    transcriptDuplicateCount: 1,
    actionItemCount: 2,
  });
  assert.deepEqual(events.slice(0, 4), DINGTALK_TARGET_MINUTES_TOOL_NAMES.map((name) => `schema:${name}`));
  assert.equal(calls.every((call) => call.profile === "corp:user"), true);
  assert.deepEqual(calls.map((call) => call.command), [
    [
      "minutes", "+search",
      "--query", FIXTURE.query,
      "--scope", "all",
      "--page-all",
      "--page-limit", "100",
    ],
    [
      "minutes", "+detail",
      "--id", FIXTURE.taskId,
      "--artifacts", "basic,summary,keywords",
    ],
    ["minutes", "+transcript", "--id", FIXTURE.taskId, "--page-limit", "100"],
    ["minutes", "+action-items", "--id", FIXTURE.taskId],
  ]);
  assert.equal(JSON.stringify(result).includes(FIXTURE.query), false);
  assert.equal(JSON.stringify(result).includes(FIXTURE.taskId), false);
  assert.equal(JSON.stringify(result).includes("discarded"), false);
});

test("听记目标预检任一契约失败时完成契约矩阵但不读取业务数据", async () => {
  let readCount = 0;
  const result = await runDingTalkTargetMinutesPreflight(
    {
      async verify(spec) {
        if (spec.name === "junqi_dingtalk_minutes_transcript") {
          throw new DingTalkRuntimeError("DWS_SCHEMA_DRIFT", "private drift");
        }
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run() {
        readCount += 1;
        return readSuccess({});
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(readCount, 0);
  assert.equal(result.status, "preflight_failed");
  assert.equal(result.schemaVerifiedCount, 3);
  assert.equal(result.argumentValidatedCount, 0);
  assert.equal(result.readAttemptedCount, 0);
  assert.deepEqual(result.failures.map((failure) => failure.stage), ["schema"]);
});

test("听记目标预检参数契约漂移时不执行任何部分读取", async () => {
  let readCount = 0;
  const result = await runDingTalkTargetMinutesPreflight(
    {
      async verify(spec) {
        return {
          schema: spec.name === "junqi_dingtalk_minutes_action_items"
            ? { ...schemaFor(spec), parameters: {} }
            : schemaFor(spec),
        };
      },
    },
    {
      async run() {
        readCount += 1;
        return readSuccess({});
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(readCount, 0);
  assert.equal(result.status, "preflight_failed");
  assert.equal(result.schemaVerifiedCount, 4);
  assert.equal(result.argumentValidatedCount, 3);
  assert.deepEqual(result.failures.map((failure) => failure.stage), ["arguments"]);
});

test("听记搜索必须完整且唯一命中预期任务", async () => {
  const result = await runDingTalkTargetMinutesPreflight(
    { async verify(spec) { return { schema: schemaFor(spec) }; } },
    {
      async run(command) {
        if (command[1] === "+search") {
          return readSuccess({
            ...SUCCESS_DATA.search,
            count: 2,
            minutes: [
              SUCCESS_DATA.search.minutes[0],
              { taskUuid: "minutes-task-2", title: FIXTURE.query },
            ],
          });
        }
        return successForCommand(command);
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(result.status, "read_failed");
  assert.equal(result.readAttemptedCount, 1);
  assert.equal(result.passedCount, 0);
  assert.equal(result.sameTaskVerified, false);
  assert.deepEqual(result.failures.map((failure) => failure.stage), ["search"]);
});

test("听记详情身份不一致时停止逐字稿和行动项读取", async () => {
  const calls: string[] = [];
  const result = await runDingTalkTargetMinutesPreflight(
    { async verify(spec) { return { schema: schemaFor(spec) }; } },
    {
      async run(command) {
        calls.push(command[1] ?? "");
        if (command[1] === "+detail") {
          return readSuccess({ ...SUCCESS_DATA.detail, taskUuid: "minutes-task-2" });
        }
        return successForCommand(command);
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.deepEqual(calls, ["+search", "+detail"]);
  assert.equal(result.status, "read_failed");
  assert.deepEqual(result.completedStages, ["search"]);
  assert.deepEqual(result.failures.map((failure) => failure.stage), ["detail"]);
});

test("听记逐字稿不完整时停止行动项读取并保留失败关闭状态", async () => {
  const calls: string[] = [];
  const result = await runDingTalkTargetMinutesPreflight(
    { async verify(spec) { return { schema: schemaFor(spec) }; } },
    {
      async run(command) {
        calls.push(command[1] ?? "");
        if (command[1] === "+transcript") {
          return readSuccess({ ...SUCCESS_DATA.transcript, complete: false });
        }
        return successForCommand(command);
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.deepEqual(calls, ["+search", "+detail", "+transcript"]);
  assert.equal(result.status, "read_failed");
  assert.equal(result.transcriptComplete, false);
  assert.deepEqual(result.completedStages, ["search", "detail"]);
  assert.deepEqual(result.failures.map((failure) => failure.stage), ["transcript"]);
});

test("听记行动项缺少正式集合时不能把空对象当成成功", async () => {
  const result = await runDingTalkTargetMinutesPreflight(
    { async verify(spec) { return { schema: schemaFor(spec) }; } },
    {
      async run(command) {
        if (command[1] === "+action-items") return readSuccess({});
        return successForCommand(command);
      },
    },
    "corp:user",
    DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(result.status, "read_failed");
  assert.equal(result.readAttemptedCount, 4);
  assert.equal(result.sameTaskVerified, true);
  assert.equal(result.transcriptComplete, true);
  assert.deepEqual(result.completedStages, ["search", "detail", "transcript"]);
  assert.deepEqual(result.failures.map((failure) => failure.stage), ["action_items"]);
});

test("听记目标预检拒绝错误确认和不闭合 fixture", () => {
  assert.throws(
    () => validateMinutesReadAcknowledgement("wrong"),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_MINUTES_PREFLIGHT_INVALID",
  );
  for (const fixture of [
    { query: FIXTURE.query },
    { ...FIXTURE, extra: true },
    { ...FIXTURE, taskId: "minutes task 1" },
    { ...FIXTURE, query: "" },
  ]) {
    assert.throws(
      () => parseDingTalkTargetMinutesFixture(fixture),
      (error) => error instanceof DingTalkRuntimeError
        && error.code === "DWS_MINUTES_PREFLIGHT_INVALID",
    );
  }
});

test("听记目标预检命令只接受绝对路径、精确 Profile 和固定确认", () => {
  assert.deepEqual(parseDingTalkTargetMinutesPreflightArguments([
    "--dws-path", "/opt/dws",
    "--profile", "corp:user",
    "--acknowledge-sensitive-read", DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
  ]), {
    dwsPath: "/opt/dws",
    profile: "corp:user",
    acknowledgement: DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT,
  });
  for (const argv of [
    [],
    ["--dws-path", "relative", "--profile", "corp:user", "--acknowledge-sensitive-read", DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT],
    ["--dws-path", "/opt/dws", "--profile", "corp:user", "--extra", "value"],
    ["--dws-path", "/opt/dws", "--dws-path", "/other", "--profile", "corp:user", "--acknowledge-sensitive-read", DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT],
  ]) {
    assert.throws(
      () => parseDingTalkTargetMinutesPreflightArguments(argv),
      (error) => error instanceof DingTalkRuntimeError
        && error.code === "DWS_MINUTES_PREFLIGHT_INVALID",
    );
  }
});
