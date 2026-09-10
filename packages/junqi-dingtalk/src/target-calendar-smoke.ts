import { serializeRuntimeError } from "./errors.js";
import { validateProfileReference } from "./dws-runner.js";
import { buildSchemaValidatedArguments } from "./schema-contract.js";
import {
  runDingTalkTargetReadonlySmoke,
  type DingTalkTargetReadonlySmokeResult,
} from "./target-readonly-smoke.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import { reconcileDingTalkWrite } from "./write-reconciliation.js";
import type {
  DingTalkToolSpec,
  DingTalkWriteVerification,
  DwsCommandResult,
  DwsLeafSchema,
} from "./types.js";

export const DINGTALK_TARGET_CALENDAR_SMOKE_TOOL_NAMES = [
  "junqi_dingtalk_calendar_create",
  "junqi_dingtalk_calendar_update",
  "junqi_dingtalk_calendar_cancel",
] as const;

export const DINGTALK_TARGET_CALENDAR_SMOKE_ACKNOWLEDGEMENT = "calendar-create-update-cancel";

const TARGET_CALENDAR_REQUIRED_FLAGS = [
  "--dws-path",
  "--profile",
  "--title",
  "--updated-title",
  "--start",
  "--end",
  "--acknowledge-writes",
] as const;
const TARGET_CALENDAR_OPTIONAL_FLAGS = ["--timezone"] as const;
const TARGET_CALENDAR_ALLOWED_FLAGS = new Set<string>([
  ...TARGET_CALENDAR_REQUIRED_FLAGS,
  ...TARGET_CALENDAR_OPTIONAL_FLAGS,
]);

export type DingTalkTargetCalendarSmokeStep = "create" | "update" | "cancel";

interface CalendarSmokeRunner {
  run(
    command: readonly string[],
    options?: { profile?: string; confirmed?: boolean; sideEffect?: boolean },
  ): Promise<DwsCommandResult>;
}

interface CalendarSmokeSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema; readonly digest: string }>;
}

export interface DingTalkTargetCalendarSmokeInput {
  readonly profile: unknown;
  readonly title: unknown;
  readonly updatedTitle: unknown;
  readonly start: unknown;
  readonly end: unknown;
  readonly timezone?: unknown;
}

export interface DingTalkTargetCalendarSmokeCliInput extends DingTalkTargetCalendarSmokeInput {
  readonly dwsPath: string;
}

export interface DingTalkTargetCalendarSmokeResult {
  readonly status: "verified" | "failed_before_write" | "unknown";
  readonly checkedContractCount: number;
  readonly readonlyPreflight?: DingTalkTargetReadonlySmokeResult;
  readonly completedSteps: readonly DingTalkTargetCalendarSmokeStep[];
  readonly failedStage?: "contract" | "readonly_preflight" | DingTalkTargetCalendarSmokeStep;
  readonly resourceId?: string;
  readonly verificationStatus?: DingTalkWriteVerification["status"];
  readonly reasonCode?: string;
  readonly error?: Record<string, unknown>;
  readonly recovery:
    | "none"
    | "fix_contract_before_retry"
    | "fix_read_access_before_retry"
    | "inspect_by_unique_title_before_any_retry"
    | "inspect_exact_event_before_any_action";
}

interface VerifiedCalendarContract {
  readonly spec: DingTalkToolSpec;
  readonly schema: DwsLeafSchema;
  readonly digest: string;
}

function calendarSpec(name: string): DingTalkToolSpec {
  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  const expectedEffect = name === "junqi_dingtalk_calendar_cancel" ? "destructive" : "write";
  if (!spec
    || spec.domain !== "calendar"
    || spec.confirmation !== "user_required"
    || spec.idempotency !== "unknown"
    || spec.effect !== expectedEffect) {
    throw new TypeError(`Target calendar smoke tool contract is invalid: ${name}`);
  }
  return spec;
}

export function parseDingTalkTargetCalendarSmokeArguments(
  argv: readonly string[],
): DingTalkTargetCalendarSmokeCliInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !TARGET_CALENDAR_ALLOWED_FLAGS.has(flag)) {
      throw new TypeError("Target calendar smoke contains an unsupported argument");
    }
    if (!value) {
      throw new TypeError("Target calendar smoke argument value is missing");
    }
    if (values.has(flag)) {
      throw new TypeError("Target calendar smoke contains a duplicate argument");
    }
    values.set(flag, value);
  }
  for (const flag of TARGET_CALENDAR_REQUIRED_FLAGS) {
    if (!values.has(flag)) {
      throw new TypeError("Target calendar smoke required argument is missing");
    }
  }
  if (values.get("--acknowledge-writes") !== DINGTALK_TARGET_CALENDAR_SMOKE_ACKNOWLEDGEMENT) {
    throw new TypeError("Target calendar smoke acknowledgement is invalid");
  }
  const dwsPath = values.get("--dws-path");
  const profile = values.get("--profile");
  const title = values.get("--title");
  const updatedTitle = values.get("--updated-title");
  const start = values.get("--start");
  const end = values.get("--end");
  if (!dwsPath || !profile || !title || !updatedTitle || !start || !end) {
    throw new TypeError("Target calendar smoke required argument is empty");
  }
  const timezone = values.get("--timezone");
  return {
    dwsPath,
    profile,
    title,
    updatedTitle,
    start,
    end,
    ...(timezone ? { timezone } : {}),
  };
}

function nonemptyText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Target calendar smoke requires non-empty text inputs");
  }
  return value.trim();
}

function inputArguments(input: DingTalkTargetCalendarSmokeInput): {
  readonly title: string;
  readonly updatedTitle: string;
  readonly start: string;
  readonly end: string;
  readonly timezone?: string;
} {
  const title = nonemptyText(input.title);
  const updatedTitle = nonemptyText(input.updatedTitle);
  if (title === updatedTitle) {
    throw new TypeError("Target calendar smoke titles must differ");
  }
  const timezone = input.timezone === undefined ? undefined : nonemptyText(input.timezone);
  return {
    title,
    updatedTitle,
    start: nonemptyText(input.start),
    end: nonemptyText(input.end),
    ...(timezone ? { timezone } : {}),
  };
}

async function verifyCalendarContracts(
  schemas: CalendarSmokeSchemas,
): Promise<ReadonlyMap<string, VerifiedCalendarContract>> {
  const contracts = new Map<string, VerifiedCalendarContract>();
  for (const name of DINGTALK_TARGET_CALENDAR_SMOKE_TOOL_NAMES) {
    const spec = calendarSpec(name);
    const verified = await schemas.verify(spec);
    contracts.set(name, { spec, ...verified });
  }
  return contracts;
}

function requiredContract(
  contracts: ReadonlyMap<string, VerifiedCalendarContract>,
  name: string,
): VerifiedCalendarContract {
  const contract = contracts.get(name);
  if (!contract) throw new TypeError(`Target calendar smoke contract is missing: ${name}`);
  return contract;
}

function failureReason(verification: DingTalkWriteVerification): string {
  return verification.reasonCode ?? "DWS_WRITE_VERIFICATION_MISSING";
}

export async function runDingTalkTargetCalendarSmoke(
  schemas: CalendarSmokeSchemas,
  runner: CalendarSmokeRunner,
  rawInput: DingTalkTargetCalendarSmokeInput,
): Promise<DingTalkTargetCalendarSmokeResult> {
  let profile: string;
  let input: ReturnType<typeof inputArguments>;
  let contracts: ReadonlyMap<string, VerifiedCalendarContract>;
  try {
    profile = validateProfileReference(rawInput.profile);
    input = inputArguments(rawInput);
    contracts = await verifyCalendarContracts(schemas);
    const create = requiredContract(contracts, "junqi_dingtalk_calendar_create");
    const update = requiredContract(contracts, "junqi_dingtalk_calendar_update");
    const cancel = requiredContract(contracts, "junqi_dingtalk_calendar_cancel");
    buildSchemaValidatedArguments(create.schema, {
      title: input.title,
      start: input.start,
      end: input.end,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    });
    buildSchemaValidatedArguments(update.schema, {
      event: "calendar-smoke-preflight-event",
      title: input.updatedTitle,
    });
    buildSchemaValidatedArguments(cancel.schema, {
      event: "calendar-smoke-preflight-event",
    });
  } catch (error) {
    return {
      status: "failed_before_write",
      checkedContractCount: 0,
      completedSteps: [],
      failedStage: "contract",
      error: serializeRuntimeError(error),
      recovery: "fix_contract_before_retry",
    };
  }

  const readonlyPreflight = await runDingTalkTargetReadonlySmoke(
    schemas,
    runner,
    profile,
    "core",
  );
  if (readonlyPreflight.failedCount > 0) {
    return {
      status: "failed_before_write",
      checkedContractCount: contracts.size,
      readonlyPreflight,
      completedSteps: [],
      failedStage: "readonly_preflight",
      recovery: "fix_read_access_before_retry",
    };
  }

  const completedSteps: DingTalkTargetCalendarSmokeStep[] = [];
  let eventId: string | undefined;
  const stages: ReadonlyArray<{
    readonly step: DingTalkTargetCalendarSmokeStep;
    readonly toolName: string;
    readonly arguments: () => Record<string, unknown>;
  }> = [
    {
      step: "create",
      toolName: "junqi_dingtalk_calendar_create",
      arguments: () => ({
        title: input.title,
        start: input.start,
        end: input.end,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      }),
    },
    {
      step: "update",
      toolName: "junqi_dingtalk_calendar_update",
      arguments: () => ({ event: eventId, title: input.updatedTitle }),
    },
    {
      step: "cancel",
      toolName: "junqi_dingtalk_calendar_cancel",
      arguments: () => ({ event: eventId }),
    },
  ];

  for (const stage of stages) {
    const contract = requiredContract(contracts, stage.toolName);
    const argumentsValue = stage.arguments();
    let writeResult: DwsCommandResult;
    try {
      writeResult = await runner.run(
        [
          ...contract.spec.cliPath.split(" "),
          ...buildSchemaValidatedArguments(contract.schema, argumentsValue),
        ],
        { profile, confirmed: true, sideEffect: true },
      );
    } catch (error) {
      return {
        status: "unknown",
        checkedContractCount: contracts.size,
        readonlyPreflight,
        completedSteps,
        failedStage: stage.step,
        ...(eventId ? { resourceId: eventId } : {}),
        error: serializeRuntimeError(error),
        recovery: eventId
          ? "inspect_exact_event_before_any_action"
          : "inspect_by_unique_title_before_any_retry",
      };
    }

    const verification = await reconcileDingTalkWrite({
      spec: contract.spec,
      profile,
      arguments: argumentsValue,
      writeResult,
      writeSchemaDigest: contract.digest,
      schemas,
      runner,
    });
    if (verification.status !== "verified" || !verification.resourceId) {
      return {
        status: "unknown",
        checkedContractCount: contracts.size,
        readonlyPreflight,
        completedSteps,
        failedStage: stage.step,
        ...(eventId || verification.resourceId
          ? { resourceId: eventId ?? verification.resourceId }
          : {}),
        verificationStatus: verification.status,
        reasonCode: failureReason(verification),
        recovery: eventId
          ? "inspect_exact_event_before_any_action"
          : "inspect_by_unique_title_before_any_retry",
      };
    }
    if (eventId && verification.resourceId !== eventId) {
      return {
        status: "unknown",
        checkedContractCount: contracts.size,
        readonlyPreflight,
        completedSteps,
        failedStage: stage.step,
        resourceId: eventId,
        verificationStatus: verification.status,
        reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
        recovery: "inspect_exact_event_before_any_action",
      };
    }
    eventId = verification.resourceId;
    completedSteps.push(stage.step);
  }

  if (!eventId) {
    return {
      status: "unknown",
      checkedContractCount: contracts.size,
      readonlyPreflight,
      completedSteps,
      failedStage: "cancel",
      reasonCode: "DWS_WRITE_RESOURCE_ID_MISSING",
      recovery: "inspect_by_unique_title_before_any_retry",
    };
  }

  return {
    status: "verified",
    checkedContractCount: contracts.size,
    readonlyPreflight,
    completedSteps,
    resourceId: eventId,
    verificationStatus: "verified",
    recovery: "none",
  };
}
