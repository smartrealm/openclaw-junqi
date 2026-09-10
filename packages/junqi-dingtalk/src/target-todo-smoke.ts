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

export const DINGTALK_TARGET_TODO_SMOKE_TOOL_NAMES = [
  "junqi_dingtalk_todo_create",
  "junqi_dingtalk_todo_update",
  "junqi_dingtalk_todo_complete",
  "junqi_dingtalk_todo_reopen",
] as const;

export const DINGTALK_TARGET_TODO_SMOKE_ACKNOWLEDGEMENT = "todo-create-update-complete-reopen-complete";

const TARGET_TODO_REQUIRED_FLAGS = [
  "--dws-path",
  "--profile",
  "--executor",
  "--title",
  "--updated-title",
  "--acknowledge-writes",
] as const;
const TARGET_TODO_ALLOWED_FLAGS = new Set<string>(TARGET_TODO_REQUIRED_FLAGS);

export type DingTalkTargetTodoSmokeStep =
  | "create"
  | "update"
  | "complete_initial"
  | "reopen"
  | "complete_final";

interface TodoSmokeRunner {
  run(
    command: readonly string[],
    options?: { profile?: string; confirmed?: boolean; sideEffect?: boolean },
  ): Promise<DwsCommandResult>;
}

interface TodoSmokeSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema; readonly digest: string }>;
}

export interface DingTalkTargetTodoSmokeInput {
  readonly profile: unknown;
  readonly executor: unknown;
  readonly title: unknown;
  readonly updatedTitle: unknown;
}

export interface DingTalkTargetTodoSmokeCliInput extends DingTalkTargetTodoSmokeInput {
  readonly dwsPath: string;
}

export interface DingTalkTargetTodoSmokeResult {
  readonly status: "verified" | "failed_before_write" | "unknown";
  readonly checkedContractCount: number;
  readonly readonlyPreflight?: DingTalkTargetReadonlySmokeResult;
  readonly completedSteps: readonly DingTalkTargetTodoSmokeStep[];
  readonly failedStage?: "contract" | "readonly_preflight" | DingTalkTargetTodoSmokeStep;
  readonly resourceId?: string;
  readonly verificationStatus?: DingTalkWriteVerification["status"];
  readonly reasonCode?: string;
  readonly error?: Record<string, unknown>;
  readonly recovery:
    | "none"
    | "fix_contract_before_retry"
    | "fix_read_access_before_retry"
    | "inspect_by_unique_title_before_any_retry"
    | "inspect_exact_task_before_any_action";
}

interface VerifiedTodoContract {
  readonly spec: DingTalkToolSpec;
  readonly schema: DwsLeafSchema;
  readonly digest: string;
}

function todoSpec(name: string): DingTalkToolSpec {
  const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(name);
  const expectedIdempotency = name === "junqi_dingtalk_todo_create"
    ? "non_idempotent"
    : "idempotent";
  if (!spec
    || spec.domain !== "todo"
    || spec.effect !== "write"
    || spec.risk !== "medium"
    || spec.confirmation !== "user_required"
    || spec.idempotency !== expectedIdempotency) {
    throw new TypeError(`Target Todo smoke tool contract is invalid: ${name}`);
  }
  return spec;
}

function nonemptyText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError("Target Todo smoke requires non-empty text inputs");
  }
  return value.trim();
}

export function parseDingTalkTargetTodoSmokeArguments(
  argv: readonly string[],
): DingTalkTargetTodoSmokeCliInput {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || !TARGET_TODO_ALLOWED_FLAGS.has(flag)) {
      throw new TypeError("Target Todo smoke contains an unsupported argument");
    }
    if (!value) {
      throw new TypeError("Target Todo smoke argument value is missing");
    }
    if (values.has(flag)) {
      throw new TypeError("Target Todo smoke contains a duplicate argument");
    }
    values.set(flag, value);
  }
  for (const flag of TARGET_TODO_REQUIRED_FLAGS) {
    if (!values.has(flag)) {
      throw new TypeError("Target Todo smoke required argument is missing");
    }
  }
  if (values.get("--acknowledge-writes") !== DINGTALK_TARGET_TODO_SMOKE_ACKNOWLEDGEMENT) {
    throw new TypeError("Target Todo smoke acknowledgement is invalid");
  }
  const dwsPath = values.get("--dws-path");
  const profile = values.get("--profile");
  const executor = values.get("--executor");
  const title = values.get("--title");
  const updatedTitle = values.get("--updated-title");
  if (!dwsPath || !profile || !executor || !title || !updatedTitle) {
    throw new TypeError("Target Todo smoke required argument is empty");
  }
  return { dwsPath, profile, executor, title, updatedTitle };
}

function inputArguments(input: DingTalkTargetTodoSmokeInput, profile: string): {
  readonly executor: string;
  readonly title: string;
  readonly updatedTitle: string;
} {
  const executor = nonemptyText(input.executor);
  const title = nonemptyText(input.title);
  const updatedTitle = nonemptyText(input.updatedTitle);
  if (title === updatedTitle) {
    throw new TypeError("Target Todo smoke titles must differ");
  }
  const profileUserId = profile.slice(profile.indexOf(":") + 1);
  if (executor !== profileUserId) {
    throw new TypeError("Target Todo smoke executor must match the Profile user");
  }
  return { executor, title, updatedTitle };
}

async function verifyTodoContracts(
  schemas: TodoSmokeSchemas,
): Promise<ReadonlyMap<string, VerifiedTodoContract>> {
  const contracts = new Map<string, VerifiedTodoContract>();
  for (const name of DINGTALK_TARGET_TODO_SMOKE_TOOL_NAMES) {
    const spec = todoSpec(name);
    const verified = await schemas.verify(spec);
    contracts.set(name, { spec, ...verified });
  }
  return contracts;
}

function requiredContract(
  contracts: ReadonlyMap<string, VerifiedTodoContract>,
  name: string,
): VerifiedTodoContract {
  const contract = contracts.get(name);
  if (!contract) throw new TypeError(`Target Todo smoke contract is missing: ${name}`);
  return contract;
}

function failureReason(verification: DingTalkWriteVerification): string {
  return verification.reasonCode ?? "DWS_WRITE_VERIFICATION_MISSING";
}

export async function runDingTalkTargetTodoSmoke(
  schemas: TodoSmokeSchemas,
  runner: TodoSmokeRunner,
  rawInput: DingTalkTargetTodoSmokeInput,
): Promise<DingTalkTargetTodoSmokeResult> {
  let profile: string;
  let input: ReturnType<typeof inputArguments>;
  let contracts: ReadonlyMap<string, VerifiedTodoContract>;
  try {
    profile = validateProfileReference(rawInput.profile);
    input = inputArguments(rawInput, profile);
    contracts = await verifyTodoContracts(schemas);
    const create = requiredContract(contracts, "junqi_dingtalk_todo_create");
    const update = requiredContract(contracts, "junqi_dingtalk_todo_update");
    const complete = requiredContract(contracts, "junqi_dingtalk_todo_complete");
    const reopen = requiredContract(contracts, "junqi_dingtalk_todo_reopen");
    buildSchemaValidatedArguments(create.schema, {
      title: input.title,
      executors: [input.executor],
    });
    buildSchemaValidatedArguments(update.schema, {
      "task-id": "todo-smoke-preflight-task",
      title: input.updatedTitle,
    });
    buildSchemaValidatedArguments(complete.schema, {
      "task-id": "todo-smoke-preflight-task",
    });
    buildSchemaValidatedArguments(reopen.schema, {
      "task-id": "todo-smoke-preflight-task",
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

  const completedSteps: DingTalkTargetTodoSmokeStep[] = [];
  let taskId: string | undefined;
  const stages: ReadonlyArray<{
    readonly step: DingTalkTargetTodoSmokeStep;
    readonly toolName: string;
    readonly arguments: () => Record<string, unknown>;
  }> = [
    {
      step: "create",
      toolName: "junqi_dingtalk_todo_create",
      arguments: () => ({ title: input.title, executors: [input.executor] }),
    },
    {
      step: "update",
      toolName: "junqi_dingtalk_todo_update",
      arguments: () => ({ "task-id": taskId, title: input.updatedTitle }),
    },
    {
      step: "complete_initial",
      toolName: "junqi_dingtalk_todo_complete",
      arguments: () => ({ "task-id": taskId }),
    },
    {
      step: "reopen",
      toolName: "junqi_dingtalk_todo_reopen",
      arguments: () => ({ "task-id": taskId }),
    },
    {
      step: "complete_final",
      toolName: "junqi_dingtalk_todo_complete",
      arguments: () => ({ "task-id": taskId }),
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
        ...(taskId ? { resourceId: taskId } : {}),
        error: serializeRuntimeError(error),
        recovery: taskId
          ? "inspect_exact_task_before_any_action"
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
        ...(taskId || verification.resourceId
          ? { resourceId: taskId ?? verification.resourceId }
          : {}),
        verificationStatus: verification.status,
        reasonCode: failureReason(verification),
        recovery: taskId
          ? "inspect_exact_task_before_any_action"
          : "inspect_by_unique_title_before_any_retry",
      };
    }
    if (taskId && verification.resourceId !== taskId) {
      return {
        status: "unknown",
        checkedContractCount: contracts.size,
        readonlyPreflight,
        completedSteps,
        failedStage: stage.step,
        resourceId: taskId,
        verificationStatus: verification.status,
        reasonCode: "DWS_WRITE_VERIFICATION_MISMATCH",
        recovery: "inspect_exact_task_before_any_action",
      };
    }
    taskId = verification.resourceId;
    completedSteps.push(stage.step);
  }

  if (!taskId) {
    return {
      status: "unknown",
      checkedContractCount: contracts.size,
      readonlyPreflight,
      completedSteps,
      failedStage: "complete_final",
      reasonCode: "DWS_WRITE_RESOURCE_ID_MISSING",
      recovery: "inspect_by_unique_title_before_any_retry",
    };
  }

  return {
    status: "verified",
    checkedContractCount: contracts.size,
    readonlyPreflight,
    completedSteps,
    resourceId: taskId,
    verificationStatus: "verified",
    recovery: "none",
  };
}
