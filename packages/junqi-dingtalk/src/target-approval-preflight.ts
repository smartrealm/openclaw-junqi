import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";
import { validateProfileReference } from "./dws-runner.js";
import { requireDwsSuccessResult } from "./dws-result.js";
import { buildSchemaValidatedArguments } from "./schema-contract.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsCommandResult, DwsLeafSchema } from "./types.js";

export const DINGTALK_TARGET_APPROVAL_PREFLIGHT_TOOL_NAMES = [
  "junqi_dingtalk_approval_form_schema",
  "junqi_dingtalk_approval_forecast",
  "junqi_dingtalk_approval_create",
  "junqi_dingtalk_approval_detail",
  "junqi_dingtalk_approval_revoke",
] as const;

const TARGET_APPROVAL_REQUIRED_FLAGS = [
  "--dws-path",
  "--profile",
  "--process-code",
  "--dept-id",
  "--form-values",
] as const;
const TARGET_APPROVAL_ALLOWED_FLAGS = new Set<string>(TARGET_APPROVAL_REQUIRED_FLAGS);
const MIN_INT64 = -(2n ** 63n);
const MAX_INT64 = (2n ** 63n) - 1n;

export type DingTalkTargetApprovalPreflightStage = "form_schema" | "forecast";

interface ApprovalPreflightRunner {
  run(
    command: readonly string[],
    options?: { profile?: string },
  ): Promise<DwsCommandResult>;
}

interface ApprovalPreflightSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema }>;
}

export interface DingTalkTargetApprovalPreflightInput {
  readonly profile: unknown;
  readonly processCode: unknown;
  readonly deptId: unknown;
  readonly formValues: unknown;
}

export interface DingTalkTargetApprovalPreflightCliInput extends DingTalkTargetApprovalPreflightInput {
  readonly dwsPath: string;
}

export interface DingTalkTargetApprovalPreflightResult {
  readonly status: "ready_for_manual_review" | "failed";
  readonly checkedContractCount: number;
  readonly executedReadCount: number;
  readonly checkedWriteContractCount: 2;
  readonly completedStages: readonly DingTalkTargetApprovalPreflightStage[];
  readonly failedStage?: "contract" | DingTalkTargetApprovalPreflightStage;
  readonly writeExecuted: false;
  readonly requiresManualForecastReview: true;
  readonly error?: Record<string, unknown>;
}

interface VerifiedApprovalContract {
  readonly spec: DingTalkToolSpec;
  readonly schema: DwsLeafSchema;
}

function nonemptyText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DingTalkRuntimeError(
      "DWS_APPROVAL_PREFLIGHT_INVALID",
      "Target approval preflight requires non-empty text inputs",
    );
  }
  return value.trim();
}

function normalizeDeptId(value: unknown): string {
  const text = nonemptyText(value);
  if (!/^-?(?:0|[1-9]\d*)$/u.test(text)) {
    throw new DingTalkRuntimeError(
      "DWS_APPROVAL_PREFLIGHT_INVALID",
      "Target approval preflight department ID must be an integer",
    );
  }
  const numeric = BigInt(text);
  if (numeric < MIN_INT64 || numeric > MAX_INT64) {
    throw new DingTalkRuntimeError(
      "DWS_APPROVAL_PREFLIGHT_INVALID",
      "Target approval preflight department ID exceeds int64",
    );
  }
  return text;
}

function normalizeFormValues(value: unknown): string {
  const text = nonemptyText(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DingTalkRuntimeError(
      "DWS_APPROVAL_PREFLIGHT_INVALID",
      "Target approval preflight form values must be valid JSON",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DingTalkRuntimeError(
      "DWS_APPROVAL_PREFLIGHT_INVALID",
      "Target approval preflight form values must be a JSON object",
    );
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new DingTalkRuntimeError(
      "DWS_APPROVAL_PREFLIGHT_INVALID",
      "Target approval preflight form values cannot be empty",
    );
  }
  for (const [name, fieldValue] of entries) {
    if (name.trim().length === 0 || typeof fieldValue !== "string") {
      throw new DingTalkRuntimeError(
        "DWS_APPROVAL_PREFLIGHT_INVALID",
        "Target approval preflight form values must map field names to strings",
      );
    }
  }
  return JSON.stringify(parsed);
}

function approvalSpec(name: string): DingTalkToolSpec {
  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  if (!spec || spec.domain !== "approval") {
    throw new TypeError(`Target approval preflight tool contract is invalid: ${name}`);
  }
  const valid = name === "junqi_dingtalk_approval_form_schema"
    || name === "junqi_dingtalk_approval_forecast"
    || name === "junqi_dingtalk_approval_detail"
    ? spec.effect === "read"
      && spec.risk === "low"
      && spec.confirmation === "not_required"
      && spec.idempotency === "idempotent"
    : name === "junqi_dingtalk_approval_create"
      ? spec.effect === "write"
        && spec.risk === "high"
        && spec.confirmation === "user_required"
        && spec.idempotency === "non_idempotent"
      : name === "junqi_dingtalk_approval_revoke"
        && spec.effect === "write"
        && spec.risk === "high"
        && spec.confirmation === "user_required"
        && spec.idempotency === "unknown";
  if (!valid) {
    throw new TypeError(`Target approval preflight tool safety contract is invalid: ${name}`);
  }
  return spec;
}

export function parseDingTalkTargetApprovalPreflightArguments(
  argv: readonly string[],
): DingTalkTargetApprovalPreflightCliInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !TARGET_APPROVAL_ALLOWED_FLAGS.has(flag)) {
      throw new TypeError("Target approval preflight contains an unsupported argument");
    }
    if (!value) {
      throw new TypeError("Target approval preflight argument value is missing");
    }
    if (values.has(flag)) {
      throw new TypeError("Target approval preflight contains a duplicate argument");
    }
    values.set(flag, value);
  }
  for (const flag of TARGET_APPROVAL_REQUIRED_FLAGS) {
    if (!values.has(flag)) {
      throw new TypeError("Target approval preflight required argument is missing");
    }
  }
  const dwsPath = values.get("--dws-path");
  const profile = values.get("--profile");
  const processCode = values.get("--process-code");
  const deptId = values.get("--dept-id");
  const formValues = values.get("--form-values");
  if (!dwsPath || !profile || !processCode || !deptId || !formValues) {
    throw new TypeError("Target approval preflight required argument is empty");
  }
  return { dwsPath, profile, processCode, deptId, formValues };
}

async function verifyApprovalContracts(
  schemas: ApprovalPreflightSchemas,
): Promise<ReadonlyMap<string, VerifiedApprovalContract>> {
  const contracts = new Map<string, VerifiedApprovalContract>();
  for (const name of DINGTALK_TARGET_APPROVAL_PREFLIGHT_TOOL_NAMES) {
    const spec = approvalSpec(name);
    contracts.set(name, { spec, ...(await schemas.verify(spec)) });
  }
  return contracts;
}

function requiredContract(
  contracts: ReadonlyMap<string, VerifiedApprovalContract>,
  name: string,
): VerifiedApprovalContract {
  const contract = contracts.get(name);
  if (!contract) throw new TypeError(`Target approval preflight contract is missing: ${name}`);
  return contract;
}

export async function runDingTalkTargetApprovalPreflight(
  schemas: ApprovalPreflightSchemas,
  runner: ApprovalPreflightRunner,
  rawInput: DingTalkTargetApprovalPreflightInput,
): Promise<DingTalkTargetApprovalPreflightResult> {
  let profile: string;
  let processCode: string;
  let deptId: string;
  let formValues: string;
  let contracts: ReadonlyMap<string, VerifiedApprovalContract>;
  try {
    profile = validateProfileReference(rawInput.profile);
    processCode = nonemptyText(rawInput.processCode);
    deptId = normalizeDeptId(rawInput.deptId);
    formValues = normalizeFormValues(rawInput.formValues);
    contracts = await verifyApprovalContracts(schemas);
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_approval_form_schema").schema,
      { "process-code": processCode },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_approval_forecast").schema,
      { "process-code": processCode, "dept-id": deptId, "form-values": formValues },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_approval_create").schema,
      { "process-code": processCode, "dept-id": deptId, "form-values": formValues },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_approval_detail").schema,
      { "instance-id": "approval-preflight-instance" },
    );
    buildSchemaValidatedArguments(
      requiredContract(contracts, "junqi_dingtalk_approval_revoke").schema,
      { "instance-id": "approval-preflight-instance" },
    );
  } catch (error) {
    return {
      status: "failed",
      checkedContractCount: 0,
      executedReadCount: 0,
      checkedWriteContractCount: 2,
      completedStages: [],
      failedStage: "contract",
      writeExecuted: false,
      requiresManualForecastReview: true,
      error: serializeRuntimeError(error),
    };
  }

  const completedStages: DingTalkTargetApprovalPreflightStage[] = [];
  const reads: ReadonlyArray<{
    readonly stage: DingTalkTargetApprovalPreflightStage;
    readonly toolName: string;
    readonly arguments: Record<string, unknown>;
  }> = [
    {
      stage: "form_schema",
      toolName: "junqi_dingtalk_approval_form_schema",
      arguments: { "process-code": processCode },
    },
    {
      stage: "forecast",
      toolName: "junqi_dingtalk_approval_forecast",
      arguments: { "process-code": processCode, "dept-id": deptId, "form-values": formValues },
    },
  ];

  for (const read of reads) {
    const contract = requiredContract(contracts, read.toolName);
    try {
      requireDwsSuccessResult(await runner.run(
        [
          ...contract.spec.cliPath.split(" "),
          ...buildSchemaValidatedArguments(contract.schema, read.arguments),
        ],
        { profile },
      ));
      completedStages.push(read.stage);
    } catch (error) {
      return {
        status: "failed",
        checkedContractCount: contracts.size,
        executedReadCount: completedStages.length,
        checkedWriteContractCount: 2,
        completedStages,
        failedStage: read.stage,
        writeExecuted: false,
        requiresManualForecastReview: true,
        error: serializeRuntimeError(error),
      };
    }
  }

  return {
    status: "ready_for_manual_review",
    checkedContractCount: contracts.size,
    executedReadCount: completedStages.length,
    checkedWriteContractCount: 2,
    completedStages,
    writeExecuted: false,
    requiresManualForecastReview: true,
  };
}
