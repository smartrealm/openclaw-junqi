import assert from "node:assert/strict";
import test from "node:test";
import { DWS_STDIN_MAX_BYTES } from "./dws-runner.js";
import { DingTalkRuntimeError } from "./errors.js";
import {
  DINGTALK_WRITE_APPROVAL_TOOL_NAMES,
  dingTalkWriteApprovalDescription,
  validateDingTalkInvocationPolicy,
} from "./invocation-policy.js";
import { DINGTALK_TOOL_SPECS, DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec } from "./types.js";

function spec(name: string): DingTalkToolSpec {
  const value = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  if (!value) throw new Error(`缺少工具规格 ${name}`);
  return value;
}

const chatSend = spec("junqi_dingtalk_chat_send");
const minutesTranscript = spec("junqi_dingtalk_minutes_transcript");
const reportSubmit = spec("junqi_dingtalk_report_submit");

const approvalFixtures: Readonly<Record<string, Record<string, unknown>>> = {
  junqi_dingtalk_report_submit: {
    "template-id": "template-1",
    contents: "机密日志正文",
    "to-user-ids": "manager-1",
  },
  junqi_dingtalk_chat_send: {
    group: "cid-1",
    content: "第一行\n第二行",
    "idempotency-key": "send-1",
  },
  junqi_dingtalk_calendar_create: {
    title: "项目评审",
    start: "2026-09-10T10:00:00+08:00",
    end: "2026-09-10T11:00:00+08:00",
    attendees: ["user-1"],
  },
  junqi_dingtalk_calendar_update: {
    event: "event-1",
    title: "新标题",
    "add-attendees": ["user-2"],
  },
  junqi_dingtalk_calendar_cancel: { event: "event-1" },
  junqi_dingtalk_todo_create: { title: "提交报告", executors: ["user-1"] },
  junqi_dingtalk_todo_update: { "task-id": "task-1", priority: 20 },
  junqi_dingtalk_todo_complete: { "task-id": "task-1" },
  junqi_dingtalk_todo_reopen: { "task-id": "task-1" },
  junqi_dingtalk_approval_create: {
    "process-code": "PROC-1",
    "dept-id": "-1",
    "form-values": "{\"事由\":\"机密事项\"}",
  },
  junqi_dingtalk_approval_approve_by: { keyword: "报销-20260910", comment: "同意" },
  junqi_dingtalk_approval_reject: {
    "instance-id": "instance-1",
    "task-id": "task-1",
    remark: "资料不足",
  },
  junqi_dingtalk_approval_revoke: { "instance-id": "instance-1", remark: "发起有误" },
};

test("聊天发送只接受当前用户稳定目标、文本和幂等键", () => {
  assert.doesNotThrow(() => validateDingTalkInvocationPolicy(chatSend, {
    group: "cid-1",
    content: "项目已更新",
    title: "通知",
    "idempotency-key": "send-1",
    "ai-tag": true,
  }));
  assert.doesNotThrow(() => validateDingTalkInvocationPolicy(chatSend, {
    "open-dingtalk-id": "staff-1",
    content: "请查收",
    "idempotency-key": "send-2",
  }));
});

test("聊天发送拒绝自然语言目标、富媒体和缺少幂等键", () => {
  for (const argumentsValue of [
    { user: "张三", content: "你好", "idempotency-key": "send-1" },
    { group: "cid-1", content: "你好", file: "report.pdf", "idempotency-key": "send-1" },
    { group: "cid-1", content: "你好" },
    { group: "cid-1", "open-dingtalk-id": "staff-1", content: "你好", "idempotency-key": "send-1" },
  ]) {
    assert.throws(
      () => validateDingTalkInvocationPolicy(chatSend, argumentsValue),
      DingTalkRuntimeError,
    );
  }
});

test("日报提交只接受将内联正文转交标准输入的受控表面", () => {
  assert.doesNotThrow(() => validateDingTalkInvocationPolicy(reportSubmit, {
    "template-id": "template-1",
    contents: "[]",
    "to-user-ids": "manager-1",
    "to-chat": false,
  }));
  assert.throws(
    () => validateDingTalkInvocationPolicy(reportSubmit, {
      "template-id": "template-1",
      "contents-file": "/tmp/report.json",
      "to-user-ids": "manager-1",
    }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_ARGUMENT_UNKNOWN",
  );
  assert.throws(
    () => validateDingTalkInvocationPolicy(reportSubmit, {
      "template-id": "template-1",
      contents: "x".repeat(DWS_STDIN_MAX_BYTES + 1),
      "to-user-ids": "manager-1",
    }),
    (error) => error instanceof DingTalkRuntimeError && error.code === "DWS_INPUT_LIMIT",
  );
});

test("听记逐字稿只接受明确任务 ID 的完整分页读取", () => {
  assert.doesNotThrow(() => validateDingTalkInvocationPolicy(minutesTranscript, {
    id: "minutes-task-1",
  }));
  assert.doesNotThrow(() => validateDingTalkInvocationPolicy(minutesTranscript, {
    id: "minutes-task-1",
    direction: "1",
    "page-limit": 100,
  }));
});

test("听记逐字稿拒绝自动选最新、续页、关键词和单页模式", () => {
  for (const argumentsValue of [
    {},
    { id: " minutes-task-1 " },
    { id: "minutes-task-1", cursor: "next-page" },
    { id: "minutes-task-1", keyword: "周会" },
    { id: "minutes-task-1", "single-page": true },
  ]) {
    assert.throws(
      () => validateDingTalkInvocationPolicy(minutesTranscript, argumentsValue),
      DingTalkRuntimeError,
    );
  }
});

test("全部副作用工具都有明确且有界的审批摘要", () => {
  const sideEffectNames = DINGTALK_TOOL_SPECS
    .filter((candidate) => candidate.effect !== "read")
    .map((candidate) => candidate.name)
    .sort();
  assert.deepEqual([...DINGTALK_WRITE_APPROVAL_TOOL_NAMES].sort(), sideEffectNames);
  assert.deepEqual(Object.keys(approvalFixtures).sort(), sideEffectNames);

  for (const name of sideEffectNames) {
    const description = dingTalkWriteApprovalDescription(
      spec(name),
      "corp:user",
      approvalFixtures[name],
    );
    assert.match(description, /当前用户身份 "corp:user"/u);
    assert.match(description, /完整参数 SHA-256 [a-f0-9]{64}/u);
    assert.ok(description.length <= 512, `${name} 审批摘要超过 OpenClaw 上限`);
  }
});

test("审批摘要展示目标与改动并隐藏高敏正文", () => {
  const chatDescription = dingTalkWriteApprovalDescription(
    chatSend,
    "corp:user",
    approvalFixtures.junqi_dingtalk_chat_send,
  );
  assert.match(chatDescription, /群聊 ID "cid-1"/u);
  assert.match(chatDescription, /正文 "第一行\\n第二行"/u);
  assert.match(chatDescription, /幂等键 "send-1"/u);

  const reportDescription = dingTalkWriteApprovalDescription(
    reportSubmit,
    "corp:user",
    approvalFixtures.junqi_dingtalk_report_submit,
  );
  assert.match(reportDescription, /模板 ID "template-1"/u);
  assert.match(reportDescription, /接收人 userId "manager-1"/u);
  assert.match(reportDescription, /日志正文 已隐藏/u);
  assert.doesNotMatch(reportDescription, /机密日志正文/u);

  const approvalDescription = dingTalkWriteApprovalDescription(
    spec("junqi_dingtalk_approval_create"),
    "corp:user",
    approvalFixtures.junqi_dingtalk_approval_create,
  );
  assert.match(approvalDescription, /流程 processCode "PROC-1"/u);
  assert.match(approvalDescription, /表单值 已隐藏/u);
  assert.doesNotMatch(approvalDescription, /机密事项/u);
});

test("没有审批摘要策略的新副作用工具失败关闭", () => {
  const unknownWrite: DingTalkToolSpec = {
    ...chatSend,
    name: "junqi_dingtalk_future_write",
  };
  assert.throws(
    () => validateDingTalkInvocationPolicy(unknownWrite, {}),
    (error) => error instanceof DingTalkRuntimeError
      && error.code === "DWS_WRITE_APPROVAL_UNAVAILABLE",
  );
});
