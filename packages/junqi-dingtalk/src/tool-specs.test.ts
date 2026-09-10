import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  CONTRACT_AUDIT_TOOL_NAME,
  DINGTALK_TOOL_SPECS,
  EVENT_SNAPSHOT_TOOL_NAME,
  RUNTIME_STATUS_TOOL_NAME,
  TOOL_SCHEMA_TOOL_NAME,
} from "./tool-specs.js";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("插件清单工具与运行时注册规格完全一致", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "openclaw.plugin.json"), "utf8"),
  ) as { contracts?: { tools?: unknown } };
  const expectedToolNames = [
    RUNTIME_STATUS_TOOL_NAME,
    TOOL_SCHEMA_TOOL_NAME,
    CONTRACT_AUDIT_TOOL_NAME,
    EVENT_SNAPSHOT_TOOL_NAME,
    ...DINGTALK_TOOL_SPECS.map((spec) => spec.name),
  ];

  assert.deepEqual(manifest.contracts?.tools, expectedToolNames);
});

test("上游可用的高敏业务域当前只开放只读工具", () => {
  const protectedDomains = new Set(["aitable", "contract", "recruit", "goal"]);
  const protectedTools = DINGTALK_TOOL_SPECS.filter((spec) => protectedDomains.has(spec.domain));
  assert.ok(protectedTools.length > 0);
  assert.equal(protectedTools.every((spec) => (
    spec.effect === "read"
    && spec.risk === "low"
    && spec.confirmation === "not_required"
    && spec.idempotency === "idempotent"
  )), true);
  assert.equal(DINGTALK_TOOL_SPECS.some((spec) => spec.domain === "hr"), false);
});

test("所有钉钉业务工具名称和 canonical path 唯一", () => {
  assert.equal(new Set(DINGTALK_TOOL_SPECS.map((spec) => spec.name)).size, DINGTALK_TOOL_SPECS.length);
  assert.equal(
    new Set(DINGTALK_TOOL_SPECS.map((spec) => spec.canonicalPath)).size,
    DINGTALK_TOOL_SPECS.length,
  );
});

test("指定会议听记可以通过正式搜索 Shortcut 唯一定位", () => {
  const spec = DINGTALK_TOOL_SPECS.find((candidate) => (
    candidate.name === "junqi_dingtalk_minutes_search"
  ));

  assert.deepEqual(spec, {
    name: "junqi_dingtalk_minutes_search",
    label: "搜索听记",
    description: "按标题或时间范围完整搜索可访问的 AI 听记",
    domain: "minutes",
    canonicalPath: "minutes.shortcut_search",
    cliPath: "minutes +search",
    effect: "read",
    risk: "low",
    confirmation: "not_required",
    idempotency: "idempotent",
  });
});

test("听记逐字稿使用正式完整分页 Shortcut", () => {
  const spec = DINGTALK_TOOL_SPECS.find((candidate) => (
    candidate.name === "junqi_dingtalk_minutes_transcript"
  ));

  assert.deepEqual(spec, {
    name: "junqi_dingtalk_minutes_transcript",
    label: "听记逐字稿",
    description: "按稳定 taskUuid 完整读取逐字稿并验证分页完整性",
    domain: "minutes",
    canonicalPath: "minutes.shortcut_transcript",
    cliPath: "minutes +transcript",
    effect: "read",
    risk: "low",
    confirmation: "not_required",
    idempotency: "idempotent",
  });
});

test("每日工作助理具备正式逾期未完成待办读取", () => {
  const spec = DINGTALK_TOOL_SPECS.find((candidate) => (
    candidate.name === "junqi_dingtalk_todo_overdue"
  ));

  assert.deepEqual(spec, {
    name: "junqi_dingtalk_todo_overdue",
    label: "逾期待办",
    description: "完整翻页并筛选当前用户逾期未完成的待办",
    domain: "todo",
    canonicalPath: "todo.shortcut_overdue",
    cliPath: "todo +overdue",
    effect: "read",
    risk: "low",
    confirmation: "not_required",
    idempotency: "idempotent",
  });
});

test("会议闭环使用正式缺席读回取消日程", () => {
  const spec = DINGTALK_TOOL_SPECS.find((candidate) => (
    candidate.name === "junqi_dingtalk_calendar_cancel"
  ));

  assert.deepEqual(spec, {
    name: "junqi_dingtalk_calendar_cancel",
    label: "取消日程",
    description: "确认日程存在后删除并由 DWS 验证其已不存在",
    domain: "calendar",
    canonicalPath: "calendar.shortcut_cancel_event",
    cliPath: "calendar +cancel-event",
    effect: "destructive",
    risk: "high",
    confirmation: "user_required",
    idempotency: "unknown",
  });
});

test("日报周报提交具备模板读取和按 ID 读回工具", () => {
  const expected = new Map([
    ["junqi_dingtalk_report_template_search", "report.shortcut_template_search"],
    ["junqi_dingtalk_report_template", "report.get_template_details_by_name"],
    ["junqi_dingtalk_report_detail", "report.get_report_entry_details"],
    ["junqi_dingtalk_report_submit", "report.create_report"],
  ]);

  for (const [name, canonicalPath] of expected) {
    const found = DINGTALK_TOOL_SPECS.find((candidate) => candidate.name === name);
    assert.equal(found?.canonicalPath, canonicalPath);
  }
});

test("聊天发送只开放当前用户发送、状态查询和按 ID 精确读取", () => {
  const expected = new Map([
    ["junqi_dingtalk_chat_send", "chat.send_personal_message"],
    ["junqi_dingtalk_chat_send_status", "chat.query_message_send_status"],
    ["junqi_dingtalk_chat_messages_by_ids", "chat.shortcut_messages_mget"],
  ]);
  for (const [name, canonicalPath] of expected) {
    assert.equal(
      DINGTALK_TOOL_SPECS.find((candidate) => candidate.name === name)?.canonicalPath,
      canonicalPath,
    );
  }
  assert.equal(DINGTALK_TOOL_SPECS.some((candidate) => (
    candidate.canonicalPath === "chat.shortcut_messages_send"
    || candidate.cliPath.includes("send-by-bot")
    || candidate.cliPath.includes("webhook")
  )), false);
  assert.deepEqual(
    DINGTALK_TOOL_SPECS.filter((candidate) => (
      candidate.domain === "chat" && candidate.effect === "write"
    )).map((candidate) => candidate.name),
    ["junqi_dingtalk_chat_send"],
  );
});

test("邮件域在官方草稿清理终态不可证明时保持只读", () => {
  const mailTools = DINGTALK_TOOL_SPECS.filter((candidate) => candidate.domain === "mail");
  assert.ok(mailTools.length > 0);
  assert.equal(mailTools.every((candidate) => (
    candidate.effect === "read"
    && candidate.risk === "low"
    && candidate.confirmation === "not_required"
    && candidate.idempotency === "idempotent"
  )), true);
});
