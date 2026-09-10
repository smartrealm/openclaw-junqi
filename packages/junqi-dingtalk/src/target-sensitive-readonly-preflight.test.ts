import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
  DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES,
  buildDingTalkTargetSensitiveToolInvocations,
  parseDingTalkTargetSensitiveReadonlyFixture,
  runDingTalkTargetSensitiveReadonlyPreflight,
} from "./target-sensitive-readonly-preflight.js";
import type { DingTalkToolSpec, DwsLeafSchema, DwsParameterSchema } from "./types.js";

const PARAMETERS_BY_TOOL_NAME: Record<string, Record<string, DwsParameterSchema>> = {
  junqi_dingtalk_aitable_base_search: { query: { type: "string", required: true } },
  junqi_dingtalk_aitable_schema: { "base-id": { type: "string", required: true } },
  junqi_dingtalk_aitable_tables: { base: { type: "string", required: true } },
  junqi_dingtalk_aitable_records: {
    "base-id": { type: "string", required: true },
    "table-id": { type: "string", required: true },
    "record-ids": { type: "array" },
    limit: { type: "integer" },
  },
  junqi_dingtalk_contract_projects: {
    "current-page": { type: "integer", required: true },
    "page-size": { type: "integer", required: true },
    scope: { type: "string", required: true },
    code: { type: "string" },
  },
  junqi_dingtalk_contract_project: { "project-id": { type: "integer", required: true } },
  junqi_dingtalk_contract_subjects: {
    "current-page": { type: "integer", required: true },
    "page-size": { type: "integer", required: true },
    name: { type: "string" },
  },
  junqi_dingtalk_contract_subject: { "subject-id": { type: "integer", required: true } },
  junqi_dingtalk_contract_risk: {
    "subject-id": { type: "integer" },
    "subject-name": { type: "string", required: true },
  },
  junqi_dingtalk_contract_review_analysis: { file: { type: "string", required: true } },
  junqi_dingtalk_contract_review_result: {
    "task-id": { type: "string", required: true },
    "review-type": { type: "string", required: true },
  },
  junqi_dingtalk_recruit_jobs: {
    "job-ids": { type: "array" },
    size: { type: "integer" },
  },
  junqi_dingtalk_recruit_job: { "job-id": { type: "string", required: true } },
  junqi_dingtalk_goal_user_rules: {},
  junqi_dingtalk_goal_templates: {
    keyword: { type: "string" },
    page: { type: "integer" },
    "page-size": { type: "integer" },
  },
  junqi_dingtalk_goal_statistics: { keyword: { type: "string" } },
  junqi_dingtalk_goal_report_detail: {
    "template-id": { type: "string", required: true },
    "submit-state": { type: "string", required: true },
    page: { type: "integer" },
    "page-size": { type: "integer" },
  },
};

const FIXTURE = {
  aitable: {
    query: "受控表格",
    baseId: "base-controlled",
    tableId: "table-controlled",
    recordId: "record-controlled",
  },
  contract: {
    projectId: 101,
    projectCode: "project-controlled",
    subjectId: 202,
    subjectName: "受控合同主体",
    analysisRequest: {
      fileInfo: {
        fileId: "file-controlled",
        spaceId: "space-controlled",
        fileName: "controlled.pdf",
        fileSize: "1024",
        fileType: "pdf",
      },
    },
    reviewTaskId: "review-controlled",
    reviewType: "AI_REVIEW",
  },
  recruit: { jobId: "job-controlled" },
  goal: {
    templateKeyword: "受控目标模板",
    ruleKeyword: "受控目标规则",
    templateId: "goal-template-controlled",
    submitState: "ON_TIME",
  },
} as const;

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

function readSuccess(data: unknown = {}): { readonly data: Record<string, unknown> } {
  return { data: { ok: true, outcome: "success", data } };
}

test("高敏共享计划只让合同分析在插件边界接收内联对象", () => {
  const fixture = parseDingTalkTargetSensitiveReadonlyFixture(FIXTURE);
  const invocations = buildDingTalkTargetSensitiveToolInvocations(fixture);
  assert.equal(invocations.length, 17);
  const analysis = invocations.find((entry) => (
    entry.toolName === "junqi_dingtalk_contract_review_analysis"
  ));
  assert.deepEqual(analysis, {
    toolName: "junqi_dingtalk_contract_review_analysis",
    canonicalPath: "contract.review_analysis",
    arguments: { file: FIXTURE.contract.analysisRequest },
    schemaArguments: { file: "-" },
  });
  assert.equal(invocations.filter((entry) => entry.arguments !== entry.schemaArguments).length, 1);
});

test("高敏只读预检在任何读取前核验全部 17 个契约并限制查询范围", async () => {
  const events: string[] = [];
  const calls: Array<{
    command: readonly string[];
    profile?: string;
    stdin?: string;
  }> = [];
  const result = await runDingTalkTargetSensitiveReadonlyPreflight(
    {
      async verify(spec) {
        events.push(`schema:${spec.name}`);
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run(command, options) {
        events.push(`read:${command.slice(0, 3).join(" ")}`);
        calls.push({ command, profile: options?.profile, stdin: options?.stdin });
        return readSuccess({ sensitiveBusinessPayload: "discarded" });
      },
    },
    "corp:user",
    DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.deepEqual(result, {
    status: "passed",
    checkedCount: 17,
    schemaVerifiedCount: 17,
    argumentValidatedCount: 17,
    readAttemptedCount: 17,
    passedCount: 17,
    failedCount: 0,
    unattemptedCount: 0,
    writeExecuted: false,
    businessPayloadRetained: false,
    failures: [],
  });
  assert.equal(events.slice(0, 17).every((event) => event.startsWith("schema:")), true);
  assert.equal(calls.length, 17);
  assert.equal(calls.every((call) => call.profile === "corp:user"), true);
  assert.deepEqual(calls.map((call) => call.command), [
    ["aitable", "+base-search", "--query", "受控表格"],
    ["aitable", "+base-schema-snapshot", "--base-id", "base-controlled"],
    ["aitable", "+list-tables", "--base", "base-controlled"],
    [
      "aitable", "+record-query",
      "--base-id", "base-controlled",
      "--table-id", "table-controlled",
      "--record-ids", "record-controlled",
      "--limit", "1",
    ],
    [
      "contract", "project", "list",
      "--current-page", "1",
      "--page-size", "1",
      "--scope", "self",
      "--code", "project-controlled",
    ],
    ["contract", "project", "detail", "--project-id", "101"],
    [
      "contract", "subject", "list",
      "--current-page", "1",
      "--page-size", "1",
      "--name", "受控合同主体",
    ],
    ["contract", "subject", "detail", "--subject-id", "202"],
    [
      "contract", "subject", "detect-risk",
      "--subject-id", "202",
      "--subject-name", "受控合同主体",
    ],
    ["contract", "review", "analysis", "--file", "-"],
    [
      "contract", "review", "result",
      "--task-id", "review-controlled",
      "--review-type", "AI_REVIEW",
    ],
    ["recruit", "job", "list", "--job-ids", "job-controlled", "--size", "1"],
    ["recruit", "job", "get", "--job-id", "job-controlled"],
    ["agoal", "+user-rules"],
    ["agoal", "+obj-template-list", "--keyword", "受控目标模板", "--page", "1", "--page-size", "1"],
    ["agoal", "+report-statistics-list", "--keyword", "受控目标规则"],
    [
      "agoal", "+report-submit-detail",
      "--template-id", "goal-template-controlled",
      "--submit-state", "ON_TIME",
      "--page", "1",
      "--page-size", "1",
    ],
  ]);
  const analysisCall = calls[9];
  assert.deepEqual(
    JSON.parse(analysisCall?.stdin ?? "null"),
    FIXTURE.contract.analysisRequest,
  );
  assert.doesNotMatch(analysisCall?.command.join(" ") ?? "", /file-controlled|space-controlled/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /sensitiveBusinessPayload|discarded|base-controlled|受控合同主体|review-controlled/,
  );
});

test("高敏只读预检任一 Schema 失败时核验完全部契约但不读取业务数据", async () => {
  let verifiedCount = 0;
  let readCount = 0;
  const result = await runDingTalkTargetSensitiveReadonlyPreflight(
    {
      async verify(spec) {
        verifiedCount += 1;
        if (spec.name === "junqi_dingtalk_contract_project") {
          throw new DingTalkRuntimeError("DWS_SCHEMA_DRIFT", "private drift", {
            fields: ["availability"],
          });
        }
        return { schema: schemaFor(spec) };
      },
    },
    {
      async run() {
        readCount += 1;
        return readSuccess();
      },
    },
    "corp:user",
    DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(verifiedCount, 17);
  assert.equal(readCount, 0);
  assert.deepEqual(result, {
    status: "preflight_failed",
    checkedCount: 17,
    schemaVerifiedCount: 16,
    argumentValidatedCount: 0,
    readAttemptedCount: 0,
    passedCount: 0,
    failedCount: 1,
    unattemptedCount: 16,
    writeExecuted: false,
    businessPayloadRetained: false,
    failures: [{
      toolName: "junqi_dingtalk_contract_project",
      canonicalPath: "contract.project_detail",
      stage: "schema",
      error: {
        code: "DWS_SCHEMA_DRIFT",
        message: "DWS schema differs from the reviewed contract",
        details: { fields: ["availability"] },
      },
    }],
  });
});

test("高敏只读预检参数漂移时不执行任何部分读取", async () => {
  let readCount = 0;
  const result = await runDingTalkTargetSensitiveReadonlyPreflight(
    {
      async verify(spec) {
        const schema = schemaFor(spec);
        return {
          schema: spec.name === "junqi_dingtalk_aitable_base_search"
            ? {
                ...schema,
                parameters: {
                  ...schema.parameters,
                  tenant: { type: "string", required: true },
                },
              }
            : schema,
        };
      },
    },
    {
      async run() {
        readCount += 1;
        return readSuccess();
      },
    },
    "corp:user",
    DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(readCount, 0);
  assert.equal(result.status, "preflight_failed");
  assert.equal(result.schemaVerifiedCount, 17);
  assert.equal(result.argumentValidatedCount, 16);
  assert.equal(result.readAttemptedCount, 0);
  assert.equal(result.failures[0]?.stage, "arguments");
  assert.equal(result.failures[0]?.error.code, "DWS_ARGUMENT_REQUIRED");
});

test("高敏只读预检保留逐工具失败并继续完成权限矩阵", async () => {
  let readCount = 0;
  const result = await runDingTalkTargetSensitiveReadonlyPreflight(
    { async verify(spec) { return { schema: schemaFor(spec) }; } },
    {
      async run() {
        readCount += 1;
        if (readCount === 4) {
          throw new DingTalkRuntimeError("DWS_COMMAND_FAILED", "private failure");
        }
        return readSuccess();
      },
    },
    "corp:user",
    DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(readCount, 17);
  assert.equal(result.status, "read_failed");
  assert.equal(result.passedCount, 16);
  assert.equal(result.failedCount, 1);
  assert.equal(result.unattemptedCount, 0);
  assert.equal(result.failures[0]?.toolName, "junqi_dingtalk_aitable_records");
  assert.equal(result.failures[0]?.stage, "read");
  assert.deepEqual(result.failures[0]?.error, {
    code: "DWS_COMMAND_FAILED",
    message: "DWS command failed",
  });
});

test("高敏只读预检拒绝零退出的失败信封并继续完成权限矩阵", async () => {
  let readCount = 0;
  const result = await runDingTalkTargetSensitiveReadonlyPreflight(
    { async verify(spec) { return { schema: schemaFor(spec) }; } },
    {
      async run() {
        readCount += 1;
        if (readCount === 10) {
          return { data: { ok: false, outcome: "failure", error: { private: "discarded" } } };
        }
        return readSuccess();
      },
    },
    "corp:user",
    DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT,
    FIXTURE,
  );

  assert.equal(readCount, 17);
  assert.equal(result.status, "read_failed");
  assert.equal(result.passedCount, 16);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.failures, [{
    toolName: "junqi_dingtalk_contract_review_analysis",
    canonicalPath: "contract.review_analysis",
    stage: "read",
    error: {
      code: "DWS_RESULT_INVALID",
      message: "DWS returned an invalid result envelope",
    },
  }]);
  assert.doesNotMatch(JSON.stringify(result), /private|discarded/);
});

test("高敏只读预检拒绝错误确认、额外字段和无效稳定标识", async () => {
  await assert.rejects(
    runDingTalkTargetSensitiveReadonlyPreflight(
      { async verify(spec) { return { schema: schemaFor(spec) }; } },
      { async run() { return readSuccess(); } },
      "corp:user",
      "wrong",
      FIXTURE,
    ),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_SENSITIVE_PREFLIGHT_INVALID"
      && error.details?.fields?.includes("acknowledgement"),
  );
  assert.throws(
    () => parseDingTalkTargetSensitiveReadonlyFixture({ ...FIXTURE, extra: true }),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_SENSITIVE_PREFLIGHT_INVALID"
      && error.details?.fields?.includes("fixture"),
  );
  assert.throws(
    () => parseDingTalkTargetSensitiveReadonlyFixture({
      ...FIXTURE,
      contract: { ...FIXTURE.contract, projectId: 0 },
    }),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_SENSITIVE_PREFLIGHT_INVALID"
      && error.details?.fields?.includes("contract.projectId"),
  );
  assert.equal(DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES.length, 17);
});
