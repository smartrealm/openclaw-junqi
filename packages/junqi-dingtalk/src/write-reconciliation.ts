import { buildSchemaValidatedArguments } from "./schema-contract.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import { DingTalkRuntimeError } from "./errors.js";
import type {
  DingTalkToolSpec,
  DingTalkWriteVerification,
  DwsCommandResult,
  DwsLeafSchema,
} from "./types.js";

interface SchemaVerifier {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema; readonly digest: string }>;
}

interface CommandRunner {
  run(
    command: readonly string[],
    options?: { profile?: string; confirmed?: boolean; signal?: AbortSignal; sideEffect?: boolean },
  ): Promise<DwsCommandResult>;
}

interface ReconciliationInput {
  readonly spec: DingTalkToolSpec;
  readonly profile: string;
  readonly arguments: unknown;
  readonly writeResult: DwsCommandResult;
  readonly writeSchemaDigest: string;
  readonly schemas: SchemaVerifier;
  readonly runner: CommandRunner;
  readonly now?: () => string;
}

interface ReconciliationPlan {
  readonly resourceId: string;
  readonly verifierToolName: string;
  readonly arguments: Record<string, unknown>;
  readonly mode: "approval-create" | "approval-action" | "report-create";
}

const DWS_VERIFIED_SHORTCUT_IDS: Readonly<Record<string, string>> = {
  junqi_dingtalk_calendar_create: "eventId",
  junqi_dingtalk_calendar_update: "eventId",
  junqi_dingtalk_calendar_cancel: "eventId",
  junqi_dingtalk_todo_create: "taskId",
  junqi_dingtalk_todo_update: "taskId",
  junqi_dingtalk_todo_complete: "taskId",
  junqi_dingtalk_todo_reopen: "taskId",
  junqi_dingtalk_approval_approve_by: "processInstanceId",
};

const DWS_VERIFIED_SHORTCUT_EXPECTED_ARGUMENTS: Readonly<Record<string, string>> = {
  junqi_dingtalk_calendar_update: "event",
  junqi_dingtalk_calendar_cancel: "event",
  junqi_dingtalk_todo_update: "task-id",
  junqi_dingtalk_todo_complete: "task-id",
  junqi_dingtalk_todo_reopen: "task-id",
};

export const DINGTALK_RECONCILED_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "junqi_dingtalk_report_submit",
  "junqi_dingtalk_chat_send",
  "junqi_dingtalk_calendar_create",
  "junqi_dingtalk_calendar_update",
  "junqi_dingtalk_calendar_cancel",
  "junqi_dingtalk_todo_create",
  "junqi_dingtalk_todo_update",
  "junqi_dingtalk_todo_complete",
  "junqi_dingtalk_todo_reopen",
  "junqi_dingtalk_approval_create",
  "junqi_dingtalk_approval_approve_by",
  "junqi_dingtalk_approval_reject",
  "junqi_dingtalk_approval_revoke",
]);

export function assertDingTalkWriteReconciliationAvailable(spec: DingTalkToolSpec): void {
  if (spec.effect === "read" || DINGTALK_RECONCILED_WRITE_TOOL_NAMES.has(spec.name)) return;
  throw new DingTalkRuntimeError(
    "DWS_WRITE_RECONCILIATION_UNAVAILABLE",
    "DWS write reconciliation is unavailable for this tool",
    { fields: [spec.name] },
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    const currentRecord = record(current);
    if (!currentRecord) return undefined;
    current = currentRecord[segment];
  }
  return current;
}

function firstTextAtKeys(value: unknown, keys: ReadonlySet<string>): string | null {
  const pending: unknown[] = [value];
  const visited = new Set<object>();
  while (pending.length > 0 && visited.size < 10_000) {
    const current = pending.shift();
    if (!current || typeof current !== "object") continue;
    if (visited.has(current)) continue;
    visited.add(current);
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    for (const [key, candidate] of Object.entries(current as Record<string, unknown>)) {
      if (keys.has(key)) {
        const matched = text(candidate);
        if (matched) return matched;
      }
      if (candidate && typeof candidate === "object") pending.push(candidate);
    }
  }
  return null;
}

type ParsedDwsOutput =
  | { readonly mode: "unified" | "legacy"; readonly payload: unknown }
  | { readonly mode: "invalid"; readonly payload: null };

function parseDwsOutput(output: unknown): ParsedDwsOutput {
  const envelope = record(output);
  if (!envelope || (!Object.hasOwn(envelope, "ok") && !Object.hasOwn(envelope, "outcome"))) {
    return { mode: "legacy", payload: output };
  }
  if (envelope.ok !== true || envelope.outcome !== "success" || !Object.hasOwn(envelope, "data")) {
    return { mode: "invalid", payload: null };
  }
  return { mode: "unified", payload: envelope.data };
}

function hasBusinessSuccessReceipt(payload: unknown): boolean {
  const success = record(payload)?.success;
  return success === true || success === "true";
}

function inputText(argumentsValue: unknown, keys: readonly string[]): string | null {
  const argumentsRecord = record(argumentsValue);
  if (!argumentsRecord) return null;
  for (const key of keys) {
    const value = text(argumentsRecord[key]);
    if (value) return value;
  }
  return null;
}

function hasExactCompleteMessageReadback(
  payload: unknown,
  messageId: string,
  expectedConversationId: string | null,
): boolean {
  const payloadRecord = record(payload);
  if (!payloadRecord
    || payloadRecord.messagesComplete !== true
    || payloadRecord.requestedCount !== 1
    || payloadRecord.foundCount !== 1
    || payloadRecord.notFoundCount !== 0
    || payloadRecord.failedCount !== 0
    || !Array.isArray(payloadRecord.notFoundMessageIds)
    || payloadRecord.notFoundMessageIds.length !== 0
    || !Array.isArray(payloadRecord.failures)
    || payloadRecord.failures.length !== 0
    || !Array.isArray(payloadRecord.messages)
    || payloadRecord.messages.length !== 1) {
    return false;
  }
  const message = record(payloadRecord.messages[0]);
  if (!message || text(message.messageId) !== messageId) return false;
  return expectedConversationId === null
    || text(message.conversationId) === expectedConversationId;
}

function verifiedShortcutResult(
  input: ReconciliationInput,
  payload: unknown,
  observedAt: string,
): DingTalkWriteVerification | null {
  const resourceKey = DWS_VERIFIED_SHORTCUT_IDS[input.spec.name];
  if (!resourceKey) return null;
  const resourceId = text(record(payload)?.[resourceKey]);
  if (!resourceId) {
    return { status: "unknown", reasonCode: "DWS_WRITE_RESOURCE_ID_MISSING", observedAt };
  }
  const expectedArgument = DWS_VERIFIED_SHORTCUT_EXPECTED_ARGUMENTS[input.spec.name];
  const expectedResourceId = expectedArgument
    ? inputText(input.arguments, [expectedArgument])
    : null;
  if (expectedArgument && (!expectedResourceId || resourceId !== expectedResourceId)) {
    return {
      status: "unknown",
      resourceId,
      verifierToolName: input.spec.name,
      verifierCanonicalPath: input.spec.canonicalPath,
      verifierSchemaDigest: input.writeSchemaDigest,
      reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
      observedAt,
    };
  }
  if (record(payload)?.verified !== true) {
    return {
      status: "unknown",
      resourceId,
      verifierToolName: input.spec.name,
      verifierCanonicalPath: input.spec.canonicalPath,
      verifierSchemaDigest: input.writeSchemaDigest,
      reasonCode: "DWS_WRITE_VERIFICATION_MISSING",
      observedAt,
    };
  }
  return {
    status: "verified",
    resourceId,
    verifierToolName: input.spec.name,
    verifierCanonicalPath: input.spec.canonicalPath,
    verifierSchemaDigest: input.writeSchemaDigest,
    observedAt,
  };
}

function approvalReconciliationPlan(
  spec: DingTalkToolSpec,
  argumentsValue: unknown,
  payload: unknown,
): ReconciliationPlan | null {
  const create = spec.name === "junqi_dingtalk_approval_create";
  const resourceId = create
    ? text(valueAt(payload, ["result"]))
    : inputText(argumentsValue, ["instance-id"]);
  if (!resourceId) return null;
  return {
    resourceId,
    verifierToolName: "junqi_dingtalk_approval_detail",
    arguments: { "instance-id": resourceId },
    mode: create ? "approval-create" : "approval-action",
  };
}

function reportResourceId(payload: unknown): string | null {
  const payloadRecord = record(payload);
  if (!payloadRecord) return null;
  return text(payloadRecord.reportId)
    ?? text(payloadRecord.report_Id)
    ?? text(payloadRecord.report_id)
    ?? text(valueAt(payloadRecord, ["result", "reportId"]))
    ?? text(valueAt(payloadRecord, ["result", "report_Id"]))
    ?? text(valueAt(payloadRecord, ["result", "report_id"]))
    ?? text(payloadRecord.result);
}

function reportReconciliationPlan(
  spec: DingTalkToolSpec,
  payload: unknown,
): ReconciliationPlan | null {
  if (spec.name !== "junqi_dingtalk_report_submit") return null;
  const resourceId = reportResourceId(payload);
  if (!resourceId) return null;
  return {
    resourceId,
    verifierToolName: "junqi_dingtalk_report_detail",
    arguments: { "report-id": resourceId },
    mode: "report-create",
  };
}

function baseVerification(
  plan: ReconciliationPlan,
  readSpec: DingTalkToolSpec,
  digest: string,
  observedAt: string,
): Omit<DingTalkWriteVerification, "status"> {
  return {
    resourceId: plan.resourceId,
    verifierToolName: plan.verifierToolName,
    verifierCanonicalPath: readSpec.canonicalPath,
    verifierSchemaDigest: digest,
    observedAt,
  };
}

async function reconcileChatSend(
  input: ReconciliationInput,
  observedAt: string,
): Promise<DingTalkWriteVerification | null> {
  if (input.spec.name !== "junqi_dingtalk_chat_send") return null;
  const envelope = record(input.writeResult.data);
  const outcome = text(envelope?.outcome);
  if (envelope?.ok !== true
    || (outcome !== "success" && outcome !== "pending")
    || !Object.hasOwn(envelope, "data")) {
    return { status: "unknown", reasonCode: "DWS_WRITE_OUTCOME_INVALID", observedAt };
  }
  const writePayload = envelope.data;
  if (record(writePayload)?.success === false) {
    return { status: "unknown", reasonCode: "DWS_WRITE_RECEIPT_INVALID", observedAt };
  }

  const messageKeys = new Set(["openMessageId", "messageId", "msgId"]);
  const conversationKeys = new Set(["openConversationId", "conversationId", "openCid"]);
  const taskKeys = new Set(["openTaskId", "taskId"]);
  const taskId = firstTextAtKeys(writePayload, taskKeys);
  let messageId = firstTextAtKeys(writePayload, messageKeys);
  let conversationId = firstTextAtKeys(writePayload, conversationKeys);

  if (!messageId || !conversationId) {
    if (!taskId) {
      return { status: "unknown", reasonCode: "DWS_WRITE_RESOURCE_ID_MISSING", observedAt };
    }
    const statusSpec = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_chat_send_status");
    if (!statusSpec || statusSpec.effect !== "read") {
      return { status: "unknown", reasonCode: "DWS_WRITE_VERIFIER_UNAVAILABLE", observedAt };
    }
    let statusSchema: { readonly schema: DwsLeafSchema; readonly digest: string };
    try {
      statusSchema = await input.schemas.verify(statusSpec);
    } catch {
      return {
        status: "unknown",
        verifierToolName: statusSpec.name,
        verifierCanonicalPath: statusSpec.canonicalPath,
        reasonCode: "DWS_WRITE_READBACK_CONTRACT_FAILED",
        observedAt,
      };
    }
    let statusResult: DwsCommandResult;
    try {
      statusResult = await input.runner.run(
        [
          ...statusSpec.cliPath.split(" "),
          ...buildSchemaValidatedArguments(statusSchema.schema, { "open-task-id": taskId }),
        ],
        { profile: input.profile },
      );
    } catch {
      return {
        status: "unknown",
        verifierToolName: statusSpec.name,
        verifierCanonicalPath: statusSpec.canonicalPath,
        verifierSchemaDigest: statusSchema.digest,
        reasonCode: "DWS_WRITE_READBACK_FAILED",
        observedAt,
      };
    }
    const parsedStatus = parseDwsOutput(statusResult.data);
    if (parsedStatus.mode === "invalid") {
      return {
        status: "unknown",
        verifierToolName: statusSpec.name,
        verifierCanonicalPath: statusSpec.canonicalPath,
        verifierSchemaDigest: statusSchema.digest,
        reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
        observedAt,
      };
    }
    messageId = firstTextAtKeys(parsedStatus.payload, messageKeys);
    conversationId = firstTextAtKeys(parsedStatus.payload, conversationKeys);
    if (!messageId || !conversationId) {
      return {
        status: "unknown",
        verifierToolName: statusSpec.name,
        verifierCanonicalPath: statusSpec.canonicalPath,
        verifierSchemaDigest: statusSchema.digest,
        reasonCode: record(parsedStatus.payload)?.readyForMessageActions === false
          ? "DWS_WRITE_ASYNC_PENDING"
          : "DWS_WRITE_RESOURCE_ID_MISSING",
        observedAt,
      };
    }
  }

  const expectedGroup = inputText(input.arguments, ["group"]);
  if (expectedGroup && expectedGroup !== conversationId) {
    return {
      status: "unknown",
      resourceId: messageId,
      reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
      observedAt,
    };
  }

  const messagesSpec = DINGTALK_TOOL_SPEC_BY_NAME.get("junqi_dingtalk_chat_messages_by_ids");
  if (!messagesSpec || messagesSpec.effect !== "read") {
    return {
      status: "unknown",
      resourceId: messageId,
      reasonCode: "DWS_WRITE_VERIFIER_UNAVAILABLE",
      observedAt,
    };
  }
  let messagesSchema: { readonly schema: DwsLeafSchema; readonly digest: string };
  try {
    messagesSchema = await input.schemas.verify(messagesSpec);
  } catch {
    return {
      status: "unknown",
      resourceId: messageId,
      verifierToolName: messagesSpec.name,
      verifierCanonicalPath: messagesSpec.canonicalPath,
      reasonCode: "DWS_WRITE_READBACK_CONTRACT_FAILED",
      observedAt,
    };
  }
  let readback: DwsCommandResult;
  try {
    readback = await input.runner.run(
      [
        ...messagesSpec.cliPath.split(" "),
        ...buildSchemaValidatedArguments(messagesSchema.schema, {
          "msg-ids": [messageId],
          "no-reactions": true,
          "no-threads": true,
        }),
      ],
      { profile: input.profile },
    );
  } catch {
    return {
      status: "unknown",
      resourceId: messageId,
      verifierToolName: messagesSpec.name,
      verifierCanonicalPath: messagesSpec.canonicalPath,
      verifierSchemaDigest: messagesSchema.digest,
      reasonCode: "DWS_WRITE_READBACK_FAILED",
      observedAt,
    };
  }
  const parsedReadback = parseDwsOutput(readback.data);
  if (parsedReadback.mode === "invalid"
    || !hasExactCompleteMessageReadback(parsedReadback.payload, messageId, expectedGroup)) {
    return {
      status: "unknown",
      resourceId: messageId,
      verifierToolName: messagesSpec.name,
      verifierCanonicalPath: messagesSpec.canonicalPath,
      verifierSchemaDigest: messagesSchema.digest,
      reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
      observedAt,
    };
  }
  return {
    status: "succeeded_unverified",
    resourceId: messageId,
    verifierToolName: messagesSpec.name,
    verifierCanonicalPath: messagesSpec.canonicalPath,
    verifierSchemaDigest: messagesSchema.digest,
    reasonCode: "DWS_WRITE_POSTCONDITION_NOT_DECLARED",
    observedAt,
  };
}

export async function reconcileDingTalkWrite(input: ReconciliationInput): Promise<DingTalkWriteVerification> {
  const observedAt = input.now?.() ?? new Date().toISOString();
  const chatVerification = await reconcileChatSend(input, observedAt);
  if (chatVerification) return chatVerification;
  const parsedWrite = parseDwsOutput(input.writeResult.data);
  if (parsedWrite.mode === "invalid") {
    return { status: "unknown", reasonCode: "DWS_WRITE_OUTCOME_INVALID", observedAt };
  }
  const payload = parsedWrite.payload;

  if (DWS_VERIFIED_SHORTCUT_IDS[input.spec.name]) {
    if (parsedWrite.mode !== "unified") {
      return { status: "unknown", reasonCode: "DWS_WRITE_OUTCOME_INVALID", observedAt };
    }
    const shortcutVerification = verifiedShortcutResult(input, payload, observedAt);
    if (shortcutVerification) return shortcutVerification;
  }

  if (!hasBusinessSuccessReceipt(payload)) {
    return { status: "unknown", reasonCode: "DWS_WRITE_RECEIPT_INVALID", observedAt };
  }
  const plan = reportReconciliationPlan(input.spec, payload)
    ?? approvalReconciliationPlan(input.spec, input.arguments, payload);
  if (!plan) {
    return { status: "unknown", reasonCode: "DWS_WRITE_RESOURCE_ID_MISSING", observedAt };
  }
  const readSpec = DINGTALK_TOOL_SPEC_BY_NAME.get(plan.verifierToolName);
  if (!readSpec || readSpec.effect !== "read") {
    return {
      status: "unknown",
      resourceId: plan.resourceId,
      reasonCode: "DWS_WRITE_VERIFIER_UNAVAILABLE",
      observedAt,
    };
  }

  let verifiedSchema: { readonly schema: DwsLeafSchema; readonly digest: string };
  try {
    verifiedSchema = await input.schemas.verify(readSpec);
  } catch {
    return {
      status: "unknown",
      resourceId: plan.resourceId,
      verifierToolName: plan.verifierToolName,
      verifierCanonicalPath: readSpec.canonicalPath,
      reasonCode: "DWS_WRITE_READBACK_CONTRACT_FAILED",
      observedAt,
    };
  }

  let readback: DwsCommandResult;
  try {
    const argumentsList = buildSchemaValidatedArguments(verifiedSchema.schema, plan.arguments);
    readback = await input.runner.run(
      [...readSpec.cliPath.split(" "), ...argumentsList],
      { profile: input.profile },
    );
  } catch {
    return {
      status: "unknown",
      ...baseVerification(plan, readSpec, verifiedSchema.digest, observedAt),
      reasonCode: "DWS_WRITE_READBACK_FAILED",
    };
  }

  const parsedReadback = parseDwsOutput(readback.data);
  const readIdentity = plan.mode === "report-create"
    ? reportResourceId(valueAt(parsedReadback.payload, ["result"]))
      ?? reportResourceId(parsedReadback.payload)
    : text(valueAt(parsedReadback.payload, ["result", "processInstanceId"]));
  if (parsedReadback.mode === "invalid"
    || !hasBusinessSuccessReceipt(parsedReadback.payload)
    || readIdentity !== plan.resourceId) {
    return {
      status: "unknown",
      ...baseVerification(plan, readSpec, verifiedSchema.digest, observedAt),
      reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
    };
  }
  if (plan.mode === "approval-action" || plan.mode === "report-create") {
    return {
      status: "succeeded_unverified",
      ...baseVerification(plan, readSpec, verifiedSchema.digest, observedAt),
      reasonCode: "DWS_WRITE_POSTCONDITION_NOT_DECLARED",
    };
  }
  return {
    status: "verified",
    ...baseVerification(plan, readSpec, verifiedSchema.digest, observedAt),
  };
}
