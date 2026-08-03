export const CRON_RUN_STATUSES = ['ok', 'error', 'skipped'] as const;
export type CronRunStatus = (typeof CRON_RUN_STATUSES)[number];

export const CRON_DELIVERY_STATUSES = ['delivered', 'not-delivered', 'unknown', 'not-requested'] as const;
export type CronDeliveryStatus = (typeof CRON_DELIVERY_STATUSES)[number];

export type CronSessionTarget = 'main' | 'isolated' | 'current' | `session:${string}`;
export type CronWakeMode = 'next-heartbeat' | 'now';

export type CronScheduleDetails =
  | { kind: 'at'; at: string }
  | { kind: 'every'; everyMs: number; anchorMs?: number }
  | { kind: 'cron'; expr: string; tz?: string; staggerMs?: number }
  | { kind: 'on-exit'; command: string; cwd?: string };

export interface CronJobStateDetails {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastStatus?: CronRunStatus;
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
  consecutiveSkipped?: number;
  lastDelivered?: boolean;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
}

/** Safe read projection of the official CronJob response. Payload content is not retained. */
export interface OpenClawCronJobDetails {
  id: string;
  name: string;
  enabled: boolean;
  agentId?: string;
  sessionKey?: string;
  description?: string;
  deleteAfterRun?: boolean;
  createdAtMs: number;
  updatedAtMs: number;
  schedule: CronScheduleDetails;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payloadKind: 'systemEvent' | 'agentTurn' | 'command';
  state: CronJobStateDetails;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastRunError?: string;
  lastDelivered?: boolean;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
}

export interface CronRunsParams {
  jobId: string;
  runId?: string;
  limit?: number;
  sortDir?: 'asc' | 'desc';
}

export interface CronRunLogEntry {
  ts: number;
  jobId: string;
  action: 'finished';
  status?: CronRunStatus;
  error?: string;
  summary?: string;
  delivered?: boolean;
  deliveryStatus?: CronDeliveryStatus;
  deliveryError?: string;
  sessionId?: string;
  sessionKey?: string;
  runId?: string;
  runAtMs?: number;
  durationMs?: number;
  nextRunAtMs?: number;
  model?: string;
  provider?: string;
  jobName?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
  };
}

export interface CronRunsPage {
  entries: CronRunLogEntry[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
}

export interface CronRunEnqueueResult {
  ok: boolean;
  enqueued?: boolean;
  ran?: boolean;
  reason?: string;
  jobId?: string;
  runId?: string;
}

export class CronRunWaitTimeoutError extends Error {
  readonly code = 'CRON_RUN_WAIT_TIMEOUT';

  constructor(public readonly runId: string) {
    super(`cron.runs did not record run ${runId} before timeout`);
    this.name = 'CronRunWaitTimeoutError';
  }
}

interface CronRequester {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface CronRunWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string, method: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string, method: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${method} returned an invalid ${field}`);
  return value;
}

function requiredBoolean(value: unknown, field: string, method: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${method} returned an invalid ${field}`);
  return value;
}

function requiredInteger(value: unknown, field: string, method: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value as number;
}

function optionalNumber(value: unknown, field: string, method: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
  method: string,
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${method} returned an invalid ${field}`);
  }
  return value as T[number];
}

function parseSessionTarget(value: unknown, method: string): CronSessionTarget {
  if (value === 'main' || value === 'isolated' || value === 'current') return value;
  if (typeof value === 'string' && /^session:.+/.test(value)) return value as `session:${string}`;
  throw new Error(`${method} returned an invalid sessionTarget`);
}

function parseSchedule(value: unknown, method: string): CronScheduleDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid schedule`);
  const kind = value.kind;
  if (kind === 'at') {
    return { kind, at: requiredString(value.at, 'schedule.at', method) };
  }
  if (kind === 'every') {
    return {
      kind,
      everyMs: requiredInteger(value.everyMs, 'schedule.everyMs', method, 1),
      ...(value.anchorMs !== undefined
        ? { anchorMs: requiredInteger(value.anchorMs, 'schedule.anchorMs', method) }
        : {}),
    };
  }
  if (kind === 'cron') {
    return {
      kind,
      expr: requiredString(value.expr, 'schedule.expr', method),
      ...(value.tz !== undefined ? { tz: requiredString(value.tz, 'schedule.tz', method) } : {}),
      ...(value.staggerMs !== undefined
        ? { staggerMs: requiredInteger(value.staggerMs, 'schedule.staggerMs', method) }
        : {}),
    };
  }
  if (kind === 'on-exit') {
    return {
      kind,
      command: requiredString(value.command, 'schedule.command', method),
      ...(value.cwd !== undefined ? { cwd: requiredString(value.cwd, 'schedule.cwd', method) } : {}),
    };
  }
  throw new Error(`${method} returned an invalid schedule.kind`);
}

function parseJobState(value: unknown, method: string): CronJobStateDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid state`);
  return {
    ...(value.nextRunAtMs !== undefined ? { nextRunAtMs: requiredInteger(value.nextRunAtMs, 'state.nextRunAtMs', method) } : {}),
    ...(value.runningAtMs !== undefined ? { runningAtMs: requiredInteger(value.runningAtMs, 'state.runningAtMs', method) } : {}),
    ...(value.lastRunAtMs !== undefined ? { lastRunAtMs: requiredInteger(value.lastRunAtMs, 'state.lastRunAtMs', method) } : {}),
    ...(value.lastRunStatus !== undefined ? { lastRunStatus: oneOf(value.lastRunStatus, CRON_RUN_STATUSES, 'state.lastRunStatus', method) } : {}),
    ...(value.lastStatus !== undefined ? { lastStatus: oneOf(value.lastStatus, CRON_RUN_STATUSES, 'state.lastStatus', method) } : {}),
    ...(value.lastError !== undefined ? { lastError: optionalString(value.lastError, 'state.lastError', method) } : {}),
    ...(value.lastDurationMs !== undefined ? { lastDurationMs: requiredInteger(value.lastDurationMs, 'state.lastDurationMs', method) } : {}),
    ...(value.consecutiveErrors !== undefined ? { consecutiveErrors: requiredInteger(value.consecutiveErrors, 'state.consecutiveErrors', method) } : {}),
    ...(value.consecutiveSkipped !== undefined ? { consecutiveSkipped: requiredInteger(value.consecutiveSkipped, 'state.consecutiveSkipped', method) } : {}),
    ...(value.lastDelivered !== undefined ? { lastDelivered: requiredBoolean(value.lastDelivered, 'state.lastDelivered', method) } : {}),
    ...(value.lastDeliveryStatus !== undefined ? { lastDeliveryStatus: oneOf(value.lastDeliveryStatus, CRON_DELIVERY_STATUSES, 'state.lastDeliveryStatus', method) } : {}),
    ...(value.lastDeliveryError !== undefined ? { lastDeliveryError: optionalString(value.lastDeliveryError, 'state.lastDeliveryError', method) } : {}),
  };
}

export function buildCronGetParams(jobId: string): { id: string } {
  return { id: requiredString(jobId, 'jobId', 'cron.get') };
}

export function buildCronRunsParams(params: CronRunsParams): Record<string, unknown> {
  const jobId = requiredString(params.jobId, 'jobId', 'cron.runs');
  const runId = params.runId === undefined
    ? undefined
    : requiredString(params.runId, 'runId', 'cron.runs');
  const requestedLimit = params.limit === undefined ? 50 : Math.floor(params.limit);
  const limit = Math.min(Math.max(requestedLimit, 1), 200);
  return {
    scope: 'job',
    id: jobId,
    ...(runId ? { runId } : {}),
    limit,
    ...(params.sortDir ? { sortDir: params.sortDir } : {}),
  };
}

export function parseCronJobDetails(value: unknown): OpenClawCronJobDetails {
  const method = 'cron.get';
  if (!isRecord(value)) throw new Error(`${method} returned an invalid job`);
  const payload = value.payload;
  if (!isRecord(payload)) throw new Error(`${method} returned an invalid payload`);
  const payloadKind = oneOf(payload.kind, ['systemEvent', 'agentTurn', 'command'] as const, 'payload.kind', method);
  const state = parseJobState(value.state, method);
  return {
    id: requiredString(value.id, 'id', method),
    name: requiredString(value.name, 'name', method),
    enabled: requiredBoolean(value.enabled, 'enabled', method),
    ...(value.agentId !== undefined ? { agentId: optionalString(value.agentId, 'agentId', method) } : {}),
    ...(value.sessionKey !== undefined ? { sessionKey: optionalString(value.sessionKey, 'sessionKey', method) } : {}),
    ...(value.description !== undefined ? { description: optionalString(value.description, 'description', method) } : {}),
    ...(value.deleteAfterRun !== undefined ? { deleteAfterRun: requiredBoolean(value.deleteAfterRun, 'deleteAfterRun', method) } : {}),
    createdAtMs: requiredInteger(value.createdAtMs, 'createdAtMs', method),
    updatedAtMs: requiredInteger(value.updatedAtMs, 'updatedAtMs', method),
    schedule: parseSchedule(value.schedule, method),
    sessionTarget: parseSessionTarget(value.sessionTarget, method),
    wakeMode: oneOf(value.wakeMode, ['next-heartbeat', 'now'] as const, 'wakeMode', method),
    payloadKind,
    state,
    ...(value.nextRunAtMs !== undefined ? { nextRunAtMs: requiredInteger(value.nextRunAtMs, 'nextRunAtMs', method) } : {}),
    ...(value.lastRunAtMs !== undefined ? { lastRunAtMs: requiredInteger(value.lastRunAtMs, 'lastRunAtMs', method) } : {}),
    ...(value.lastRunStatus !== undefined ? { lastRunStatus: oneOf(value.lastRunStatus, CRON_RUN_STATUSES, 'lastRunStatus', method) } : {}),
    ...(value.lastRunError !== undefined ? { lastRunError: optionalString(value.lastRunError, 'lastRunError', method) } : {}),
    ...(value.lastDelivered !== undefined ? { lastDelivered: requiredBoolean(value.lastDelivered, 'lastDelivered', method) } : {}),
    ...(value.lastDeliveryStatus !== undefined ? { lastDeliveryStatus: oneOf(value.lastDeliveryStatus, CRON_DELIVERY_STATUSES, 'lastDeliveryStatus', method) } : {}),
    ...(value.lastDeliveryError !== undefined ? { lastDeliveryError: optionalString(value.lastDeliveryError, 'lastDeliveryError', method) } : {}),
  };
}

function parseUsage(value: unknown, method: string): CronRunLogEntry['usage'] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`${method} returned an invalid usage`);
  return {
    ...(value.input_tokens !== undefined ? { input_tokens: optionalNumber(value.input_tokens, 'usage.input_tokens', method) } : {}),
    ...(value.output_tokens !== undefined ? { output_tokens: optionalNumber(value.output_tokens, 'usage.output_tokens', method) } : {}),
    ...(value.total_tokens !== undefined ? { total_tokens: optionalNumber(value.total_tokens, 'usage.total_tokens', method) } : {}),
    ...(value.cache_read_tokens !== undefined ? { cache_read_tokens: optionalNumber(value.cache_read_tokens, 'usage.cache_read_tokens', method) } : {}),
    ...(value.cache_write_tokens !== undefined ? { cache_write_tokens: optionalNumber(value.cache_write_tokens, 'usage.cache_write_tokens', method) } : {}),
  };
}

function parseRunLogEntry(value: unknown): CronRunLogEntry {
  const method = 'cron.runs';
  if (!isRecord(value)) throw new Error(`${method} returned an invalid entry`);
  return {
    ts: requiredInteger(value.ts, 'entries[].ts', method),
    jobId: requiredString(value.jobId, 'entries[].jobId', method),
    action: value.action === 'finished'
      ? 'finished'
      : (() => { throw new Error(`${method} returned an invalid entries[].action`); })(),
    ...(value.status !== undefined ? { status: oneOf(value.status, CRON_RUN_STATUSES, 'entries[].status', method) } : {}),
    ...(value.error !== undefined ? { error: optionalString(value.error, 'entries[].error', method) } : {}),
    ...(value.summary !== undefined ? { summary: optionalString(value.summary, 'entries[].summary', method) } : {}),
    ...(value.delivered !== undefined ? { delivered: requiredBoolean(value.delivered, 'entries[].delivered', method) } : {}),
    ...(value.deliveryStatus !== undefined ? { deliveryStatus: oneOf(value.deliveryStatus, CRON_DELIVERY_STATUSES, 'entries[].deliveryStatus', method) } : {}),
    ...(value.deliveryError !== undefined ? { deliveryError: optionalString(value.deliveryError, 'entries[].deliveryError', method) } : {}),
    ...(value.sessionId !== undefined ? { sessionId: optionalString(value.sessionId, 'entries[].sessionId', method) } : {}),
    ...(value.sessionKey !== undefined ? { sessionKey: optionalString(value.sessionKey, 'entries[].sessionKey', method) } : {}),
    ...(value.runId !== undefined ? { runId: optionalString(value.runId, 'entries[].runId', method) } : {}),
    ...(value.runAtMs !== undefined ? { runAtMs: requiredInteger(value.runAtMs, 'entries[].runAtMs', method) } : {}),
    ...(value.durationMs !== undefined ? { durationMs: requiredInteger(value.durationMs, 'entries[].durationMs', method) } : {}),
    ...(value.nextRunAtMs !== undefined ? { nextRunAtMs: requiredInteger(value.nextRunAtMs, 'entries[].nextRunAtMs', method) } : {}),
    ...(value.model !== undefined ? { model: optionalString(value.model, 'entries[].model', method) } : {}),
    ...(value.provider !== undefined ? { provider: optionalString(value.provider, 'entries[].provider', method) } : {}),
    ...(value.jobName !== undefined ? { jobName: optionalString(value.jobName, 'entries[].jobName', method) } : {}),
    ...(value.usage !== undefined ? { usage: parseUsage(value.usage, method) } : {}),
  };
}

export function parseCronRunsPage(value: unknown): CronRunsPage {
  const method = 'cron.runs';
  if (!isRecord(value) || !Array.isArray(value.entries) || value.entries.length > 200) {
    throw new Error(`${method} returned an invalid page`);
  }
  const nextOffset = value.nextOffset === null
    ? null
    : requiredInteger(value.nextOffset, 'nextOffset', method);
  return {
    entries: value.entries.map(parseRunLogEntry),
    total: requiredInteger(value.total, 'total', method),
    offset: requiredInteger(value.offset, 'offset', method),
    limit: requiredInteger(value.limit, 'limit', method, 1),
    hasMore: requiredBoolean(value.hasMore, 'hasMore', method),
    nextOffset,
  };
}

export function parseCronRunEnqueueResult(value: unknown): CronRunEnqueueResult {
  const method = 'cron.run';
  if (!isRecord(value)) throw new Error(`${method} returned an invalid result`);
  const result: CronRunEnqueueResult = {
    ok: requiredBoolean(value.ok, 'ok', method),
    ...(value.enqueued !== undefined ? { enqueued: requiredBoolean(value.enqueued, 'enqueued', method) } : {}),
    ...(value.ran !== undefined ? { ran: requiredBoolean(value.ran, 'ran', method) } : {}),
    ...(value.reason !== undefined ? { reason: optionalString(value.reason, 'reason', method) } : {}),
    ...(value.jobId !== undefined ? { jobId: optionalString(value.jobId, 'jobId', method) } : {}),
    ...(value.runId !== undefined ? { runId: optionalString(value.runId, 'runId', method) } : {}),
  };
  if (result.enqueued === true && !result.runId) {
    throw new Error(`${method} returned an enqueued result without runId`);
  }
  return result;
}

export async function getCronJob(
  request: CronRequester,
  jobId: string,
): Promise<OpenClawCronJobDetails> {
  return parseCronJobDetails(await request('cron.get', buildCronGetParams(jobId)));
}

export async function listCronRuns(
  request: CronRequester,
  params: CronRunsParams,
): Promise<CronRunsPage> {
  return parseCronRunsPage(await request('cron.runs', buildCronRunsParams(params)));
}

export async function enqueueCronRun(
  request: CronRequester,
  jobId: string,
  mode: 'due' | 'force' = 'force',
): Promise<CronRunEnqueueResult> {
  const id = requiredString(jobId, 'jobId', 'cron.run');
  return parseCronRunEnqueueResult(await request('cron.run', { id, mode }));
}

export async function waitForCronRun(
  request: CronRequester,
  jobId: string,
  runId: string,
  options: CronRunWaitOptions = {},
): Promise<CronRunLogEntry> {
  const normalizedJobId = requiredString(jobId, 'jobId', 'cron.runs');
  const normalizedRunId = requiredString(runId, 'runId', 'cron.runs');
  const now = options.now ?? (() => Date.now());
  const timeoutMs = Math.max(1, Math.floor(options.timeoutMs ?? 120_000));
  const pollIntervalMs = Math.max(1, Math.floor(options.pollIntervalMs ?? 2_000));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  }));
  const deadline = now() + timeoutMs;

  for (;;) {
    const page = await listCronRuns(request, {
      jobId: normalizedJobId,
      runId: normalizedRunId,
      limit: 1,
      sortDir: 'asc',
    });
    const entry = page.entries.find((candidate) => candidate.runId === normalizedRunId);
    if (entry?.status) return entry;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new CronRunWaitTimeoutError(normalizedRunId);
    }
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}
