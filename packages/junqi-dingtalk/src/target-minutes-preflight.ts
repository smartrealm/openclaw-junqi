import path from "node:path";
import { validateProfileReference } from "./dws-runner.js";
import { requireDwsSuccessResult } from "./dws-result.js";
import { DingTalkRuntimeError, serializeRuntimeError } from "./errors.js";
import { validateDingTalkInvocationPolicy } from "./invocation-policy.js";
import { assertDingTalkReadResult } from "./read-result.js";
import { buildSchemaValidatedArguments } from "./schema-contract.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DingTalkToolSpec, DwsCommandResult, DwsLeafSchema } from "./types.js";

export const DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT =
  "minutes-readonly-same-task";

export const DINGTALK_TARGET_MINUTES_TOOL_NAMES = [
  "junqi_dingtalk_minutes_search",
  "junqi_dingtalk_minutes_detail",
  "junqi_dingtalk_minutes_transcript",
  "junqi_dingtalk_minutes_action_items",
] as const;

export interface DingTalkTargetMinutesFixture {
  readonly query: string;
  readonly taskId: string;
}

export interface DingTalkTargetMinutesCliInput {
  readonly dwsPath: string;
  readonly profile: string;
  readonly acknowledgement: string;
}

export type DingTalkTargetMinutesStage =
  | "search"
  | "detail"
  | "transcript"
  | "action_items";

interface MinutesPreflightRunner {
  run(
    command: readonly string[],
    options?: { profile?: string },
  ): Promise<DwsCommandResult>;
}

interface MinutesPreflightSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema }>;
}

interface MinutesPlan {
  readonly spec: DingTalkToolSpec;
  readonly stage: DingTalkTargetMinutesStage;
  readonly arguments: Record<string, unknown>;
}

export interface DingTalkTargetMinutesFailure {
  readonly toolName: string;
  readonly canonicalPath: string;
  readonly stage: "schema" | "arguments" | DingTalkTargetMinutesStage;
  readonly error: Record<string, unknown>;
}

export interface DingTalkTargetMinutesResult {
  readonly status: "passed" | "preflight_failed" | "read_failed";
  readonly checkedCount: 4;
  readonly schemaVerifiedCount: number;
  readonly argumentValidatedCount: number;
  readonly readAttemptedCount: number;
  readonly passedCount: number;
  readonly unattemptedCount: number;
  readonly completedStages: readonly DingTalkTargetMinutesStage[];
  readonly writeExecuted: false;
  readonly businessPayloadRetained: false;
  readonly sameTaskVerified: boolean;
  readonly transcriptComplete: boolean;
  readonly searchMatchCount?: number;
  readonly transcriptPages?: number;
  readonly transcriptParagraphCount?: number;
  readonly transcriptDuplicateCount?: number;
  readonly actionItemCount?: number;
  readonly failures: readonly DingTalkTargetMinutesFailure[];
}

function invalidFixture(field: string): never {
  throw new DingTalkRuntimeError(
    "DWS_MINUTES_PREFLIGHT_INVALID",
    "Target Minutes preflight input is invalid",
    { fields: [field] },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const expectedSet = new Set(expected);
  if (
    Object.keys(value).length !== expected.length
    || Object.keys(value).some((key) => !expectedSet.has(key))
  ) {
    invalidFixture("fixture");
  }
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") invalidFixture(field);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) invalidFixture(field);
  return normalized;
}

export function validateMinutesReadAcknowledgement(value: unknown): void {
  if (value !== DINGTALK_MINUTES_READ_ACKNOWLEDGEMENT) {
    invalidFixture("acknowledgement");
  }
}

export function parseDingTalkTargetMinutesPreflightArguments(
  argv: readonly string[],
): DingTalkTargetMinutesCliInput {
  const allowed = new Set([
    "--dws-path",
    "--profile",
    "--acknowledge-sensitive-read",
  ]);
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !allowed.has(flag)) invalidFixture("arguments");
    if (!value || values.has(flag)) invalidFixture("arguments");
    values.set(flag, value);
  }
  const dwsPath = values.get("--dws-path");
  const profile = values.get("--profile");
  const acknowledgement = values.get("--acknowledge-sensitive-read");
  if (!dwsPath || !path.isAbsolute(dwsPath)) invalidFixture("dwsPath");
  if (!profile) invalidFixture("profile");
  if (!acknowledgement) invalidFixture("acknowledgement");
  return { dwsPath, profile, acknowledgement };
}

export function parseDingTalkTargetMinutesFixture(
  value: unknown,
): DingTalkTargetMinutesFixture {
  if (!isRecord(value)) invalidFixture("fixture");
  exactKeys(value, ["query", "taskId"]);
  const query = boundedText(value.query, "query", 256);
  const taskId = boundedText(value.taskId, "taskId", 512);
  if (/\s/u.test(taskId)) invalidFixture("taskId");
  return { query, taskId };
}

function minutesSpec(name: string): DingTalkToolSpec {
  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  if (
    !spec
    || spec.domain !== "minutes"
    || spec.effect !== "read"
    || spec.risk !== "low"
    || spec.confirmation !== "not_required"
    || spec.idempotency !== "idempotent"
  ) {
    throw new TypeError(`Target Minutes tool safety contract is invalid: ${name}`);
  }
  return spec;
}

function buildPlans(fixture: DingTalkTargetMinutesFixture): readonly MinutesPlan[] {
  return [
    {
      spec: minutesSpec("junqi_dingtalk_minutes_search"),
      stage: "search",
      arguments: {
        query: fixture.query,
        scope: "all",
        "page-all": true,
        "page-limit": 100,
      },
    },
    {
      spec: minutesSpec("junqi_dingtalk_minutes_detail"),
      stage: "detail",
      arguments: {
        id: fixture.taskId,
        artifacts: ["basic", "summary", "keywords"],
      },
    },
    {
      spec: minutesSpec("junqi_dingtalk_minutes_transcript"),
      stage: "transcript",
      arguments: { id: fixture.taskId, "page-limit": 100 },
    },
    {
      spec: minutesSpec("junqi_dingtalk_minutes_action_items"),
      stage: "action_items",
      arguments: { id: fixture.taskId },
    },
  ];
}

function invalidResult(): never {
  throw new DingTalkRuntimeError(
    "DWS_RESULT_INVALID",
    "DWS Minutes preflight result did not prove the expected bounded workflow",
  );
}

function requireSearchResult(data: unknown, taskId: string): number {
  if (!isRecord(data) || !Array.isArray(data.minutes)) invalidResult();
  if (
    data.complete !== true
    || data.scope !== "all"
    || !Number.isSafeInteger(data.count)
    || data.count !== data.minutes.length
    || !Number.isSafeInteger(data.pages)
    || Number(data.pages) < 1
    || data.minutes.length !== 1
    || !isRecord(data.minutes[0])
    || data.minutes[0].taskUuid !== taskId
  ) {
    invalidResult();
  }
  return data.minutes.length;
}

function requireDetailResult(data: unknown, taskId: string): void {
  if (
    !isRecord(data)
    || data.taskUuid !== taskId
    || data.complete !== true
    || data.failureCount !== 0
    || !isRecord(data.basic)
    || !isRecord(data.summary)
    || !isRecord(data.keywords)
  ) {
    invalidResult();
  }
}

function requireActionItemsResult(data: unknown): number {
  if (!isRecord(data)) invalidResult();
  const actions = Array.isArray(data.actions)
    ? data.actions
    : Array.isArray(data.dingtalkTodoList)
      ? data.dingtalkTodoList
      : null;
  if (!actions) invalidResult();
  return actions.length;
}

function baseResult(
  status: DingTalkTargetMinutesResult["status"],
  schemaVerifiedCount: number,
  argumentValidatedCount: number,
  readAttemptedCount: number,
  passedCount: number,
  completedStages: readonly DingTalkTargetMinutesStage[],
  failures: readonly DingTalkTargetMinutesFailure[],
): DingTalkTargetMinutesResult {
  return {
    status,
    checkedCount: 4,
    schemaVerifiedCount,
    argumentValidatedCount,
    readAttemptedCount,
    passedCount,
    unattemptedCount: 4 - passedCount - failures.length,
    completedStages,
    writeExecuted: false,
    businessPayloadRetained: false,
    sameTaskVerified: completedStages.includes("transcript"),
    transcriptComplete: completedStages.includes("transcript"),
    failures,
  };
}

export async function runDingTalkTargetMinutesPreflight(
  schemas: MinutesPreflightSchemas,
  runner: MinutesPreflightRunner,
  profileInput: unknown,
  acknowledgementInput: unknown,
  fixtureInput: unknown,
): Promise<DingTalkTargetMinutesResult> {
  validateMinutesReadAcknowledgement(acknowledgementInput);
  const profile = validateProfileReference(profileInput);
  const fixture = parseDingTalkTargetMinutesFixture(fixtureInput);
  const plans = buildPlans(fixture);
  const schemasByToolName = new Map<string, DwsLeafSchema>();
  const failures: DingTalkTargetMinutesFailure[] = [];

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
    return baseResult("preflight_failed", 4 - failures.length, 0, 0, 0, [], failures);
  }

  const commands: Array<{ readonly plan: MinutesPlan; readonly command: readonly string[] }> = [];
  for (const plan of plans) {
    try {
      const schema = schemasByToolName.get(plan.spec.name);
      if (!schema) throw new TypeError(`Verified schema is missing: ${plan.spec.name}`);
      validateDingTalkInvocationPolicy(plan.spec, plan.arguments);
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
    return baseResult("preflight_failed", 4, 4 - failures.length, 0, 0, [], failures);
  }

  const completedStages: DingTalkTargetMinutesStage[] = [];
  let readAttemptedCount = 0;
  let searchMatchCount: number | undefined;
  let transcriptPages: number | undefined;
  let transcriptParagraphCount: number | undefined;
  let transcriptDuplicateCount: number | undefined;
  let actionItemCount: number | undefined;

  for (const { plan, command } of commands) {
    readAttemptedCount += 1;
    try {
      const result = await runner.run(command, { profile });
      if (plan.stage === "search") {
        searchMatchCount = requireSearchResult(requireDwsSuccessResult(result), fixture.taskId);
      } else if (plan.stage === "detail") {
        requireDetailResult(requireDwsSuccessResult(result), fixture.taskId);
      } else if (plan.stage === "transcript") {
        const transcript = assertDingTalkReadResult(plan.spec, result, plan.arguments);
        if (!isRecord(transcript)) invalidResult();
        transcriptPages = Number(transcript.pages);
        transcriptParagraphCount = Number(transcript.paragraphCount);
        transcriptDuplicateCount = Number(transcript.duplicateCount);
      } else {
        actionItemCount = requireActionItemsResult(requireDwsSuccessResult(result));
      }
      completedStages.push(plan.stage);
    } catch (error) {
      failures.push({
        toolName: plan.spec.name,
        canonicalPath: plan.spec.canonicalPath,
        stage: plan.stage,
        error: serializeRuntimeError(error),
      });
      break;
    }
  }

  return {
    ...baseResult(
      failures.length === 0 ? "passed" : "read_failed",
      4,
      4,
      readAttemptedCount,
      completedStages.length,
      completedStages,
      failures,
    ),
    ...(searchMatchCount !== undefined ? { searchMatchCount } : {}),
    ...(transcriptPages !== undefined ? { transcriptPages } : {}),
    ...(transcriptParagraphCount !== undefined ? { transcriptParagraphCount } : {}),
    ...(transcriptDuplicateCount !== undefined ? { transcriptDuplicateCount } : {}),
    ...(actionItemCount !== undefined ? { actionItemCount } : {}),
  };
}
