export type CronSessionTarget = 'main' | 'isolated' | 'current' | `session:${string}`;
export type CronWakeMode = 'next-heartbeat' | 'now';

// OpenClaw 官方 Cron Schema 使用 ECMAScript Date 可表示的闭区间。
export const OPENCLAW_CRON_MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number }
  | { kind: 'on-exit'; command: string; cwd?: string }
  | {
    kind: 'stream';
    command: string[];
    cwd?: string;
    mode?: 'line' | 'match';
    match?: string;
    batchMs?: number;
    maxBatchBytes?: number;
  };

export interface CronAgentTurnPayload {
  kind: 'agentTurn';
  message: string;
}

export interface CronAgentTurnAddParams {
  name: string;
  declarationKey?: string;
  agentId?: string;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payload: CronAgentTurnPayload;
  delivery?: { mode: 'none' };
}

export interface BuildCronAgentTurnParams {
  name: string;
  message: string;
  schedule: CronSchedule;
  declarationKey?: string;
  agentId?: string | null;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
}

/**
 * 为一次桌面端创建意图生成官方声明键。调用方必须在结果未知时复用该值，
 * 由 Gateway 收敛重复提交，而不是以本地重试创建第二个任务。
 */
export function createCronDeclarationKey(
  prefix: string,
  randomUuid: (() => string) | undefined = undefined,
): string {
  const normalizedPrefix = prefix.trim();
  const generateUuid = randomUuid ?? (() => {
    const randomUuidFromRuntime = globalThis.crypto?.randomUUID;
    if (typeof randomUuidFromRuntime !== 'function') {
      throw new Error('当前桌面运行时无法生成 OpenClaw Cron 声明键。');
    }
    return randomUuidFromRuntime.call(globalThis.crypto);
  });
  const uuid = generateUuid().trim();
  if (!normalizedPrefix || !uuid) {
    throw new Error('无法为 OpenClaw Cron 创建生成声明键。');
  }
  return `${normalizedPrefix}:${uuid}`;
}

/** 同一次未确认创建必须复用原声明键，避免未知写入结果产生副本。 */
export function resolveCronDeclarationKey(
  current: string | null | undefined,
  prefix: string,
  randomUuid?: () => string,
): string {
  return current?.trim() || createCronDeclarationKey(prefix, randomUuid);
}

export function normalizeCronAgentId(agentId: string | null | undefined): string | undefined {
  const normalized = agentId?.trim();
  return normalized || undefined;
}

function assertCronDateInteger(value: number, field: string, minimum: number): void {
  if (!Number.isInteger(value)
    || value < minimum
    || value > OPENCLAW_CRON_MAX_DATE_TIMESTAMP_MS) {
    throw new Error(`cron.add received an invalid ${field}`);
  }
}

export function validateCronSchedule(schedule: CronSchedule): CronSchedule {
  if (schedule.kind === 'every') {
    assertCronDateInteger(schedule.everyMs, 'schedule.everyMs', 1);
    if (schedule.anchorMs !== undefined) {
      assertCronDateInteger(schedule.anchorMs, 'schedule.anchorMs', 0);
    }
  } else if (schedule.kind === 'cron' && schedule.staggerMs !== undefined) {
    assertCronDateInteger(schedule.staggerMs, 'schedule.staggerMs', 0);
  }
  return schedule;
}

export function buildCronAgentTurnAddParams(
  input: BuildCronAgentTurnParams,
): CronAgentTurnAddParams {
  const agentId = normalizeCronAgentId(input.agentId);
  const declarationKey = input.declarationKey?.trim();
  return {
    name: input.name.trim(),
    ...(declarationKey ? { declarationKey } : {}),
    ...(agentId ? { agentId } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.deleteAfterRun !== undefined ? { deleteAfterRun: input.deleteAfterRun } : {}),
    schedule: validateCronSchedule(input.schedule),
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: {
      kind: 'agentTurn',
      message: input.message.trim(),
    },
    delivery: { mode: 'none' },
  };
}

export function cronAgentUpdatePatch(agentId: string | null | undefined): { agentId: string | null } {
  return { agentId: normalizeCronAgentId(agentId) ?? null };
}

export function isCronAgentSelectionConfirmed(
  jobs: ReadonlyArray<{ id: string; agentId?: string }>,
  jobId: string,
  requestedAgentId: string | null | undefined,
): boolean {
  const job = jobs.find((candidate) => candidate.id === jobId);
  return Boolean(job)
    && normalizeCronAgentId(job?.agentId) === normalizeCronAgentId(requestedAgentId);
}
