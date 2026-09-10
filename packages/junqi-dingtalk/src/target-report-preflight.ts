import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";
import { validateProfileReference } from "./dws-runner.js";
import { requireDwsSuccessResult } from "./dws-result.js";
import { buildSchemaValidatedArguments } from "./schema-contract.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsCommandResult, DwsLeafSchema } from "./types.js";

export const DINGTALK_TARGET_REPORT_PREFLIGHT_TOOL_NAMES = [
  "junqi_dingtalk_report_template_search",
  "junqi_dingtalk_report_template",
  "junqi_dingtalk_report_submit",
  "junqi_dingtalk_report_detail",
] as const;

const TARGET_REPORT_REQUIRED_FLAGS = [
  "--dws-path",
  "--profile",
  "--template-name",
  "--contents",
  "--to-user-ids",
] as const;
const TARGET_REPORT_ALLOWED_FLAGS = new Set<string>(TARGET_REPORT_REQUIRED_FLAGS);
const REPORT_CONTENTS_MAX_BYTES = 10 * 1024 * 1024;
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = (2n ** 63n) - 1n;
const REPORT_FIELD_TYPES = new Map<string, string>([
  ["1", "1"], ["text", "1"], ["markdown", "1"], ["文本", "1"],
  ["2", "2"], ["number", "2"], ["num", "2"], ["数字", "2"],
  ["3", "3"], ["single", "3"], ["single_select", "3"], ["radio", "3"], ["单选", "3"],
  ["5", "5"], ["date", "5"], ["日期", "5"],
  ["7", "7"], ["multi", "7"], ["multi_select", "7"], ["checkbox", "7"], ["多选", "7"],
  ["8", "8"], ["image", "8"], ["picture", "8"], ["图片", "8"],
  ["9", "9"], ["attachment", "9"], ["file", "9"], ["附件", "9"],
]);

export type DingTalkTargetReportPreflightStage = "template_search" | "template_definition";

interface ReportPreflightRunner {
  run(
    command: readonly string[],
    options?: { profile?: string },
  ): Promise<DwsCommandResult>;
}

interface ReportPreflightSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema }>;
}

export interface DingTalkTargetReportPreflightInput {
  readonly profile: unknown;
  readonly templateName: unknown;
  readonly contents: unknown;
  readonly toUserIds: unknown;
}

export interface DingTalkTargetReportPreflightCliInput extends DingTalkTargetReportPreflightInput {
  readonly dwsPath: string;
}

export interface DingTalkTargetReportPreflightResult {
  readonly status: "ready_for_manual_review" | "failed";
  readonly checkedContractCount: number;
  readonly executedReadCount: number;
  readonly checkedWriteContractCount: 1;
  readonly completedStages: readonly DingTalkTargetReportPreflightStage[];
  readonly failedStage?: "contract" | DingTalkTargetReportPreflightStage;
  readonly writeExecuted: false;
  readonly requiresManualTemplateReview: true;
  readonly error?: Record<string, unknown>;
}

interface VerifiedReportContract {
  readonly spec: DingTalkToolSpec;
  readonly schema: DwsLeafSchema;
}

interface NormalizedReportInput {
  readonly templateName: string;
  readonly contents: string;
  readonly toUserIds: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidInput(message: string): never {
  throw new DingTalkRuntimeError("DWS_REPORT_PREFLIGHT_INVALID", message);
}

function nonemptyText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidInput("Target report preflight requires non-empty text inputs");
  }
  return value.trim();
}

function scalarString(value: unknown, field: "sort" | "type"): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return invalidInput(`Target report preflight ${field} must be a safe integer`);
    }
    return String(value);
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidInput(`Target report preflight ${field} must be a scalar value`);
  }
  return value.trim();
}

function integerString(value: unknown): string {
  const text = scalarString(value, "sort");
  if (!/^-?(?:0|[1-9]\d*)$/u.test(text)) {
    return invalidInput("Target report preflight sort must be an integer or integer string");
  }
  const numeric = BigInt(text);
  if (numeric < MIN_INT64 || numeric > MAX_INT64) {
    return invalidInput("Target report preflight sort exceeds int64");
  }
  return text;
}

function normalizeReportContents(value: unknown): string {
  const text = nonemptyText(value);
  if (Buffer.byteLength(text, "utf8") > REPORT_CONTENTS_MAX_BYTES) {
    return invalidInput("Target report preflight contents exceed the DWS size limit");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalidInput("Target report preflight contents must be valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return invalidInput("Target report preflight contents must be a non-empty JSON array");
  }
  const normalized = parsed.map((rawItem) => {
    if (!isRecord(rawItem)) {
      return invalidInput("Target report preflight contents items must be objects");
    }
    const key = typeof rawItem.key === "string" ? rawItem.key.trim() : "";
    if (!key) return invalidInput("Target report preflight content key is invalid");
    if (typeof rawItem.content !== "string") {
      return invalidInput("Target report preflight content must be a string");
    }
    const sort = integerString(rawItem.sort);
    const rawType = scalarString(rawItem.type, "type").toLowerCase();
    const type = REPORT_FIELD_TYPES.get(rawType);
    if (!type) return invalidInput("Target report preflight content type is invalid");
    if (typeof rawItem.contentType !== "string") {
      return invalidInput("Target report preflight contentType must be a string");
    }
    const rawContentType = rawItem.contentType.trim().toLowerCase();
    const contentType = type === "1"
      ? rawContentType === "markdown" || rawContentType === "text"
        ? "markdown"
        : undefined
      : rawContentType === "origin" || rawContentType === "raw"
        ? "origin"
        : undefined;
    if (!contentType) {
      return invalidInput("Target report preflight contentType is invalid for the field type");
    }
    return {
      ...rawItem,
      key,
      sort,
      content: rawItem.content,
      type,
      contentType,
    };
  });
  return JSON.stringify(normalized);
}

function normalizeRecipients(value: unknown): string {
  const text = nonemptyText(value);
  const rawRecipients = text.split(",");
  const recipients = rawRecipients.map((recipient) => recipient.trim());
  if (recipients.some((recipient) => recipient.length === 0)) {
    return invalidInput("Target report preflight recipients contain an empty value");
  }
  if (new Set(recipients).size !== recipients.length) {
    return invalidInput("Target report preflight recipients contain duplicates");
  }
  return recipients.join(",");
}

function reportSpec(name: string): DingTalkToolSpec {
  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  const readContract = name === "junqi_dingtalk_report_template_search"
    || name === "junqi_dingtalk_report_template"
    || name === "junqi_dingtalk_report_detail";
  const valid = readContract
    ? spec?.domain === "report"
      && spec.effect === "read"
      && spec.risk === "low"
      && spec.confirmation === "not_required"
      && spec.idempotency === "idempotent"
    : name === "junqi_dingtalk_report_submit"
      && spec?.domain === "report"
      && spec.effect === "write"
      && spec.risk === "medium"
      && spec.confirmation === "not_required"
      && spec.idempotency === "unknown";
  if (!spec || !valid) {
    throw new TypeError(`Target report preflight tool safety contract is invalid: ${name}`);
  }
  return spec;
}

export function parseDingTalkTargetReportPreflightArguments(
  argv: readonly string[],
): DingTalkTargetReportPreflightCliInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !TARGET_REPORT_ALLOWED_FLAGS.has(flag)) {
      throw new TypeError("Target report preflight contains an unsupported argument");
    }
    if (!value) throw new TypeError("Target report preflight argument value is missing");
    if (values.has(flag)) {
      throw new TypeError("Target report preflight contains a duplicate argument");
    }
    values.set(flag, value);
  }
  for (const flag of TARGET_REPORT_REQUIRED_FLAGS) {
    if (!values.has(flag)) {
      throw new TypeError("Target report preflight required argument is missing");
    }
  }
  const dwsPath = values.get("--dws-path");
  const profile = values.get("--profile");
  const templateName = values.get("--template-name");
  const contents = values.get("--contents");
  const toUserIds = values.get("--to-user-ids");
  if (!dwsPath || !profile || !templateName || !contents || !toUserIds) {
    throw new TypeError("Target report preflight required argument is empty");
  }
  return { dwsPath, profile, templateName, contents, toUserIds };
}

function normalizeInput(rawInput: DingTalkTargetReportPreflightInput): NormalizedReportInput {
  return {
    templateName: nonemptyText(rawInput.templateName),
    contents: normalizeReportContents(rawInput.contents),
    toUserIds: normalizeRecipients(rawInput.toUserIds),
  };
}

async function verifyReportContracts(
  schemas: ReportPreflightSchemas,
): Promise<ReadonlyMap<string, VerifiedReportContract>> {
  const contracts = new Map<string, VerifiedReportContract>();
  for (const name of DINGTALK_TARGET_REPORT_PREFLIGHT_TOOL_NAMES) {
    const spec = reportSpec(name);
    contracts.set(name, { spec, ...(await schemas.verify(spec)) });
  }
  return contracts;
}

function requiredContract(
  contracts: ReadonlyMap<string, VerifiedReportContract>,
  name: string,
): VerifiedReportContract {
  const contract = contracts.get(name);
  if (!contract) throw new TypeError(`Target report preflight contract is missing: ${name}`);
  return contract;
}

function resolveTemplateId(value: unknown, templateName: string): string {
  if (!isRecord(value)
    || value.ok !== true
    || value.outcome !== "success"
    || !isRecord(value.data)
    || !Number.isSafeInteger(value.data.count)
    || Number(value.data.count) < 0
    || !Array.isArray(value.data.templates)
    || value.data.count !== value.data.templates.length) {
    throw new DingTalkRuntimeError(
      "DWS_REPORT_PREFLIGHT_RESULT_INVALID",
      "Target report preflight template search result is invalid",
    );
  }
  const seenIds = new Set<string>();
  const exactMatches: string[] = [];
  for (const rawTemplate of value.data.templates) {
    if (!isRecord(rawTemplate)
      || typeof rawTemplate.templateId !== "string"
      || rawTemplate.templateId.trim().length === 0
      || typeof rawTemplate.name !== "string"
      || rawTemplate.name.trim().length === 0
      || (rawTemplate.lastModifiedTime !== undefined
        && !Number.isSafeInteger(rawTemplate.lastModifiedTime))) {
      throw new DingTalkRuntimeError(
        "DWS_REPORT_PREFLIGHT_RESULT_INVALID",
        "Target report preflight template search item is invalid",
      );
    }
    const templateId = rawTemplate.templateId.trim();
    if (seenIds.has(templateId)) {
      throw new DingTalkRuntimeError(
        "DWS_REPORT_PREFLIGHT_RESULT_INVALID",
        "Target report preflight template search contains duplicate IDs",
      );
    }
    seenIds.add(templateId);
    if (rawTemplate.name === templateName) exactMatches.push(templateId);
  }
  if (exactMatches.length !== 1) {
    throw new DingTalkRuntimeError(
      "DWS_REPORT_PREFLIGHT_TEMPLATE_UNRESOLVED",
      "Target report preflight requires exactly one exact template match",
      { matchCount: exactMatches.length },
    );
  }
  const templateId = exactMatches[0];
  if (!templateId) {
    throw new DingTalkRuntimeError(
      "DWS_REPORT_PREFLIGHT_RESULT_INVALID",
      "Target report preflight exact template ID is missing",
    );
  }
  return templateId;
}

function failedResult(
  checkedContractCount: number,
  completedStages: readonly DingTalkTargetReportPreflightStage[],
  failedStage: "contract" | DingTalkTargetReportPreflightStage,
  error: unknown,
): DingTalkTargetReportPreflightResult {
  return {
    status: "failed",
    checkedContractCount,
    executedReadCount: completedStages.length,
    checkedWriteContractCount: 1,
    completedStages,
    failedStage,
    writeExecuted: false,
    requiresManualTemplateReview: true,
    error: serializeRuntimeError(error),
  };
}

export async function runDingTalkTargetReportPreflight(
  schemas: ReportPreflightSchemas,
  runner: ReportPreflightRunner,
  rawInput: DingTalkTargetReportPreflightInput,
): Promise<DingTalkTargetReportPreflightResult> {
  let profile: string;
  let input: NormalizedReportInput;
  let contracts: ReadonlyMap<string, VerifiedReportContract>;
  try {
    profile = validateProfileReference(rawInput.profile);
    input = normalizeInput(rawInput);
    contracts = await verifyReportContracts(schemas);
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_report_template_search").schema,
      { query: input.templateName },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_report_template").schema,
      { name: input.templateName },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_report_detail").schema,
      { "report-id": "report-preflight-id" },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_report_submit").schema,
      {
        "template-id": "report-preflight-template",
        contents: input.contents,
        "to-user-ids": input.toUserIds,
      },
    );
  } catch (error) {
    return failedResult(0, [], "contract", error);
  }

  const completedStages: DingTalkTargetReportPreflightStage[] = [];
  const search = requiredContract(contracts, "junqi_dingtalk_report_template_search");
  let templateId: string;
  try {
    const result = await runner.run(
      [
        ...search.spec.cliPath.split(" "),
        ...buildSchemaValidatedArguments(search.schema, { query: input.templateName }),
      ],
      { profile },
    );
    templateId = resolveTemplateId(result.data, input.templateName);
    completedStages.push("template_search");
  } catch (error) {
    return failedResult(contracts.size, completedStages, "template_search", error);
  }

  try {
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_report_submit").schema,
      {
        "template-id": templateId,
        contents: input.contents,
        "to-user-ids": input.toUserIds,
      },
    );
    const definition = requiredContract(contracts, "junqi_dingtalk_report_template");
    requireDwsSuccessResult(await runner.run(
      [
        ...definition.spec.cliPath.split(" "),
        ...buildSchemaValidatedArguments(definition.schema, { name: input.templateName }),
      ],
      { profile },
    ));
    completedStages.push("template_definition");
  } catch (error) {
    return failedResult(contracts.size, completedStages, "template_definition", error);
  }

  return {
    status: "ready_for_manual_review",
    checkedContractCount: contracts.size,
    executedReadCount: completedStages.length,
    checkedWriteContractCount: 1,
    completedStages,
    writeExecuted: false,
    requiresManualTemplateReview: true,
  };
}
