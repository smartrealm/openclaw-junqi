import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_TARGET_APPROVAL_PREFLIGHT_TOOL_NAMES,
  parseDingTalkTargetApprovalPreflightArguments,
  runDingTalkTargetApprovalPreflight,
} from "./target-approval-preflight.js";
import type { DingTalkToolSpec, DwsLeafSchema } from "./types.js";

function schemaFor(spec: DingTalkToolSpec): DwsLeafSchema {
  const parameters = spec.name === "junqi_dingtalk_approval_form_schema"
    ? { "process-code": { type: "string", required: true } }
    : spec.name === "junqi_dingtalk_approval_forecast"
      || spec.name === "junqi_dingtalk_approval_create"
      ? {
          "process-code": { type: "string" },
          "dept-id": { type: "string" },
          "form-values": { type: "string" },
          request: { type: "string" },
        }
      : { "instance-id": { type: "string", required: true } };
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
    processCode: "PROC-1",
    deptId: "-1",
    formValues: "{\"事由\":\"受控验收\",\"金额\":\"1\"}",
  };
}

function readSuccess(data: unknown = {}): { readonly data: Record<string, unknown> } {
  return { data: { ok: true, outcome: "success", data } };
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

test("目标租户审批预检只接受固定的简单模式参数", () => {
  const argumentsList = [
    "--dws-path",
    "/opt/dws",
    "--profile",
    "corp:user",
    "--process-code",
    "PROC-1",
    "--dept-id",
    "-1",
    "--form-values",
    "{\"事由\":\"受控验收\"}",
  ];
  assert.deepEqual(parseDingTalkTargetApprovalPreflightArguments(argumentsList), {
    dwsPath: "/opt/dws",
    profile: "corp:user",
    processCode: "PROC-1",
    deptId: "-1",
    formValues: "{\"事由\":\"受控验收\"}",
  });
  assert.throws(
    () => parseDingTalkTargetApprovalPreflightArguments(argumentsList.slice(0, -2)),
    /required argument is missing/,
  );
  assert.throws(
    () => parseDingTalkTargetApprovalPreflightArguments([...argumentsList, "--request", "{}"]),
    /unsupported argument/,
  );
  assert.throws(
    () => parseDingTalkTargetApprovalPreflightArguments([...argumentsList, "--dept-id", "2"]),
    /duplicate argument/,
  );
});

test("目标租户审批预检在调用 DWS 前拒绝无效部门和表单值", async () => {
  const fixture = schemas();
  let callCount = 0;
  const runner = {
    async run() {
      callCount += 1;
      return { data: {} };
    },
  };

  const invalidDepartment = await runDingTalkTargetApprovalPreflight(
    fixture.registry,
    runner,
    { ...input(), deptId: "1.5" },
  );
  const invalidForm = await runDingTalkTargetApprovalPreflight(
    fixture.registry,
    runner,
    { ...input(), formValues: "{\"金额\":1}" },
  );

  assert.equal(callCount, 0);
  assert.equal(fixture.verified.length, 0);
  assert.equal(invalidDepartment.status, "failed");
  assert.equal(invalidDepartment.failedStage, "contract");
  assert.equal(invalidDepartment.error?.code, "DWS_APPROVAL_PREFLIGHT_INVALID");
  assert.equal(invalidForm.status, "failed");
  assert.equal(invalidForm.failedStage, "contract");
  assert.equal(invalidForm.error?.code, "DWS_APPROVAL_PREFLIGHT_INVALID");
});

test("目标租户审批预检先核验全部契约再只读表单和流程预测", async () => {
  const fixture = schemas();
  const calls: Array<{
    command: readonly string[];
    options: { profile?: string } | undefined;
  }> = [];
  const result = await runDingTalkTargetApprovalPreflight(
    fixture.registry,
    {
      async run(command, options) {
        calls.push({ command, options });
        return readSuccess({ privateBusinessPayload: "discarded" });
      },
    },
    input(),
  );

  assert.deepEqual(fixture.verified, [...DINGTALK_TARGET_APPROVAL_PREFLIGHT_TOOL_NAMES]);
  assert.deepEqual(calls, [
    {
      command: ["oa", "approval", "form-schema", "--process-code", "PROC-1"],
      options: { profile: "corp:user" },
    },
    {
      command: [
        "oa",
        "approval",
        "forecast-process",
        "--process-code",
        "PROC-1",
        "--dept-id",
        "-1",
        "--form-values",
        "{\"事由\":\"受控验收\",\"金额\":\"1\"}",
      ],
      options: { profile: "corp:user" },
    },
  ]);
  assert.deepEqual(result, {
    status: "ready_for_manual_review",
    checkedContractCount: 5,
    executedReadCount: 2,
    checkedWriteContractCount: 2,
    completedStages: ["form_schema", "forecast"],
    writeExecuted: false,
    requiresManualForecastReview: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /corp:user|PROC-1|受控验收|privateBusinessPayload/);
});

test("目标租户审批预检拒绝零退出的失败信封且不继续预测", async () => {
  const fixture = schemas();
  let callCount = 0;
  const result = await runDingTalkTargetApprovalPreflight(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        return { data: { ok: false, outcome: "failure", error: { private: "discarded" } } };
      },
    },
    input(),
  );

  assert.equal(callCount, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "form_schema");
  assert.equal(result.executedReadCount, 0);
  assert.deepEqual(result.error, {
    code: "DWS_RESULT_INVALID",
    message: "DWS returned an invalid result envelope",
  });
  assert.doesNotMatch(JSON.stringify(result), /private|discarded/);
});

test("目标租户审批预检在任一契约失败时不读取租户数据", async () => {
  const fixture = schemas({ failAt: "junqi_dingtalk_approval_revoke" });
  let callCount = 0;
  const result = await runDingTalkTargetApprovalPreflight(
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
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "contract");
  assert.equal(result.writeExecuted, false);
  assert.deepEqual(result.error, {
    code: "DWS_SCHEMA_DRIFT",
    message: "DWS schema differs from the reviewed contract",
  });
});

test("目标租户审批预检在表单读取失败后不预测流程", async () => {
  const fixture = schemas();
  let callCount = 0;
  const result = await runDingTalkTargetApprovalPreflight(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        throw new DingTalkRuntimeError("DWS_PROCESS_FAILED", "private runtime details");
      },
    },
    input(),
  );

  assert.equal(callCount, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "form_schema");
  assert.equal(result.executedReadCount, 0);
  assert.equal(result.writeExecuted, false);
});

test("目标租户审批预检在流程预测失败时保留已完成的表单阶段", async () => {
  const fixture = schemas();
  let callCount = 0;
  const result = await runDingTalkTargetApprovalPreflight(
    fixture.registry,
    {
      async run() {
        callCount += 1;
        if (callCount === 2) {
          throw new DingTalkRuntimeError("DWS_PROCESS_FAILED", "private runtime details");
        }
        return readSuccess();
      },
    },
    input(),
  );

  assert.equal(callCount, 2);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStage, "forecast");
  assert.equal(result.executedReadCount, 1);
  assert.deepEqual(result.completedStages, ["form_schema"]);
  assert.equal(result.writeExecuted, false);
});
