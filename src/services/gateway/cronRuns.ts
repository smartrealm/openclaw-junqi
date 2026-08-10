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

export type CronPayloadKind = 'systemEvent' | 'agentTurn' | 'command' | 'script' | 'heartbeat';

export interface CronPacingDetails {
  min?: string;
  max?: string;
}

export interface CronDeliveryDestinationDetails {
  mode?: 'announce' | 'webhook';
  channel?: string;
  to?: string;
  accountId?: string;
}

export interface CronDeliveryDetails {
  mode: 'none' | 'announce' | 'webhook';
  channel?: string;
  to?: string;
  threadId?: string | number;
  accountId?: string;
  bestEffort?: boolean;
  completionDestination?: { mode: 'webhook'; to?: string };
  failureDestination?: CronDeliveryDestinationDetails;
}

export interface CronFailureAlertDetails {
  after?: number;
  channel?: string;
  to?: string;
  cooldownMs?: number;
  includeSkipped?: boolean;
  mode?: 'announce' | 'webhook';
  accountId?: string;
}

export interface CronJobStateDetails {
  nextRunAtMs?: number;
  scheduleActivatedAtMs?: number;
  startupCatchupAtMs?: number;
  pacedNextRunAtMs?: number;
  forcePreservedNextRunAtMs?: number;
  queuedAtMs?: number;
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
  lastDiagnosticSummary?: string;
  autoDisabled?: {
    reason: 'consecutive-failures' | 'schedule-errors';
    atMs: number;
    consecutiveErrors: number;
  };
  lastFailureAlertAtMs?: number;
  scheduleErrorCount?: number;
  streamStatus?: 'starting' | 'running' | 'restarting' | 'stopped' | 'disabled' | 'error';
  streamError?: string;
  streamConsecutiveFailures?: number;
  streamRestartExhausted?: boolean;
  streamDroppedBatches?: number;
  streamCoalescedBatches?: number;
  streamLastStartedAtMs?: number;
  streamLastExitAtMs?: number;
  lastFailureNotificationDelivered?: boolean;
  lastFailureNotificationDeliveryStatus?: CronDeliveryStatus;
  lastFailureNotificationDeliveryError?: string;
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
  configRevision?: string;
  schedule: CronScheduleDetails;
  pacing?: CronPacingDetails;
  sessionTarget: CronSessionTarget;
  wakeMode: CronWakeMode;
  payloadKind: CronPayloadKind;
  delivery?: CronDeliveryDetails;
  failureAlert?: false | CronFailureAlertDetails;
  state: CronJobStateDetails;
  nextRunAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: CronRunStatus;
  lastRunError?: string;
  lastDelivered?: boolean;
  lastDeliveryStatus?: CronDeliveryStatus;
  lastDeliveryError?: string;
}

interface CronRunsCommonParams {
  readonly agentId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly statuses?: readonly CronRunStatus[];
  readonly status?: 'all' | CronRunStatus;
  readonly deliveryStatuses?: readonly CronDeliveryStatus[];
  readonly deliveryStatus?: CronDeliveryStatus;
  readonly query?: string;
  readonly sortDir?: 'asc' | 'desc';
}

export type CronRunsParams = CronRunsCommonParams & (
  | {
    readonly scope?: 'job';
    readonly jobId: string;
    readonly runId?: string;
  }
  | {
    readonly scope: 'all';
    readonly jobId?: never;
    readonly runId?: string;
  }
);

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

function optionalThreadId(value: unknown, field: string, method: string): string | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Number.isSafeInteger(value) && (value as number) >= 0) return value as number;
  throw new Error(`${method} returned an invalid ${field}`);
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
  if (kind === 'stream') {
    if (!Array.isArray(value.command) || value.command.length === 0 || value.command.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new Error(`${method} returned an invalid schedule.command`);
    }
    const mode = value.mode === undefined
      ? undefined
      : oneOf(value.mode, ['line', 'match'] as const, 'schedule.mode', method);
    if (mode === 'match' && typeof value.match !== 'string') {
      throw new Error(`${method} returned an invalid schedule.match`);
    }
    return {
      kind,
      command: value.command.map((item) => item.trim()),
      ...(value.cwd !== undefined ? { cwd: requiredString(value.cwd, 'schedule.cwd', method) } : {}),
      ...(mode !== undefined ? { mode } : {}),
      ...(value.match !== undefined ? { match: requiredString(value.match, 'schedule.match', method) } : {}),
      ...(value.batchMs !== undefined ? { batchMs: requiredInteger(value.batchMs, 'schedule.batchMs', method) } : {}),
      ...(value.maxBatchBytes !== undefined ? { maxBatchBytes: requiredInteger(value.maxBatchBytes, 'schedule.maxBatchBytes', method, 1) } : {}),
    };
  }
  throw new Error(`${method} returned an invalid schedule.kind`);
}

function parsePacing(value: unknown, method: string): CronPacingDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid pacing`);
  return {
    ...(value.min !== undefined ? { min: requiredString(value.min, 'pacing.min', method) } : {}),
    ...(value.max !== undefined ? { max: requiredString(value.max, 'pacing.max', method) } : {}),
  };
}

function parseDeliveryDestination(value: unknown, method: string): CronDeliveryDestinationDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid delivery destination`);
  return {
    ...(value.mode !== undefined ? { mode: oneOf(value.mode, ['announce', 'webhook'] as const, 'delivery.destination.mode', method) } : {}),
    ...(value.channel !== undefined ? { channel: requiredString(value.channel, 'delivery.destination.channel', method) } : {}),
    ...(value.to !== undefined ? { to: requiredString(value.to, 'delivery.destination.to', method) } : {}),
    ...(value.accountId !== undefined ? { accountId: requiredString(value.accountId, 'delivery.destination.accountId', method) } : {}),
  };
}

function parseDelivery(value: unknown, method: string): CronDeliveryDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid delivery`);
  const mode = oneOf(value.mode, ['none', 'announce', 'webhook'] as const, 'delivery.mode', method);
  const completionDestination = value.completionDestination === undefined
    ? undefined
    : (() => {
      if (!isRecord(value.completionDestination) || value.completionDestination.mode !== 'webhook') {
        throw new Error(`${method} returned an invalid delivery.completionDestination`);
      }
      return {
        mode: 'webhook' as const,
        ...(value.completionDestination.to !== undefined
          ? { to: requiredString(value.completionDestination.to, 'delivery.completionDestination.to', method) }
          : {}),
      };
    })();
  return {
    mode,
    ...(value.channel !== undefined ? { channel: requiredString(value.channel, 'delivery.channel', method) } : {}),
    ...(value.to !== undefined ? { to: requiredString(value.to, 'delivery.to', method) } : {}),
    ...(value.threadId !== undefined ? { threadId: optionalThreadId(value.threadId, 'delivery.threadId', method) } : {}),
    ...(value.accountId !== undefined ? { accountId: requiredString(value.accountId, 'delivery.accountId', method) } : {}),
    ...(value.bestEffort !== undefined ? { bestEffort: requiredBoolean(value.bestEffort, 'delivery.bestEffort', method) } : {}),
    ...(completionDestination ? { completionDestination } : {}),
    ...(value.failureDestination !== undefined
      ? { failureDestination: parseDeliveryDestination(value.failureDestination, method) }
      : {}),
  };
}

function parseFailureAlert(value: unknown, method: string): false | CronFailureAlertDetails {
  if (value === false) return false;
  if (!isRecord(value)) throw new Error(`${method} returned an invalid failureAlert`);
  return {
    ...(value.after !== undefined ? { after: requiredInteger(value.after, 'failureAlert.after', method, 1) } : {}),
    ...(value.channel !== undefined ? { channel: requiredString(value.channel, 'failureAlert.channel', method) } : {}),
    ...(value.to !== undefined ? { to: requiredString(value.to, 'failureAlert.to', method) } : {}),
    ...(value.cooldownMs !== undefined ? { cooldownMs: requiredInteger(value.cooldownMs, 'failureAlert.cooldownMs', method) } : {}),
    ...(value.includeSkipped !== undefined ? { includeSkipped: requiredBoolean(value.includeSkipped, 'failureAlert.includeSkipped', method) } : {}),
    ...(value.mode !== undefined ? { mode: oneOf(value.mode, ['announce', 'webhook'] as const, 'failureAlert.mode', method) } : {}),
    ...(value.accountId !== undefined ? { accountId: requiredString(value.accountId, 'failureAlert.accountId', method) } : {}),
  };
}

function parseJobState(value: unknown, method: string): CronJobStateDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid state`);
  const autoDisabled = value.autoDisabled === undefined
    ? undefined
    : (() => {
      if (!isRecord(value.autoDisabled)) throw new Error(`${method} returned an invalid state.autoDisabled`);
      return {
        reason: oneOf(value.autoDisabled.reason, ['consecutive-failures', 'schedule-errors'] as const, 'state.autoDisabled.reason', method),
        atMs: requiredInteger(value.autoDisabled.atMs, 'state.autoDisabled.atMs', method),
        consecutiveErrors: requiredInteger(value.autoDisabled.consecutiveErrors, 'state.autoDisabled.consecutiveErrors', method),
      };
    })();
  return {
    ...(value.nextRunAtMs !== undefined ? { nextRunAtMs: requiredInteger(value.nextRunAtMs, 'state.nextRunAtMs', method) } : {}),
    ...(value.scheduleActivatedAtMs !== undefined ? { scheduleActivatedAtMs: requiredInteger(value.scheduleActivatedAtMs, 'state.scheduleActivatedAtMs', method) } : {}),
    ...(value.startupCatchupAtMs !== undefined ? { startupCatchupAtMs: requiredInteger(value.startupCatchupAtMs, 'state.startupCatchupAtMs', method) } : {}),
    ...(value.pacedNextRunAtMs !== undefined ? { pacedNextRunAtMs: requiredInteger(value.pacedNextRunAtMs, 'state.pacedNextRunAtMs', method) } : {}),
    ...(value.forcePreservedNextRunAtMs !== undefined ? { forcePreservedNextRunAtMs: requiredInteger(value.forcePreservedNextRunAtMs, 'state.forcePreservedNextRunAtMs', method) } : {}),
    ...(value.queuedAtMs !== undefined ? { queuedAtMs: requiredInteger(value.queuedAtMs, 'state.queuedAtMs', method) } : {}),
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
    ...(value.lastDiagnosticSummary !== undefined ? { lastDiagnosticSummary: optionalString(value.lastDiagnosticSummary, 'state.lastDiagnosticSummary', method) } : {}),
    ...(autoDisabled ? { autoDisabled } : {}),
    ...(value.lastFailureAlertAtMs !== undefined ? { lastFailureAlertAtMs: requiredInteger(value.lastFailureAlertAtMs, 'state.lastFailureAlertAtMs', method) } : {}),
    ...(value.scheduleErrorCount !== undefined ? { scheduleErrorCount: requiredInteger(value.scheduleErrorCount, 'state.scheduleErrorCount', method) } : {}),
    ...(value.streamStatus !== undefined ? { streamStatus: oneOf(value.streamStatus, ['starting', 'running', 'restarting', 'stopped', 'disabled', 'error'] as const, 'state.streamStatus', method) } : {}),
    ...(value.streamError !== undefined ? { streamError: optionalString(value.streamError, 'state.streamError', method) } : {}),
    ...(value.streamConsecutiveFailures !== undefined ? { streamConsecutiveFailures: requiredInteger(value.streamConsecutiveFailures, 'state.streamConsecutiveFailures', method) } : {}),
    ...(value.streamRestartExhausted !== undefined ? { streamRestartExhausted: requiredBoolean(value.streamRestartExhausted, 'state.streamRestartExhausted', method) } : {}),
    ...(value.streamDroppedBatches !== undefined ? { streamDroppedBatches: requiredInteger(value.streamDroppedBatches, 'state.streamDroppedBatches', method) } : {}),
    ...(value.streamCoalescedBatches !== undefined ? { streamCoalescedBatches: requiredInteger(value.streamCoalescedBatches, 'state.streamCoalescedBatches', method) } : {}),
    ...(value.streamLastStartedAtMs !== undefined ? { streamLastStartedAtMs: requiredInteger(value.streamLastStartedAtMs, 'state.streamLastStartedAtMs', method) } : {}),
    ...(value.streamLastExitAtMs !== undefined ? { streamLastExitAtMs: requiredInteger(value.streamLastExitAtMs, 'state.streamLastExitAtMs', method) } : {}),
    ...(value.lastFailureNotificationDelivered !== undefined ? { lastFailureNotificationDelivered: requiredBoolean(value.lastFailureNotificationDelivered, 'state.lastFailureNotificationDelivered', method) } : {}),
    ...(value.lastFailureNotificationDeliveryStatus !== undefined ? { lastFailureNotificationDeliveryStatus: oneOf(value.lastFailureNotificationDeliveryStatus, CRON_DELIVERY_STATUSES, 'state.lastFailureNotificationDeliveryStatus', method) } : {}),
    ...(value.lastFailureNotificationDeliveryError !== undefined ? { lastFailureNotificationDeliveryError: optionalString(value.lastFailureNotificationDeliveryError, 'state.lastFailureNotificationDeliveryError', method) } : {}),
  };
}

export function buildCronGetParams(jobId: string): { id: string } {
  return { id: requiredString(jobId, 'jobId', 'cron.get') };
}

export function buildCronRunsParams(params: CronRunsParams): Record<string, unknown> {
  const method = 'cron.runs';
  const scope = params.scope ?? 'job';
  if (scope !== 'job' && scope !== 'all') {
    throw new Error(`${method} requires a valid scope`);
  }
  if (scope === 'all' && params.jobId !== undefined) {
    throw new Error(`${method} scope all cannot include jobId`);
  }

  const validateOptionalInteger = (value: unknown, field: string, minimum: number, maximum?: number) => {
    if (value === undefined) return undefined;
    const parsed = requiredInteger(value, field, method, minimum);
    if (maximum !== undefined && parsed > maximum) throw new Error(`${method} returned an invalid ${field}`);
    return parsed;
  };
  const validateOptionalEnum = <T extends readonly string[]>(value: unknown, values: T, field: string): T[number] | undefined => {
    if (value === undefined) return undefined;
    return oneOf(value, values, field, method);
  };
  const validateOptionalList = <T extends readonly string[]>(
    value: unknown,
    values: T,
    field: string,
    maximum: number,
  ): T[number][] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0 || value.length > maximum) {
      throw new Error(`${method} requires a valid ${field}`);
    }
    return value.map((entry) => oneOf(entry, values, field, method));
  };

  const agentId = params.agentId === undefined
    ? undefined
    : requiredString(params.agentId, 'agentId', method);
  const limit = validateOptionalInteger(params.limit, 'limit', 1, 200);
  const offset = validateOptionalInteger(params.offset, 'offset', 0);
  const statuses = validateOptionalList(params.statuses, CRON_RUN_STATUSES, 'statuses', 3);
  const status = validateOptionalEnum(params.status, ['all', ...CRON_RUN_STATUSES] as const, 'status');
  const deliveryStatuses = validateOptionalList(
    params.deliveryStatuses,
    CRON_DELIVERY_STATUSES,
    'deliveryStatuses',
    4,
  );
  const deliveryStatus = validateOptionalEnum(
    params.deliveryStatus,
    CRON_DELIVERY_STATUSES,
    'deliveryStatus',
  );
  const query = params.query === undefined ? undefined : String(params.query);
  if (params.query !== undefined && typeof params.query !== 'string') {
    throw new Error(`${method} requires a valid query`);
  }
  const sortDir = validateOptionalEnum(params.sortDir, ['asc', 'desc'] as const, 'sortDir');

  if (scope === 'all') {
    const runId = params.runId === undefined
      ? undefined
      : requiredString(params.runId, 'runId', method);
    return {
      scope,
      ...(agentId ? { agentId } : {}),
      ...(runId ? { runId } : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
      ...(statuses ? { statuses } : {}),
      ...(status ? { status } : {}),
      ...(deliveryStatuses ? { deliveryStatuses } : {}),
      ...(deliveryStatus ? { deliveryStatus } : {}),
      ...(query === undefined ? {} : { query }),
      ...(sortDir ? { sortDir } : {}),
    };
  }

  const jobId = requiredString(params.jobId, 'jobId', method);
  const runId = params.runId === undefined
    ? undefined
    : requiredString(params.runId, 'runId', method);
  return {
    scope,
    id: jobId,
    ...(agentId ? { agentId } : {}),
    ...(runId ? { runId } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(offset ===undefined ? {} : { offset }),
    ...(statuses ? { statuses } : {}),
    ...(status ? { status } : {}),
    ...(deliveryStatuses ? { deliveryStatuses } : {}),
    ...(deliveryStatus ? { deliveryStatus } : {}),
    ...(query === undefined ? {} : { query }),
    ...(sortDir ? { sortDir } : {}),
  };
}

export function parseCronJobDetails(value: unknown, method = 'cron.get'): OpenClawCronJobDetails {
  if (!isRecord(value)) throw new Error(`${method} returned an invalid job`);
  const payload = value.payload;
  if (!isRecord(payload)) throw new Error(`${method} returned an invalid payload`);
  const payloadKind = oneOf(payload.kind, ['systemEvent', 'agentTurn', 'command', 'script', 'heartbeat'] as const, 'payload.kind', method);
  const state = parseJobState(value.state, method);
  const pacing = value.pacing === undefined ? undefined : parsePacing(value.pacing, method);
  const delivery = value.delivery === undefined ? undefined : parseDelivery(value.delivery, method);
  const failureAlert = value.failureAlert === undefined ? undefined : parseFailureAlert(value.failureAlert, method);
  return {
    id: requiredString(value.id, 'id', method),
    name: requiredString(value.name, 'name', method),
    enabled: requiredBoolean(value.enabled, 'enabled', method),
    ...(value.agentId !== undefined ? { agentId: requiredString(value.agentId, 'agentId', method) } : {}),
    ...(value.sessionKey !== undefined ? { sessionKey: requiredString(value.sessionKey, 'sessionKey', method) } : {}),
    ...(value.description !== undefined ? { description: optionalString(value.description, 'description', method) } : {}),
    ...(value.deleteAfterRun !== undefined ? { deleteAfterRun: requiredBoolean(value.deleteAfterRun, 'deleteAfterRun', method) } : {}),
    createdAtMs: requiredInteger(value.createdAtMs, 'createdAtMs', method),
    updatedAtMs: requiredInteger(value.updatedAtMs, 'updatedAtMs', method),
    ...(value.configRevision !== undefined
      ? { configRevision: requiredString(value.configRevision, 'configRevision', method) }
      : {}),
    schedule: parseSchedule(value.schedule, method),
    ...(pacing ? { pacing } : {}),
    sessionTarget: parseSessionTarget(value.sessionTarget, method),
    wakeMode: oneOf(value.wakeMode, ['next-heartbeat', 'now'] as const, 'wakeMode', method),
    payloadKind,
    ...(delivery ? { delivery } : {}),
    ...(failureAlert !== undefined ? { failureAlert } : {}),
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

export function parseCronRunLogEntry(value: unknown): CronRunLogEntry {
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
  const entries = value.entries.map(parseCronRunLogEntry);
  const total = requiredInteger(value.total, 'total', method);
  const offset = requiredInteger(value.offset, 'offset', method);
  const limit = requiredInteger(value.limit, 'limit', method, 1);
  const hasMore = requiredBoolean(value.hasMore, 'hasMore', method);
  if (limit > 200 || entries.length > limit || offset > total || offset + entries.length > total) {
    throw new Error(`${method} returned an invalid page`);
  }
  const nextOffset = value.nextOffset === null
    ? null
    : requiredInteger(value.nextOffset, 'nextOffset', method);
  const expectedNextOffset = offset + entries.length;
  const expectedHasMore = expectedNextOffset < total;
  if (hasMore !== expectedHasMore || nextOffset !== (expectedHasMore ? expectedNextOffset : null)) {
    throw new Error(`${method} returned an invalid page`);
  }
  return {
    entries,
    total,
    offset,
    limit,
    hasMore,
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
  onInvalidResponse?: (method: string) => void,
): Promise<OpenClawCronJobDetails> {
  const response = await request('cron.get', buildCronGetParams(jobId));
  try {
    return parseCronJobDetails(response);
  } catch (error) {
    onInvalidResponse?.('cron.get');
    throw error;
  }
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
