export type CronSessionTarget = 'main' | 'isolated' | 'current' | `session:${string}`;
export type CronWakeMode = 'next-heartbeat' | 'now';

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
  agentId?: string | null;
  description?: string;
  enabled?: boolean;
  deleteAfterRun?: boolean;
}

export function normalizeCronAgentId(agentId: string | null | undefined): string | undefined {
  const normalized = agentId?.trim();
  return normalized || undefined;
}

export function buildCronAgentTurnAddParams(
  input: BuildCronAgentTurnParams,
): CronAgentTurnAddParams {
  const agentId = normalizeCronAgentId(input.agentId);
  return {
    name: input.name.trim(),
    ...(agentId ? { agentId } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    ...(input.deleteAfterRun !== undefined ? { deleteAfterRun: input.deleteAfterRun } : {}),
    schedule: input.schedule,
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
