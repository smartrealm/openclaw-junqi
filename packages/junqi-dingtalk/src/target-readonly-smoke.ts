import { serializeRuntimeError } from "./errors.js";
import { validateProfileReference } from "./dws-runner.js";
import { requireDwsSuccessResult } from "./dws-result.js";
import { buildSchemaValidatedArguments } from "./schema-contract.js";
import { DINGTALK_TOOL_SPEC_BY_NAME } from "./tool-specs.js";
import type { DwsCommandResult, DwsLeafSchema, DingTalkToolSpec } from "./types.js";

export type DingTalkTargetReadonlySmokeScope = "core" | "extended";

const CORE_READONLY_SMOKE_TOOL_NAMES = [
  "junqi_dingtalk_contact_me",
  "junqi_dingtalk_calendar_today",
  "junqi_dingtalk_todo_overdue",
  "junqi_dingtalk_todo_due_today",
  "junqi_dingtalk_approval_pending",
] as const;

export const DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE = {
  core: CORE_READONLY_SMOKE_TOOL_NAMES,
  extended: [
    ...CORE_READONLY_SMOKE_TOOL_NAMES,
    "junqi_dingtalk_minutes_latest",
    "junqi_dingtalk_wiki_spaces",
    "junqi_dingtalk_report_latest",
    "junqi_dingtalk_mail_triage",
    "junqi_dingtalk_chat_unread",
    "junqi_dingtalk_recruit_jobs",
    "junqi_dingtalk_goal_user_rules",
  ],
} as const satisfies Record<DingTalkTargetReadonlySmokeScope, readonly string[]>;

interface ReadonlySmokeRunner {
  run(
    command: readonly string[],
    options?: { profile?: string },
  ): Promise<DwsCommandResult>;
}

interface ReadonlySmokeSchemas {
  verify(spec: DingTalkToolSpec): Promise<{ readonly schema: DwsLeafSchema }>;
}

export interface DingTalkTargetReadonlySmokeFailure {
  readonly toolName: string;
  readonly canonicalPath: string;
  readonly error: Record<string, unknown>;
}

export interface DingTalkTargetReadonlySmokeResult {
  readonly scope: DingTalkTargetReadonlySmokeScope;
  readonly checkedCount: number;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly failures: readonly DingTalkTargetReadonlySmokeFailure[];
}

export async function runDingTalkTargetReadonlySmoke(
  schemas: ReadonlySmokeSchemas,
  runner: ReadonlySmokeRunner,
  profileInput: unknown,
  scopeInput: unknown,
): Promise<DingTalkTargetReadonlySmokeResult> {
  const profile = validateProfileReference(profileInput);
  if (scopeInput !== "core" && scopeInput !== "extended") {
    throw new TypeError("Readonly smoke scope must be core or extended");
  }
  const scope = scopeInput;
  const toolNames = DINGTALK_TARGET_READONLY_SMOKE_TOOL_NAMES_BY_SCOPE[scope];
  const failures: DingTalkTargetReadonlySmokeFailure[] = [];

  for (const toolName of toolNames) {
    const spec = DINGTALK_TOOL_SPEC_BY_NAME.get(toolName);
    if (
      !spec
      || spec.effect !== "read"
      || spec.risk !== "low"
      || spec.confirmation !== "not_required"
      || spec.idempotency !== "idempotent"
    ) {
      throw new TypeError(`Readonly smoke tool contract is invalid: ${toolName}`);
    }
    try {
      const verified = await schemas.verify(spec);
      const command = [
        ...spec.cliPath.split(" "),
        ...buildSchemaValidatedArguments(verified.schema, {}),
      ];
      requireDwsSuccessResult(await runner.run(command, { profile }));
    } catch (error) {
      failures.push({
        toolName: spec.name,
        canonicalPath: spec.canonicalPath,
        error: serializeRuntimeError(error),
      });
    }
  }

  return {
    scope,
    checkedCount: toolNames.length,
    passedCount: toolNames.length - failures.length,
    failedCount: failures.length,
    failures,
  };
}
