import assert from "node:assert/strict";
import test from "node:test";
import { DingTalkRuntimeError } from "./errors.js";
import {
  assertDingTalkWriteReconciliationAvailable,
  DINGTALK_RECONCILED_WRITE_TOOL_NAMES,
  reconcileDingTalkWrite,
} from "./write-reconciliation.js";
import { DINGTALK_TOOL_SPECS, DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsCommandResult, DwsLeafSchema } from "./types.js";

function spec(name: string): DingTalkToolSpec {
  const found = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  if (!found) throw new Error(`缺少测试工具 ${name}`);
  return found;
}

const approvalDetailSchema: DwsLeafSchema = {
  canonical_path: "oa.get_processInstance_detail",
  cli_path: "oa approval detail",
  effect: "read",
  risk: "low",
  confirmation: "not_required",
  idempotency: "idempotent",
  parameters: { "instance-id": { type: "string", required: true } },
};

const reportDetailSchema: DwsLeafSchema = {
  canonical_path: "report.get_report_entry_details",
  cli_path: "report entry get",
  effect: "read",
  risk: "low",
  confirmation: "not_required",
  idempotency: "idempotent",
  parameters: { "report-id": { type: "string", required: true } },
};

const chatSendStatusSchema: DwsLeafSchema = {
  canonical_path: "chat.query_message_send_status",
  cli_path: "chat message query-send-status",
  effect: "read",
  risk: "low",
  confirmation: "not_required",
  idempotency: "idempotent",
  parameters: { "open-task-id": { type: "string", required: true } },
};

const chatMessagesByIdsSchema: DwsLeafSchema = {
  canonical_path: "chat.shortcut_messages_mget",
  cli_path: "chat +messages-mget",
  effect: "read",
  risk: "low",
  confirmation: "not_required",
  idempotency: "idempotent",
  parameters: {
    "msg-ids": { type: "array", required: true },
    "no-reactions": { type: "boolean" },
    "no-threads": { type: "boolean" },
  },
};

function dwsSuccess(data: unknown): DwsCommandResult {
  return { data: { ok: true, outcome: "success", data } };
}

function dependencies(readback: DwsCommandResult | Error = dwsSuccess({ success: true })) {
  const calls: string[][] = [];
  return {
    calls,
    dependencies: {
      writeSchemaDigest: "b".repeat(64),
      schemas: {
        async verify(readSpec: DingTalkToolSpec) {
          if (readSpec.name === "junqi_dingtalk_approval_detail") {
            return { schema: approvalDetailSchema, digest: "a".repeat(64) };
          }
          if (readSpec.name === "junqi_dingtalk_report_detail") {
            return { schema: reportDetailSchema, digest: "c".repeat(64) };
          }
          throw new Error("读取了非预期核验工具");
        },
      },
      runner: {
        async run(command: readonly string[]) {
          calls.push([...command]);
          if (readback instanceof Error) throw readback;
          return readback;
        },
      },
      now: () => "2026-09-09T00:00:00.000Z",
    },
  };
}

test("所有注册写工具都必须先有明确核验策略", () => {
  const sideEffectToolNames = DINGTALK_TOOL_SPECS
    .filter((item) => item.effect !== "read")
    .map((item) => item.name)
    .sort();
  assert.equal(sideEffectToolNames.length, 13);
  assert.deepEqual(
    [...DINGTALK_RECONCILED_WRITE_TOOL_NAMES].sort(),
    sideEffectToolNames,
  );
  for (const item of DINGTALK_TOOL_SPECS) {
    assert.doesNotThrow(() => assertDingTalkWriteReconciliationAvailable(item));
  }
});

test("缺少核验策略的写工具在调用 DWS 前失败关闭", () => {
  const unsupported = {
    ...spec("junqi_dingtalk_calendar_create"),
    name: "junqi_dingtalk_unreviewed_write",
  };
  assert.throws(
    () => assertDingTalkWriteReconciliationAvailable(unsupported),
    (error) => (
      error instanceof DingTalkRuntimeError
      && error.code === "DWS_WRITE_RECONCILIATION_UNAVAILABLE"
      && error.details?.fields?.[0] === unsupported.name
    ),
  );
});

test("采用 DWS Shortcut 内置的写后读回证明", async () => {
  const fixture = dependencies();
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_calendar_create"),
    profile: "corp:user",
    arguments: { title: "评审会" },
    writeResult: dwsSuccess({ success: true, eventId: "event-1", verified: true }),
    ...fixture.dependencies,
  });
  assert.equal(result.status, "verified");
  assert.equal(result.resourceId, "event-1");
  assert.equal(result.verifierCanonicalPath, "calendar.shortcut_create");
  assert.equal(result.verifierSchemaDigest, "b".repeat(64));
  assert.equal(fixture.calls.length, 0);
});

test("取消日程只接受 DWS 缺席读回核验", async () => {
  const fixture = dependencies();
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_calendar_cancel"),
    profile: "corp:user",
    arguments: { event: "event-1" },
    writeResult: dwsSuccess({ success: true, eventId: "event-1", deleted: true, verified: true }),
    ...fixture.dependencies,
  });
  assert.equal(result.status, "verified");
  assert.equal(result.resourceId, "event-1");
  assert.equal(result.verifierCanonicalPath, "calendar.shortcut_cancel_event");
  assert.equal(fixture.calls.length, 0);
});

test("更新和取消日程拒绝返回其他资源 ID 的核验回执", async () => {
  for (const toolName of [
    "junqi_dingtalk_calendar_update",
    "junqi_dingtalk_calendar_cancel",
  ]) {
    const fixture = dependencies();
    const result = await reconcileDingTalkWrite({
      spec: spec(toolName),
      profile: "corp:user",
      arguments: { event: "event-expected" },
      writeResult: dwsSuccess({ eventId: "event-other", verified: true }),
      ...fixture.dependencies,
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.resourceId, "event-other");
    assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
    assert.equal(fixture.calls.length, 0);
  }
});

test("待办状态写入拒绝返回其他任务 ID 的核验回执", async () => {
  for (const toolName of [
    "junqi_dingtalk_todo_update",
    "junqi_dingtalk_todo_complete",
    "junqi_dingtalk_todo_reopen",
  ]) {
    const fixture = dependencies();
    const result = await reconcileDingTalkWrite({
      spec: spec(toolName),
      profile: "corp:user",
      arguments: { "task-id": "task-expected" },
      writeResult: dwsSuccess({ taskId: "task-other", verified: true }),
      ...fixture.dependencies,
    });
    assert.equal(result.status, "unknown");
    assert.equal(result.resourceId, "task-other");
    assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
    assert.equal(fixture.calls.length, 0);
  }
});

test("Shortcut 未返回明确 verified 时保持未知", async () => {
  const fixture = dependencies();
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_todo_complete"),
    profile: "corp:user",
    arguments: { "task-id": "task-1" },
    writeResult: dwsSuccess({ taskId: "task-1" }),
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISSING");
  assert.equal(fixture.calls.length, 0);
});

test("Shortcut 缺少稳定资源 ID 时保持未知", async () => {
  const fixture = dependencies();
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_approve_by"),
    profile: "corp:user",
    arguments: { keyword: "报销" },
    writeResult: dwsSuccess({ verified: true }),
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_RESOURCE_ID_MISSING");
});

test("发起审批后使用回执实例 ID 读回核验", async () => {
  const fixture = dependencies({ data: {
    success: true,
    result: { processInstanceId: "approval-1" },
  } });
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_create"),
    profile: "corp:user",
    arguments: {},
    writeResult: { data: { success: "true", result: "approval-1" } },
    ...fixture.dependencies,
  });
  assert.equal(result.status, "verified");
  assert.equal(result.resourceId, "approval-1");
  assert.deepEqual(fixture.calls, [["oa", "approval", "detail", "--instance-id", "approval-1"]]);
});

test("提交日志后使用回执 reportId 读回核验", async () => {
  const fixture = dependencies(dwsSuccess({
    success: true,
    result: { report_Id: "report-1", report_content: [] },
  }));
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_report_submit"),
    profile: "corp:user",
    arguments: {
      "template-id": "template-1",
      contents: "[]",
      "to-user-ids": "user-1",
    },
    writeResult: dwsSuccess({ success: true, result: "report-1" }),
    ...fixture.dependencies,
  });
  assert.equal(result.status, "succeeded_unverified");
  assert.equal(result.reasonCode, "DWS_WRITE_POSTCONDITION_NOT_DECLARED");
  assert.equal(result.resourceId, "report-1");
  assert.equal(result.verifierCanonicalPath, "report.get_report_entry_details");
  assert.equal(result.verifierSchemaDigest, "c".repeat(64));
  assert.deepEqual(fixture.calls, [["report", "entry", "get", "--report-id", "report-1"]]);
});

test("聊天发送通过异步状态取得消息 ID 后精确读回", async () => {
  const calls: string[][] = [];
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { group: "cid-1", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: { data: { ok: true, outcome: "pending", data: { openTaskId: "task-1" } } },
    writeSchemaDigest: "b".repeat(64),
    schemas: {
      async verify(readSpec) {
        if (readSpec.name === "junqi_dingtalk_chat_send_status") {
          return { schema: chatSendStatusSchema, digest: "d".repeat(64) };
        }
        if (readSpec.name === "junqi_dingtalk_chat_messages_by_ids") {
          return { schema: chatMessagesByIdsSchema, digest: "e".repeat(64) };
        }
        throw new Error("读取了非预期核验工具");
      },
    },
    runner: {
      async run(command) {
        calls.push([...command]);
        if (command.includes("query-send-status")) {
          return dwsSuccess({
            readyForMessageActions: true,
            messageRef: { openMessageId: "msg-1", openConversationId: "cid-1" },
          });
        }
        return dwsSuccess({
          requestedCount: 1,
          foundCount: 1,
          notFoundCount: 0,
          notFoundMessageIds: [],
          messages: [{ messageId: "msg-1", conversationId: "cid-1", text: "项目已更新" }],
          complete: true,
          messagesComplete: true,
          failedCount: 0,
          failures: [],
        });
      },
    },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "succeeded_unverified");
  assert.equal(result.resourceId, "msg-1");
  assert.equal(result.verifierCanonicalPath, "chat.shortcut_messages_mget");
  assert.equal(result.verifierSchemaDigest, "e".repeat(64));
  assert.deepEqual(calls, [
    ["chat", "message", "query-send-status", "--open-task-id", "task-1"],
    [
      "chat",
      "+messages-mget",
      "--msg-ids",
      "msg-1",
      "--no-reactions",
      "--no-threads",
    ],
  ]);
});

test("聊天发送仍处于异步处理中时保持未知且不重放", async () => {
  const calls: string[][] = [];
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { group: "cid-1", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: { data: { ok: true, outcome: "pending", data: { openTaskId: "task-1" } } },
    writeSchemaDigest: "b".repeat(64),
    schemas: {
      async verify(readSpec) {
        assert.equal(readSpec.name, "junqi_dingtalk_chat_send_status");
        return { schema: chatSendStatusSchema, digest: "d".repeat(64) };
      },
    },
    runner: {
      async run(command) {
        calls.push([...command]);
        return dwsSuccess({ readyForMessageActions: false, openTaskId: "task-1" });
      },
    },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_ASYNC_PENDING");
  assert.deepEqual(calls, [
    ["chat", "message", "query-send-status", "--open-task-id", "task-1"],
  ]);
});

test("聊天发送精确读回缺少目标消息时保持未知", async () => {
  const calls: string[][] = [];
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { group: "cid-1", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: {
      data: {
        ok: true,
        outcome: "success",
        data: { openMessageId: "msg-1", openConversationId: "cid-1" },
      },
    },
    writeSchemaDigest: "b".repeat(64),
    schemas: {
      async verify(readSpec) {
        assert.equal(readSpec.name, "junqi_dingtalk_chat_messages_by_ids");
        return { schema: chatMessagesByIdsSchema, digest: "e".repeat(64) };
      },
    },
    runner: {
      async run(command) {
        calls.push([...command]);
        return dwsSuccess({
          requestedCount: 1,
          foundCount: 0,
          notFoundCount: 1,
          notFoundMessageIds: ["msg-1"],
          messages: [],
          complete: false,
          messagesComplete: false,
          failedCount: 1,
          failures: [{ messageId: "msg-1", reason: "not_returned" }],
        });
      },
    },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
  assert.deepEqual(calls, [[
    "chat",
    "+messages-mget",
    "--msg-ids",
    "msg-1",
    "--no-reactions",
    "--no-threads",
  ]]);
});

test("聊天读回不能用请求回显中的消息 ID 冒充完整结果", async () => {
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { group: "cid-1", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: {
      data: {
        ok: true,
        outcome: "success",
        data: { openMessageId: "msg-1", openConversationId: "cid-1" },
      },
    },
    writeSchemaDigest: "b".repeat(64),
    schemas: {
      async verify() {
        return { schema: chatMessagesByIdsSchema, digest: "e".repeat(64) };
      },
    },
    runner: {
      async run() {
        return dwsSuccess({
          requestedMessageIds: ["msg-1"],
          messages: [],
        });
      },
    },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
});

test("群消息严格读回的会话不一致时保持未知", async () => {
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { group: "cid-1", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: {
      data: {
        ok: true,
        outcome: "success",
        data: { openMessageId: "msg-1", openConversationId: "cid-1" },
      },
    },
    writeSchemaDigest: "b".repeat(64),
    schemas: {
      async verify() {
        return { schema: chatMessagesByIdsSchema, digest: "e".repeat(64) };
      },
    },
    runner: {
      async run() {
        return dwsSuccess({
          requestedCount: 1,
          foundCount: 1,
          notFoundCount: 0,
          notFoundMessageIds: [],
          messages: [{ messageId: "msg-1", conversationId: "cid-other" }],
          complete: true,
          messagesComplete: true,
          failedCount: 0,
          failures: [],
        });
      },
    },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
});

test("消息集合完整时不把正文解密状态误当成消息缺失", async () => {
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { "open-dingtalk-id": "user-open-id", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: {
      data: {
        ok: true,
        outcome: "success",
        data: { openMessageId: "msg-1", openConversationId: "cid-1" },
      },
    },
    writeSchemaDigest: "b".repeat(64),
    schemas: {
      async verify() {
        return { schema: chatMessagesByIdsSchema, digest: "e".repeat(64) };
      },
    },
    runner: {
      async run() {
        return dwsSuccess({
          requestedCount: 1,
          foundCount: 1,
          notFoundCount: 0,
          notFoundMessageIds: [],
          messages: [{ messageId: "msg-1", conversationId: "cid-1" }],
          complete: false,
          messagesComplete: true,
          failedCount: 0,
          failures: [],
          decryptFailedCount: 1,
        });
      },
    },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "succeeded_unverified");
  assert.equal(result.reasonCode, "DWS_WRITE_POSTCONDITION_NOT_DECLARED");
});

test("群消息回执会话与已核对目标不一致时不执行后续读取", async () => {
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_chat_send"),
    profile: "corp:user",
    arguments: { group: "cid-expected", content: "项目已更新", "idempotency-key": "send-1" },
    writeResult: {
      data: {
        ok: true,
        outcome: "success",
        data: { openMessageId: "msg-1", openConversationId: "cid-other" },
      },
    },
    writeSchemaDigest: "b".repeat(64),
    schemas: { async verify() { throw new Error("不应读取 Schema"); } },
    runner: { async run() { throw new Error("不应执行读取"); } },
    now: () => "2026-09-09T00:00:00.000Z",
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
  assert.equal(result.resourceId, "msg-1");
});

test("日志读回 reportId 不一致时保持未知", async () => {
  const fixture = dependencies(dwsSuccess({
    success: true,
    result: { report_Id: "report-2" },
  }));
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_report_submit"),
    profile: "corp:user",
    arguments: {},
    writeResult: dwsSuccess({ success: true, result: { reportId: "report-1" } }),
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
});

test("审批拒绝只证明实例仍可读，不猜测业务终态", async () => {
  const fixture = dependencies({ data: {
    success: true,
    result: { processInstanceId: "approval-1" },
  } });
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_reject"),
    profile: "corp:user",
    arguments: { "instance-id": "approval-1", "task-id": "12" },
    writeResult: { data: { success: true } },
    ...fixture.dependencies,
  });
  assert.equal(result.status, "succeeded_unverified");
  assert.equal(result.reasonCode, "DWS_WRITE_POSTCONDITION_NOT_DECLARED");
});

test("审批写后读回失败进入未知且不重放写命令", async () => {
  const fixture = dependencies(new Error("读取失败"));
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_revoke"),
    profile: "corp:user",
    arguments: { "instance-id": "approval-1" },
    writeResult: { data: { success: true } },
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_READBACK_FAILED");
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0]?.[0], "oa");
});

test("DWS 顶层信封不是明确成功时不执行读取", async () => {
  const fixture = dependencies();
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_create"),
    profile: "corp:user",
    arguments: {},
    writeResult: { data: { ok: false, outcome: "failure", error: {} } },
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_OUTCOME_INVALID");
  assert.equal(fixture.calls.length, 0);
});

test("审批写响应没有明确业务成功回执时不执行读取", async () => {
  const fixture = dependencies();
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_create"),
    profile: "corp:user",
    arguments: {},
    writeResult: { data: { result: "approval-1" } },
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_RECEIPT_INVALID");
  assert.equal(fixture.calls.length, 0);
});

test("审批详情读回的实例 ID 不一致时保持未知", async () => {
  const fixture = dependencies({ data: {
    success: true,
    result: { processInstanceId: "approval-2" },
  } });
  const result = await reconcileDingTalkWrite({
    spec: spec("junqi_dingtalk_approval_create"),
    profile: "corp:user",
    arguments: {},
    writeResult: { data: { success: true, result: "approval-1" } },
    ...fixture.dependencies,
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.reasonCode, "DWS_WRITE_VERIFICATION_MISMATCH");
});
