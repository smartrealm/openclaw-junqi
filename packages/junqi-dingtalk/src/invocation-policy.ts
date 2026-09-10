import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { DWS_STDIN_MAX_BYTES } from "./dws-runner.js";
import { DingTalkRuntimeError } from "./errors.js";
import type { DingTalkToolSpec } from "./types.js";

interface ApprovalFieldSpec {
  readonly name: string;
  readonly label: string;
  readonly sensitive?: boolean;
}

interface WriteApprovalPolicy {
  readonly action: string;
  readonly fields: readonly ApprovalFieldSpec[];
}

const CHAT_SEND_TOOL_NAME = "junqi_dingtalk_chat_send";
const CONTRACT_REVIEW_ANALYSIS_TOOL_NAME = "junqi_dingtalk_contract_review_analysis";
const MINUTES_TRANSCRIPT_TOOL_NAME = "junqi_dingtalk_minutes_transcript";
const REPORT_SUBMIT_TOOL_NAME = "junqi_dingtalk_report_submit";
const APPROVAL_DESCRIPTION_MAX_LENGTH = 512;
const CHAT_SEND_ARGUMENTS = new Set([
  "group",
  "open-dingtalk-id",
  "content",
  "title",
  "idempotency-key",
  "ai-tag",
]);
const REPORT_SUBMIT_ARGUMENTS = new Set([
  "template-id",
  "contents",
  "to-user-ids",
  "to-chat",
  "dd-from",
]);
const MINUTES_TRANSCRIPT_ARGUMENTS = new Set([
  "id",
  "direction",
  "page-limit",
]);
const CONTRACT_REVIEW_ANALYSIS_ARGUMENTS = new Set(["file"]);

const WRITE_APPROVAL_POLICIES: Readonly<Record<string, WriteApprovalPolicy>> = {
  junqi_dingtalk_report_submit: {
    action: "提交日报或周报",
    fields: [
      { name: "template-id", label: "模板 ID" },
      { name: "to-user-ids", label: "接收人 userId" },
      { name: "to-chat", label: "发送单聊" },
      { name: "dd-from", label: "来源" },
      { name: "contents", label: "日志正文", sensitive: true },
    ],
  },
  junqi_dingtalk_chat_send: {
    action: "发送钉钉消息",
    fields: [
      { name: "group", label: "群聊 ID" },
      { name: "open-dingtalk-id", label: "成员 openDingTalkId" },
      { name: "title", label: "标题" },
      { name: "content", label: "正文" },
      { name: "ai-tag", label: "AI 角标" },
      { name: "idempotency-key", label: "幂等键" },
    ],
  },
  junqi_dingtalk_calendar_create: {
    action: "创建日程",
    fields: [
      { name: "calendar-id", label: "日历 ID" },
      { name: "title", label: "标题" },
      { name: "start", label: "开始" },
      { name: "end", label: "结束" },
      { name: "timezone", label: "时区" },
      { name: "location", label: "地点" },
      { name: "attendees", label: "参会人 userId" },
      { name: "rooms", label: "会议室 roomId" },
      { name: "free-busy", label: "忙闲" },
      { name: "desc", label: "描述", sensitive: true },
    ],
  },
  junqi_dingtalk_calendar_update: {
    action: "更新日程",
    fields: [
      { name: "event", label: "日程 eventId" },
      { name: "calendar-id", label: "日历 ID" },
      { name: "title", label: "新标题" },
      { name: "start", label: "新开始" },
      { name: "end", label: "新结束" },
      { name: "timezone", label: "新时区" },
      { name: "location", label: "新地点" },
      { name: "add-attendees", label: "新增参会人" },
      { name: "remove-attendees", label: "移除参会人" },
      { name: "free-busy", label: "新忙闲" },
      { name: "desc", label: "新描述", sensitive: true },
    ],
  },
  junqi_dingtalk_calendar_cancel: {
    action: "取消并删除日程",
    fields: [{ name: "event", label: "日程 eventId" }],
  },
  junqi_dingtalk_todo_create: {
    action: "创建待办",
    fields: [
      { name: "title", label: "标题" },
      { name: "executors", label: "执行人 userId" },
      { name: "due", label: "截止时间" },
      { name: "priority", label: "优先级" },
    ],
  },
  junqi_dingtalk_todo_update: {
    action: "更新待办",
    fields: [
      { name: "task-id", label: "待办 taskId" },
      { name: "title", label: "新标题" },
      { name: "due", label: "新截止时间" },
      { name: "priority", label: "新优先级" },
    ],
  },
  junqi_dingtalk_todo_complete: {
    action: "完成待办",
    fields: [{ name: "task-id", label: "待办 taskId" }],
  },
  junqi_dingtalk_todo_reopen: {
    action: "重新打开待办",
    fields: [{ name: "task-id", label: "待办 taskId" }],
  },
  junqi_dingtalk_approval_create: {
    action: "发起审批",
    fields: [
      { name: "process-code", label: "流程 processCode" },
      { name: "dept-id", label: "部门 ID" },
      { name: "originator-user-id", label: "发起人 userId" },
      { name: "approvers", label: "审批人 userId" },
      { name: "approvers-action-type", label: "审批方式" },
      { name: "cc-list", label: "抄送人 userId" },
      { name: "cc-position", label: "抄送时点" },
      { name: "form-values", label: "表单值", sensitive: true },
      { name: "request", label: "完整请求", sensitive: true },
    ],
  },
  junqi_dingtalk_approval_approve_by: {
    action: "同意唯一匹配的待审批任务",
    fields: [
      { name: "keyword", label: "唯一匹配关键词" },
      { name: "comment", label: "审批意见" },
    ],
  },
  junqi_dingtalk_approval_reject: {
    action: "拒绝审批任务",
    fields: [
      { name: "instance-id", label: "审批实例 ID" },
      { name: "task-id", label: "审批任务 ID" },
      { name: "remark", label: "拒绝意见" },
    ],
  },
  junqi_dingtalk_approval_revoke: {
    action: "撤销审批实例",
    fields: [
      { name: "instance-id", label: "审批实例 ID" },
      { name: "remark", label: "撤销说明" },
    ],
  },
};

export const DINGTALK_WRITE_APPROVAL_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(WRITE_APPROVAL_POLICIES),
);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredText(
  argumentsValue: Record<string, unknown>,
  name: string,
): string {
  const value = argumentsValue[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DingTalkRuntimeError(
      "DWS_ARGUMENT_REQUIRED",
      `arguments is missing required field ${name}`,
      { fields: [name] },
    );
  }
  return value;
}

function validateAllowedArguments(
  argumentsValue: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  message: string,
): void {
  const forbidden = Object.keys(argumentsValue).filter((key) => !allowed.has(key));
  if (forbidden.length > 0) {
    throw new DingTalkRuntimeError(
      "DWS_ARGUMENT_UNKNOWN",
      message,
      { fields: forbidden.sort() },
    );
  }
}

function validateChatSend(argumentsValue: Record<string, unknown>): void {
  validateAllowedArguments(
    argumentsValue,
    CHAT_SEND_ARGUMENTS,
    "chat send accepts only the reviewed current-user text surface",
  );
  const group = typeof argumentsValue.group === "string" && argumentsValue.group.trim() !== "";
  const direct = typeof argumentsValue["open-dingtalk-id"] === "string"
    && argumentsValue["open-dingtalk-id"].trim() !== "";
  if (group === direct) {
    throw new DingTalkRuntimeError(
      "DWS_ARGUMENT_REQUIRED",
      "chat send requires exactly one stable target",
      { fields: ["group", "open-dingtalk-id"] },
    );
  }
  requiredText(argumentsValue, "content");
  requiredText(argumentsValue, "idempotency-key");
  if (argumentsValue.title !== undefined && typeof argumentsValue.title !== "string") {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", "title must be a string", { fields: ["title"] });
  }
  if (argumentsValue["ai-tag"] !== undefined && typeof argumentsValue["ai-tag"] !== "boolean") {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_TYPE", "ai-tag must be a boolean", { fields: ["ai-tag"] });
  }
}

function validateReportSubmit(argumentsValue: Record<string, unknown>): void {
  validateAllowedArguments(
    argumentsValue,
    REPORT_SUBMIT_ARGUMENTS,
    "report submit accepts only inline contents for reviewed standard-input delivery",
  );
  requiredText(argumentsValue, "template-id");
  const contents = requiredText(argumentsValue, "contents");
  requiredText(argumentsValue, "to-user-ids");
  if (Buffer.byteLength(contents, "utf8") > DWS_STDIN_MAX_BYTES) {
    throw new DingTalkRuntimeError(
      "DWS_INPUT_LIMIT",
      "report contents exceeded the reviewed standard-input limit",
      { fields: ["contents"] },
    );
  }
}

function validateMinutesTranscript(argumentsValue: Record<string, unknown>): void {
  validateAllowedArguments(
    argumentsValue,
    MINUTES_TRANSCRIPT_ARGUMENTS,
    "minutes transcript requires one explicit task ID and complete pagination",
  );
  const id = requiredText(argumentsValue, "id");
  if (id !== id.trim()) {
    throw new DingTalkRuntimeError(
      "DWS_ARGUMENT_INVALID",
      "minutes transcript task ID must not contain surrounding whitespace",
      { fields: ["id"] },
    );
  }
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (!value || typeof value !== "object") {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_INVALID", "DWS arguments must be JSON values");
  }
  if (ancestors.has(value)) {
    throw new DingTalkRuntimeError("DWS_ARGUMENT_INVALID", "DWS arguments must not contain cycles");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, ancestors)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, ancestors)}`);
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function serializeDingTalkContractAnalysisInput(argumentsValue: unknown): string {
  const argumentsRecord = record(argumentsValue);
  if (!argumentsRecord) {
    throw new DingTalkRuntimeError("DWS_ARGUMENTS_REQUIRED", "arguments must be a JSON object");
  }
  validateAllowedArguments(
    argumentsRecord,
    CONTRACT_REVIEW_ANALYSIS_ARGUMENTS,
    "contract analysis accepts only an inline file request",
  );
  const request = record(argumentsRecord.file);
  if (!request || Object.keys(request).length === 0) {
    throw new DingTalkRuntimeError(
      "DWS_ARGUMENT_TYPE",
      "contract analysis file must be a non-empty inline JSON object",
      { fields: ["file"] },
    );
  }
  const serialized = canonicalJson(request);
  if (Buffer.byteLength(serialized, "utf8") > DWS_STDIN_MAX_BYTES) {
    throw new DingTalkRuntimeError(
      "DWS_INPUT_LIMIT",
      "contract analysis request exceeded the reviewed standard-input limit",
      { fields: ["file"] },
    );
  }
  return serialized;
}

function renderedValue(value: unknown, sensitive = false): string {
  const serialized = canonicalJson(value);
  if (sensitive) {
    return `已隐藏（${Array.from(serialized).length} 字符）`;
  }
  const characters = Array.from(serialized);
  if (characters.length <= 24) return serialized;
  return `${characters.slice(0, 14).join("")}...（${characters.length} 字符）`;
}

function approvalPolicy(spec: DingTalkToolSpec): WriteApprovalPolicy {
  const policy = WRITE_APPROVAL_POLICIES[spec.name];
  if (policy) return policy;
  throw new DingTalkRuntimeError(
    "DWS_WRITE_APPROVAL_UNAVAILABLE",
    "DWS write approval summary is unavailable for this tool",
    { fields: [spec.name] },
  );
}

export function validateDingTalkInvocationPolicy(
  spec: DingTalkToolSpec,
  argumentsValue: unknown,
): void {
  if (spec.name === CONTRACT_REVIEW_ANALYSIS_TOOL_NAME) {
    serializeDingTalkContractAnalysisInput(argumentsValue);
    return;
  }
  if (spec.name === MINUTES_TRANSCRIPT_TOOL_NAME) {
    const argumentsRecord = record(argumentsValue);
    if (!argumentsRecord) {
      throw new DingTalkRuntimeError("DWS_ARGUMENTS_REQUIRED", "arguments must be a JSON object");
    }
    validateMinutesTranscript(argumentsRecord);
    return;
  }
  if (spec.effect === "read") return;
  approvalPolicy(spec);
  const argumentsRecord = record(argumentsValue);
  if (!argumentsRecord) {
    throw new DingTalkRuntimeError("DWS_ARGUMENTS_REQUIRED", "arguments must be a JSON object");
  }
  if (spec.name === CHAT_SEND_TOOL_NAME) validateChatSend(argumentsRecord);
  if (spec.name === REPORT_SUBMIT_TOOL_NAME) validateReportSubmit(argumentsRecord);
}

export function dingTalkWriteApprovalDescription(
  spec: DingTalkToolSpec,
  profile: string,
  argumentsValue: unknown,
): string {
  validateDingTalkInvocationPolicy(spec, argumentsValue);
  const argumentsRecord = record(argumentsValue) as Record<string, unknown>;
  const policy = approvalPolicy(spec);
  const digest = createHash("sha256").update(canonicalJson(argumentsRecord)).digest("hex");
  const facts = policy.fields.flatMap((field) => (
    Object.hasOwn(argumentsRecord, field.name)
      ? [`${field.label} ${renderedValue(argumentsRecord[field.name], field.sensitive)}`]
      : []
  ));
  const description = `即将以当前用户身份 ${renderedValue(profile)}${policy.action}；${facts.join("，")}。完整参数 SHA-256 ${digest}。`;
  if (description.length <= APPROVAL_DESCRIPTION_MAX_LENGTH) return description;
  return `即将以当前用户身份 ${renderedValue(profile)}${policy.action}；参数预览超出审批界面限制，请先核对原始工具调用。完整参数 SHA-256 ${digest}。`;
}
