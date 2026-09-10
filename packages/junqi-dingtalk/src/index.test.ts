import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDingTalkReadResult,
  hasDingTalkSideEffect,
  prepareDingTalkExecution,
  prepareDingTalkWriteApproval,
  shouldRegisterDingTalkEventService,
  shouldRegisterDingTalkTools,
} from "./index.js";
import { DWS_STDIN_MAX_BYTES } from "./dws-runner.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";

test("在 OpenClaw 工具发现模式注册钉钉工具", () => {
  assert.equal(shouldRegisterDingTalkTools("discovery"), true);
  assert.equal(shouldRegisterDingTalkTools("tool-discovery"), true);
  assert.equal(shouldRegisterDingTalkTools("full"), true);
});

test("不在非工具模式注册钉钉工具", () => {
  assert.equal(shouldRegisterDingTalkTools("setup-only"), false);
  assert.equal(shouldRegisterDingTalkTools("setup-runtime"), false);
  assert.equal(shouldRegisterDingTalkTools("cli-metadata"), false);
});

test("只在完整运行模式注册钉钉事件服务", () => {
  assert.equal(shouldRegisterDingTalkEventService("full"), true);
  assert.equal(shouldRegisterDingTalkEventService("discovery"), false);
  assert.equal(shouldRegisterDingTalkEventService("tool-discovery"), false);
  assert.equal(shouldRegisterDingTalkEventService("setup-only"), false);
});

test("写入和破坏性操作共用副作用未知结果围栏", () => {
  assert.equal(hasDingTalkSideEffect("read"), false);
  assert.equal(hasDingTalkSideEffect("write"), true);
  assert.equal(hasDingTalkSideEffect("destructive"), true);
});

test("真实只读工具只接受 DWS 统一成功信封", () => {
  const read = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_contact_me");
  const write = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_calendar_create");
  if (!read || !write) throw new Error("缺少钉钉读写工具规格");

  assert.doesNotThrow(() => assertDingTalkReadResult(read, {
    data: { ok: true, outcome: "success", data: {} },
  }));
  assert.throws(
    () => assertDingTalkReadResult(read, {
      data: { ok: true, outcome: "pending", data: {} },
    }),
    (error) => error instanceof Error
      && "code" in error
      && error.code === "DWS_RESULT_INVALID",
  );
  assert.throws(
    () => assertDingTalkReadResult(read, { data: { success: true } }),
    (error) => error instanceof Error
      && "code" in error
      && error.code === "DWS_RESULT_INVALID",
  );
  assert.doesNotThrow(() => assertDingTalkReadResult(write, {
    data: { ok: true, outcome: "pending", data: {} },
  }));
});

test("听记逐字稿要求同一任务和完整分页证据", () => {
  const transcript = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_minutes_transcript");
  if (!transcript) throw new Error("缺少听记逐字稿工具规格");
  const completeResult = {
    data: {
      ok: true,
      outcome: "success",
      data: {
        taskUuid: "minutes-task-1",
        direction: "0",
        complete: true,
        pages: 2,
        paragraphCount: 2,
        duplicateCount: 1,
        paragraphList: [{ id: "paragraph-1" }, { id: "paragraph-2" }],
      },
    },
  };

  assert.doesNotThrow(() => assertDingTalkReadResult(
    transcript,
    completeResult,
    { id: "minutes-task-1" },
  ));
  for (const [argumentsValue, data] of [
    [undefined, completeResult.data.data],
    [{ id: "minutes-task-2" }, completeResult.data.data],
    [{ id: "minutes-task-1" }, { ...completeResult.data.data, complete: false }],
    [{ id: "minutes-task-1" }, { ...completeResult.data.data, paragraphCount: 3 }],
    [{ id: "minutes-task-1" }, { ...completeResult.data.data, paragraphList: [null, {}] }],
  ] as const) {
    assert.throws(
      () => assertDingTalkReadResult(transcript, {
        data: { ok: true, outcome: "success", data },
      }, argumentsValue),
      (error) => error instanceof Error
        && "code" in error
        && error.code === "DWS_RESULT_INVALID",
    );
  }
});

test("日报正文通过标准输入交给 DWS 而不进入进程参数", () => {
  const report = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_report_submit");
  if (!report) throw new Error("缺少日报提交工具规格");
  const execution = prepareDingTalkExecution(report, {
    "template-id": "template-1",
    contents: "[{\"content\":\"周报正文\"}]",
    "to-user-ids": "manager-1",
  });
  assert.deepEqual(execution, {
    arguments: {
      "template-id": "template-1",
      contents: "-",
      "to-user-ids": "manager-1",
    },
    stdin: "[{\"content\":\"周报正文\"}]",
  });
});

test("合同分析只接受有界内联 JSON 并固定通过标准输入交给 DWS", () => {
  const analysis = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_contract_review_analysis");
  if (!analysis) throw new Error("缺少合同分析工具规格");
  const execution = prepareDingTalkExecution(analysis, {
    file: {
      source: "controlled",
      fileInfo: { fileId: "file-1" },
    },
  });
  assert.deepEqual(execution, {
    arguments: { file: "-" },
    stdin: "{\"fileInfo\":{\"fileId\":\"file-1\"},\"source\":\"controlled\"}",
  });
  assert.throws(
    () => prepareDingTalkExecution(analysis, { file: "/tmp/private.json" }),
    (error) => error instanceof Error
      && "code" in error
      && error.code === "DWS_ARGUMENT_TYPE",
  );
  assert.throws(
    () => prepareDingTalkExecution(analysis, { file: {}, extra: true }),
    (error) => error instanceof Error
      && "code" in error
      && error.code === "DWS_ARGUMENT_UNKNOWN",
  );
  assert.throws(
    () => prepareDingTalkExecution(analysis, {
      file: { source: "x".repeat(DWS_STDIN_MAX_BYTES) },
    }),
    (error) => error instanceof Error
      && "code" in error
      && error.code === "DWS_INPUT_LIMIT",
  );
});

test("写操作在请求 OpenClaw 审批前核验身份、DWS Schema 和参数", async () => {
  const cancel = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_calendar_cancel");
  if (!cancel) throw new Error("缺少取消日程工具规格");
  let verifyCount = 0;
  const schemas = {
    async verify() {
      verifyCount += 1;
      return {
        schema: {
          availability: "available" as const,
          canonical_path: cancel.canonicalPath,
          cli_path: cancel.cliPath,
          effect: cancel.effect,
          risk: cancel.risk,
          confirmation: cancel.confirmation,
          idempotency: cancel.idempotency,
          parameters: { event: { type: "string", required: true } },
        },
        digest: "a".repeat(64),
      };
    },
  };

  const approval = await prepareDingTalkWriteApproval(cancel, {
    profile: "corp:user",
    arguments: { event: "event-1" },
  }, schemas);
  assert.equal(approval.profile, "corp:user");
  assert.match(approval.description, /日程 eventId "event-1"/u);
  assert.equal(verifyCount, 1);

  await assert.rejects(
    prepareDingTalkWriteApproval(cancel, {
      profile: "corp:user",
      arguments: {},
    }, schemas),
    /arguments is missing required fields/u,
  );
  assert.equal(verifyCount, 2);
});
