import { DWS_STDIN_MAX_BYTES, validateProfileReference } from "./dws-runner.js";
import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";
import { requireDwsSuccessResult } from "./dws-result.js";
import { serializeDingTalkContractAnalysisInput } from "./invocation-policy.js";
import { buildSchemaValidatedArguments } from "./schema-contract.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsCommandResult, DwsLeafSchema } from "./types.js";

export const DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT =
  "aitable-contract-recruit-goal-readonly-17";

export const DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES = [
  "junqi_dingtalk_aitable_base_search",
  "junqi_dingtalk_aitable_schema",
  "junqi_dingtalk_aitable_tables",
  "junqi_dingtalk_aitable_records",
  "junqi_dingtalk_contract_projects",
  "junqi_dingtalk_contract_project",
  "junqi_dingtalk_contract_subjects",
  "junqi_dingtalk_contract_subject",
  "junqi_dingtalk_contract_risk",
  "junqi_dingtalk_contract_review_analysis",
  "junqi_dingtalk_contract_review_result",
  "junqi_dingtalk_recruit_jobs",
  "junqi_dingtalk_recruit_job",
  "junqi_dingtalk_goal_user_rules",
  "junqi_dingtalk_goal_templates",
  "junqi_dingtalk_goal_statistics",
  "junqi_dingtalk_goal_report_detail",
] as const;

interface SensitiveReadRunner {
  run(
    command: readonly string[],
    options?: { profile?: string; stdin?: string },
  ): Promise<DwsCommandResult>;
}

interface SensitiveReadSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema }>;
}

interface AitableFixture {
  readonly query: string;
  readonly baseId: string;
  readonly tableId: string;
  readonly recordId: string;
}

interface ContractFixture {
  readonly projectId: number;
  readonly projectCode: string;
  readonly subjectId: number;
  readonly subjectName: string;
  readonly analysisRequest: Record<string, unknown>;
  readonly reviewTaskId: string;
  readonly reviewType: string;
}

interface RecruitFixture {
  readonly jobId: string;
}

interface GoalFixture {
  readonly templateKeyword: string;
  readonly ruleKeyword: string;
  readonly templateId: string;
  readonly submitState: "ON_TIME" | "LATE" | "NOT_SUBMITTED";
}

export interface DingTalkTargetSensitiveReadonlyFixture {
  readonly aitable: AitableFixture;
  readonly contract: ContractFixture;
  readonly recruit: RecruitFixture;
  readonly goal: GoalFixture;
}

export interface DingTalkTargetSensitiveReadFailure {
  readonly toolName: string;
  readonly canonicalPath: string;
  readonly stage: "schema" | "arguments" | "read";
  readonly error: Record<string, unknown>;
}

export interface DingTalkTargetSensitiveReadResult {
  readonly status: "passed" | "preflight_failed" | "read_failed";
  readonly checkedCount: number;
  readonly schemaVerifiedCount: number;
  readonly argumentValidatedCount: number;
  readonly readAttemptedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly unattemptedCount: number;
  readonly writeExecuted: false;
  readonly businessPayloadRetained: false;
  readonly failures: readonly DingTalkTargetSensitiveReadFailure[];
}

interface SensitiveReadPlan {
  readonly spec: DingTalkToolSpec;
  readonly arguments: Record<string, unknown>;
  readonly stdin?: string;
}

export interface DingTalkTargetSensitiveToolInvocation {
  readonly toolName: string;
  readonly canonicalPath: string;
  readonly arguments: Record<string, unknown>;
  readonly schemaArguments: Record<string, unknown>;
}

function invalidFixture(field: string): never {
  throw new DingTalkRuntimeError(
    "DWS_SENSITIVE_PREFLIGHT_INVALID",
    "Target sensitive read preflight input is invalid",
    { fields: [field] },
  );
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidFixture(field);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], field: string): void {
  const expectedSet = new Set(expected);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expectedSet.has(key))) {
    invalidFixture(field);
  }
}

function boundedString(
  value: unknown,
  field: string,
  maximum: number,
  pattern?: RegExp,
): string {
  if (typeof value !== "string") invalidFixture(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || (pattern && !pattern.test(normalized))) {
    invalidFixture(field);
  }
  return normalized;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalidFixture(field);
  return Number(value);
}

function analysisRequest(value: unknown): { readonly value: Record<string, unknown>; readonly json: string } {
  const request = recordValue(value, "contract.analysisRequest");
  if (Object.keys(request).length === 0) invalidFixture("contract.analysisRequest");
  let json: string;
  try {
    json = JSON.stringify(request);
  } catch {
    invalidFixture("contract.analysisRequest");
  }
  if (!json || Buffer.byteLength(json, "utf8") > DWS_STDIN_MAX_BYTES) {
    invalidFixture("contract.analysisRequest");
  }
  return { value: request, json };
}

export function validateSensitiveReadAcknowledgement(value: unknown): void {
  if (value !== DINGTALK_SENSITIVE_READ_ACKNOWLEDGEMENT) {
    invalidFixture("acknowledgement");
  }
}

export function parseDingTalkTargetSensitiveReadonlyFixture(
  value: unknown,
): DingTalkTargetSensitiveReadonlyFixture {
  const fixture = recordValue(value, "fixture");
  exactKeys(fixture, ["aitable", "contract", "recruit", "goal"], "fixture");

  const aitable = recordValue(fixture.aitable, "aitable");
  exactKeys(aitable, ["query", "baseId", "tableId", "recordId"], "aitable");

  const contract = recordValue(fixture.contract, "contract");
  exactKeys(contract, [
    "projectId",
    "projectCode",
    "subjectId",
    "subjectName",
    "analysisRequest",
    "reviewTaskId",
    "reviewType",
  ], "contract");
  const parsedAnalysis = analysisRequest(contract.analysisRequest);

  const recruit = recordValue(fixture.recruit, "recruit");
  exactKeys(recruit, ["jobId"], "recruit");

  const goal = recordValue(fixture.goal, "goal");
  exactKeys(
    goal,
    ["templateKeyword", "ruleKeyword", "templateId", "submitState"],
    "goal",
  );
  if (
    goal.submitState !== "ON_TIME"
    && goal.submitState !== "LATE"
    && goal.submitState !== "NOT_SUBMITTED"
  ) {
    invalidFixture("goal.submitState");
  }

  return {
    aitable: {
      query: boundedString(aitable.query, "aitable.query", 256),
      baseId: boundedString(aitable.baseId, "aitable.baseId", 512),
      tableId: boundedString(aitable.tableId, "aitable.tableId", 512),
      recordId: boundedString(aitable.recordId, "aitable.recordId", 512),
    },
    contract: {
      projectId: positiveInteger(contract.projectId, "contract.projectId"),
      projectCode: boundedString(contract.projectCode, "contract.projectCode", 512),
      subjectId: positiveInteger(contract.subjectId, "contract.subjectId"),
      subjectName: boundedString(contract.subjectName, "contract.subjectName", 512),
      analysisRequest: parsedAnalysis.value,
      reviewTaskId: boundedString(contract.reviewTaskId, "contract.reviewTaskId", 512),
      reviewType: boundedString(
        contract.reviewType,
        "contract.reviewType",
        64,
        /^[A-Z][A-Z0-9_]*$/u,
      ),
    },
    recruit: {
      jobId: boundedString(recruit.jobId, "recruit.jobId", 512),
    },
    goal: {
      templateKeyword: boundedString(goal.templateKeyword, "goal.templateKeyword", 256),
      ruleKeyword: boundedString(goal.ruleKeyword, "goal.ruleKeyword", 256),
      templateId: boundedString(goal.templateId, "goal.templateId", 512),
      submitState: goal.submitState,
    },
  };
}

function sensitiveToolSpec(toolName: string): DingTalkToolSpec {
  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(toolName);
  if (
    !spec
    || !["aitable", "contract", "recruit", "goal"].includes(spec.domain)
    || spec.effect !== "read"
    || spec.risk !== "low"
    || spec.confirmation !== "not_required"
    || spec.idempotency !== "idempotent"
  ) {
    throw new TypeError(`Sensitive read preflight tool contract is invalid: ${toolName}`);
  }
  return spec;
}

export function buildDingTalkTargetSensitiveToolInvocations(
  fixture: DingTalkTargetSensitiveReadonlyFixture,
): readonly DingTalkTargetSensitiveToolInvocation[] {
  const argumentsByToolName: Record<string, Record<string, unknown>> = {
    junqi_dingtalk_aitable_base_search: { query: fixture.aitable.query },
    junqi_dingtalk_aitable_schema: { "base-id": fixture.aitable.baseId },
    junqi_dingtalk_aitable_tables: { base: fixture.aitable.baseId },
    junqi_dingtalk_aitable_records: {
      "base-id": fixture.aitable.baseId,
      "table-id": fixture.aitable.tableId,
      "record-ids": [fixture.aitable.recordId],
      limit: 1,
    },
    junqi_dingtalk_contract_projects: {
      "current-page": 1,
      "page-size": 1,
      scope: "self",
      code: fixture.contract.projectCode,
    },
    junqi_dingtalk_contract_project: { "project-id": fixture.contract.projectId },
    junqi_dingtalk_contract_subjects: {
      "current-page": 1,
      "page-size": 1,
      name: fixture.contract.subjectName,
    },
    junqi_dingtalk_contract_subject: { "subject-id": fixture.contract.subjectId },
    junqi_dingtalk_contract_risk: {
      "subject-id": fixture.contract.subjectId,
      "subject-name": fixture.contract.subjectName,
    },
    junqi_dingtalk_contract_review_analysis: { file: fixture.contract.analysisRequest },
    junqi_dingtalk_contract_review_result: {
      "task-id": fixture.contract.reviewTaskId,
      "review-type": fixture.contract.reviewType,
    },
    junqi_dingtalk_recruit_jobs: { "job-ids": [fixture.recruit.jobId], size: 1 },
    junqi_dingtalk_recruit_job: { "job-id": fixture.recruit.jobId },
    junqi_dingtalk_goal_user_rules: {},
    junqi_dingtalk_goal_templates: {
      keyword: fixture.goal.templateKeyword,
      page: 1,
      "page-size": 1,
    },
    junqi_dingtalk_goal_statistics: { keyword: fixture.goal.ruleKeyword },
    junqi_dingtalk_goal_report_detail: {
      "template-id": fixture.goal.templateId,
      "submit-state": fixture.goal.submitState,
      page: 1,
      "page-size": 1,
    },
  };
  return DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES.map((toolName) => {
    const spec = sensitiveToolSpec(toolName);
    return {
      toolName: spec.name,
      canonicalPath: spec.canonicalPath,
      arguments: argumentsByToolName[toolName] ?? {},
      schemaArguments: toolName === "junqi_dingtalk_contract_review_analysis"
        ? { file: "-" }
        : argumentsByToolName[toolName] ?? {},
    };
  });
}

function buildPlans(
  fixture: DingTalkTargetSensitiveReadonlyFixture,
): readonly SensitiveReadPlan[] {
  return buildDingTalkTargetSensitiveToolInvocations(fixture).map((invocation) => ({
    spec: sensitiveToolSpec(invocation.toolName),
    arguments: invocation.schemaArguments,
    ...(invocation.toolName === "junqi_dingtalk_contract_review_analysis"
      ? { stdin: serializeDingTalkContractAnalysisInput(invocation.arguments) }
      : {}),
  }));
}

function preflightResult(
  status: DingTalkTargetSensitiveReadResult["status"],
  schemaVerifiedCount: number,
  argumentValidatedCount: number,
  readAttemptedCount: number,
  passedCount: number,
  failures: readonly DingTalkTargetSensitiveReadFailure[],
): DingTalkTargetSensitiveReadResult {
  const checkedCount = DINGTALK_TARGET_SENSITIVE_READ_TOOL_NAMES.length;
  return {
    status,
    checkedCount,
    schemaVerifiedCount,
    argumentValidatedCount,
    readAttemptedCount,
    passedCount,
    failedCount: failures.length,
    unattemptedCount: checkedCount - passedCount - failures.length,
    writeExecuted: false,
    businessPayloadRetained: false,
    failures,
  };
}

export async function runDingTalkTargetSensitiveReadonlyPreflight(
  schemas: SensitiveReadSchemas,
  runner: SensitiveReadRunner,
  profileInput: unknown,
  acknowledgementInput: unknown,
  fixtureInput: unknown,
): Promise<DingTalkTargetSensitiveReadResult> {
  validateSensitiveReadAcknowledgement(acknowledgementInput);
  const profile = validateProfileReference(profileInput);
  const fixture = parseDingTalkTargetSensitiveReadonlyFixture(fixtureInput);
  const plans = buildPlans(fixture);
  const schemasByToolName = new Map<string, DwsLeafSchema>();
  const failures: DingTalkTargetSensitiveReadFailure[] = [];

  for (const plan of plans) {
    try {
      const verified = await schemas.verify(plan.spec);
      schemasByToolName.set(plan.spec.name, verified.schema);
    } catch (error) {
      failures.push({
        toolName: plan.spec.name,
        canonicalPath: plan.spec.canonicalPath,
        stage: "schema",
        error: serializeRuntimeError(error),
      });
    }
  }
  if (failures.length > 0) {
    return preflightResult(
      "preflight_failed",
      plans.length - failures.length,
      0,
      0,
      0,
      failures,
    );
  }

  const commands: Array<{ readonly plan: SensitiveReadPlan; readonly command: readonly string[] }> = [];
  for (const plan of plans) {
    try {
      const schema = schemasByToolName.get(plan.spec.name);
      if (!schema) throw new TypeError(`Verified schema is missing: ${plan.spec.name}`);
      commands.push({
        plan,
        command: [
          ...plan.spec.cliPath.split(" "),
          ...buildSchemaValidatedArguments(schema, plan.arguments),
        ],
      });
    } catch (error) {
      failures.push({
        toolName: plan.spec.name,
        canonicalPath: plan.spec.canonicalPath,
        stage: "arguments",
        error: serializeRuntimeError(error),
      });
    }
  }
  if (failures.length > 0) {
    return preflightResult(
      "preflight_failed",
      plans.length,
      plans.length - failures.length,
      0,
      0,
      failures,
    );
  }

  let passedCount = 0;
  for (const { plan, command } of commands) {
    try {
      requireDwsSuccessResult(await runner.run(command, {
        profile,
        ...(plan.stdin ? { stdin: plan.stdin } : {}),
      }));
      passedCount += 1;
    } catch (error) {
      failures.push({
        toolName: plan.spec.name,
        canonicalPath: plan.spec.canonicalPath,
        stage: "read",
        error: serializeRuntimeError(error),
      });
    }
  }

  return preflightResult(
    failures.length === 0 ? "passed" : "read_failed",
    plans.length,
    plans.length,
    commands.length,
    passedCount,
    failures,
  );
}
