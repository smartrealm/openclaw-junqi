import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_TARGET_REPORT_PREFLIGHT_TOOL_NAMES,
  parseDingTalkTargetReportPreflightArguments,
  runDingTalkTargetReportPreflight,
} from "./target-report-preflight.js";
import type { DingTalkToolSpec, DwsLeafSchema } from "./types.js";

function schemaFor(spec: DingTalkToolSpec): DwsLeafSchema {
  const parameters = spec.name === "junqi_dingtalk_report_template_search"
    ? { query: { type: "string", required: true } }
    : spec.name === "junqi_dingtalk_report_template"
      ? { name: { type: "string", required: true } }
      : spec.name === "junqi_dingtalk_report_submit"
        ? {
            "template-id": { type: "string", required: true },
            contents: { type: "string" },
            "contents-file": { type: "string" },
            "to-user-ids": { type: "string", required: true },
            "to-chat": { type: "boolean" },
            "dd-from": { type: "string" },
          }
        : { "report-id": { type: "string", required: true } };
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
    templateName: "项目周报",
    contents: JSON.stringify([
      {
        key: "本周完成",
        sort: 0,
        content: "完成受控验收",
        contentType: "text",
        type: "markdown",
      },
    ]),
    toUserIds: "user,manager",
  };
}

function searchResult(templates: unknown[], count = templates.length) {
  return { data: { ok: true, outcome: "success", data: { count, templates } } };
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
        return { schema: schemaFor(spec) };
      },
    },
  };
}

test("目标租户日志预检只接受固定的只读预检参数", () => {
  const argumentsList = [
    "--dws-path", "/opt/dws",
    "--profile", "corp:user",
    "--template-name", "项目周报",
    "--contents", "[]",
    "--to-user-ids", "user",
  ];
  assert.deepEqual(parseDingTalkTargetReportPreflightArguments(argumentsList), {
    dwsPath: "/opt/dws",
    profile: "corp:user",
    templateName: "项目周报",
    contents: "[]",
    toUserIds: "user",
  });
  assert.throws(
    () => parseDingTalkTargetReportPreflightArguments(argumentsList.slice(0, -2)),
    /required argument is missing/,
  );
  assert.throws(
    () => parseDingTalkTargetReportPreflightArguments([...argumentsList, "--to-chat", "true"]),
    /unsupported argument/,
  );
  assert.throws(
    () => parseDingTalkTargetReportPreflightArguments([...argumentsList, "--profile", "other:user"]),
    /duplicate argument/,
  );
});

test("目标租户日志预检在核验契约前拒绝无效内容和接收人", async () => {
  const fixture = schemas();
  let callCount = 0;
  const runner = {
    async run() {
      callCount += 1;
      return { data: {} };
    },
  };
  const invalidContents = await runDingTalkTargetReportPreflight(
    fixture.registry,
    runner,
    { ...input(), contents: "[]" },
  );
  const duplicateRecipients = await runDingTalkTargetReportPreflight(
    fixture.registry,
    runner,
    { ...input(), toUserIds: "user,user" },
  );
  const emptyRecipient = await runDingTalkTargetReportPreflight(
    fixture.registry,
    runner,
    { ...input(), toUserIds: "user," },
  );

  assert.equal(callCount, 0);
  assert.equal(fixture.verified.length, 0);
  for (const result of [invalidContents, duplicateRecipients, emptyRecipient]) {
    assert.equal(result.status, "failed");
    assert.equal(result.failedStage, "contract");
    assert.equal(result.error?.code, "DWS_REPORT_PREFLIGHT_INVALID");
  }
});

test("目标租户日志预检先核验四项契约再只读唯一精确模板", async () => {
  const fixture = schemas();
  const calls: Array<{
    command: readonly string[];
    options: { profile?: string } | undefined;
  }> = [];
  const result = await runDingTalkTargetReportPreflight(
    fixture.registry,
    {
      async run(command, options) {
        calls.push({ command, options });
        if (calls.length === 1) {
          return searchResult([
            { templateId: "template-other", name: "项目周报旧版" },
            { templateId: "template-exact", name: "项目周报", lastModifiedTime: 1 },
          ]);
        }
        return {
          data: {
            ok: true,
            outcome: "success",
            data: { privateTemplateDefinition: "discarded" },
          },
        };
      },
    },
    input(),
  );

  assert.deepEqual(fixture.verified, [...DINGTALK_TARGET_REPORT_PREFLIGHT_TOOL_NAMES]);
  assert.deepEqual(calls, [
    {
      command: ["report", "+template-search", "--query", "项目周报"],
      options: { profile: "corp:user" },
    },
    {
      command: ["report", "template", "get", "--name", "项目周报"],
      options: { profile: "corp:user" },
    },
  ]);
  assert.deepEqual(result, {
    status: "ready_for_manual_review",
    checkedContractCount: 4,
    executedReadCount: 2,
    checkedWriteContractCount: 1,
    completedStages: ["template_search", "template_definition"],
    writeExecuted: false,
    requiresManualTemplateReview: true,
  });
  assert.doesNotMatch(
    JSON.stringify(result),
    /corp:user|项目周报|template-exact|完成受控验收|manager|privateTemplateDefinition/,
  );
});

test("目标租户日志预检按官方规则拒绝无效字段类型组合", async () => {
  const invalidValues = [
    { ...input(), contents: '[{"key":"字段","sort":"x","content":"值","contentType":"markdown","type":"1"}]' },
    { ...input(), contents: '[{"key":"字段","sort":"0","content":"值","contentType":"origin","type":"1"}]' },
    { ...input(), contents: '[{"key":"字段","sort":"0","content":"值","contentType":"markdown","type":"2"}]' },
  ];
  for (const invalidValue of invalidValues) {
    const fixture = schemas();
    let callCount = 0;
    const result = await runDingTalkTargetReportPreflight(
      fixture.registry,
      { async run() { callCount += 1; return { data: {} }; } },
      invalidValue,
    );
    assert.equal(callCount, 0);
    assert.equal(fixture.verified.length, 0);
    assert.equal(result.error?.code, "DWS_REPORT_PREFLIGHT_INVALID");
  }
});

test("目标租户日志预检在任一契约失败时不读取租户数据", async () => {
  const fixture = schemas({ failAt: "junqi_dingtalk_report_detail" });
  let callCount = 0;
  const result = await runDingTalkTargetReportPreflight(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        return { data: {} };
      },
    },
    input(),
  );

  assert.equal(callCount, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "contract");
  assert.deepEqual(result.error, {
    code: "DWS_SCHEMA_DRIFT",
    message: "DWS schema differs from the reviewed contract",
  });
});

test("目标租户日志预检拒绝零个或多个精确模板且不读取定义", async () => {
  for (const templates of [
    [{ templateId: "template-other", name: "项目周报旧版" }],
    [
      { templateId: "template-one", name: "项目周报" },
      { templateId: "template-two", name: "项目周报" },
    ],
  ]) {
    const fixture = schemas();
    let callCount = 0;
    const result = await runDingTalkTargetReportPreflight(
      fixture.registry,
      {
        async run() {
          callCount += 1;
          return searchResult(templates);
        },
      },
      input(),
    );
    assert.equal(callCount, 1);
    assert.equal(result.status, "failed");
    assert.equal(result.failedStage, "template_search");
    assert.equal(result.error?.code, "DWS_REPORT_PREFLIGHT_TEMPLATE_UNRESOLVED");
  }
});

test("目标租户日志预检拒绝不完整或身份重复的模板搜索结果", async () => {
  const malformedResults = [
    searchResult([{ templateId: "template-exact", name: "项目周报" }], 2),
    searchResult([
      { templateId: "template-same", name: "项目周报" },
      { templateId: "template-same", name: "项目周报旧版" },
    ]),
    { data: { ok: true, outcome: "failure", data: { count: 0, templates: [] } } },
  ];
  for (const response of malformedResults) {
    const fixture = schemas();
    const result = await runDingTalkTargetReportPreflight(
      fixture.registry,
      { async run() { return response; } },
      input(),
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failedStage, "template_search");
    assert.equal(result.error?.code, "DWS_REPORT_PREFLIGHT_RESULT_INVALID");
  }
});

test("目标租户日志预检在模板定义读取失败时保留搜索阶段", async () => {
  const fixture = schemas();
  let callCount = 0;
  const result = await runDingTalkTargetReportPreflight(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        if (callCount === 1) {
          return searchResult([{ templateId: "template-exact", name: "项目周报" }]);
        }
        throw new DingTalkRuntimeError("DWS_COMMAND_FAILED", "private failure");
      },
    },
    input(),
  );

  assert.equal(callCount, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "template_definition");
  assert.equal(result.executedReadCount, 1);
  assert.deepEqual(result.completedStages, ["template_search"]);
  assert.equal(result.writeExecuted, false);
});

test("目标租户日志预检拒绝模板定义的零退出失败信封", async () => {
  const fixture = schemas();
  let callCount = 0;
  const result = await runDingTalkTargetReportPreflight(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        if (callCount === 1) {
          return searchResult([{ templateId: "template-exact", name: "项目周报" }]);
        }
        return { data: { ok: false, outcome: "failure", error: { private: "discarded" } } };
      },
    },
    input(),
  );

  assert.equal(callCount, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "template_definition");
  assert.equal(result.executedReadCount, 1);
  assert.deepEqual(result.error, {
    code: "DWS_RESULT_INVALID",
    message: "DWS returned an invalid result envelope",
  });
  assert.doesNotMatch(JSON.stringify(result), /private|discarded/);
});
