export type OpenClawTaskLedgerStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export interface OpenClawTaskSummary {
  readonly id: string;
  readonly status: OpenClawTaskLedgerStatus;
  readonly kind?: string;
  readonly runtime?: string;
  readonly title?: string;
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly childSessionKey?: string;
  readonly ownerKey?: string;
  readonly runId?: string;
  readonly taskId?: string;
  readonly flowId?: string;
  readonly parentTaskId?: string;
  readonly sourceId?: string;
  readonly createdAt?: string | number;
  readonly updatedAt?: string | number;
  readonly startedAt?: string | number;
  readonly endedAt?: string | number;
  readonly progressSummary?: string;
  readonly terminalSummary?: string;
  readonly error?: string;
}

export interface OpenClawTaskListInput {
  readonly status?: OpenClawTaskLedgerStatus | readonly OpenClawTaskLedgerStatus[];
  readonly agentId?: string;
  readonly sessionKey?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface OpenClawTaskListPage {
  readonly tasks: readonly OpenClawTaskSummary[];
  readonly nextCursor?: string;
}

export interface OpenClawTaskCancelResult {
  readonly found: boolean;
  readonly cancelled: boolean;
  readonly reason?: string;
  readonly task?: OpenClawTaskSummary;
}

export type OpenClawTaskRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

const STATUSES = new Set<OpenClawTaskLedgerStatus>([
  'queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out',
]);
export class OpenClawTaskLedgerResponseError extends Error {
  constructor() {
    super('OPENCLAW_TASK_LEDGER_RESPONSE_INVALID');
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max = 512): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= max
    ? value.trim()
    : null;
}

function optionalText(value: unknown, max = 512): string | undefined {
  const normalized = text(value, max);
  return normalized ?? undefined;
}

export function parseOpenClawTaskSummary(value: unknown): OpenClawTaskSummary {
  const source = record(value);
  const id = source ? text(source.id) : null;
  const status = source?.status;
  if (!source || !id || typeof status !== 'string' || !STATUSES.has(status as OpenClawTaskLedgerStatus)) {
    throw new OpenClawTaskLedgerResponseError();
  }
  const timestamp = (value: unknown): string | number | undefined => (
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : undefined
  );
  return {
    id,
    status: status as OpenClawTaskLedgerStatus,
    ...(optionalText(source.kind, 2_048) ? { kind: optionalText(source.kind, 2_048) } : {}),
    ...(optionalText(source.runtime, 2_048) ? { runtime: optionalText(source.runtime, 2_048) } : {}),
    ...(optionalText(source.title, 2_048) ? { title: optionalText(source.title, 2_048) } : {}),
    ...(optionalText(source.agentId, 2_048) ? { agentId: optionalText(source.agentId, 2_048) } : {}),
    ...(optionalText(source.sessionKey, 2_048) ? { sessionKey: optionalText(source.sessionKey, 2_048) } : {}),
    ...(optionalText(source.childSessionKey, 2_048) ? { childSessionKey: optionalText(source.childSessionKey, 2_048) } : {}),
    ...(optionalText(source.ownerKey, 2_048) ? { ownerKey: optionalText(source.ownerKey, 2_048) } : {}),
    ...(optionalText(source.runId, 2_048) ? { runId: optionalText(source.runId, 2_048) } : {}),
    ...(optionalText(source.taskId, 2_048) ? { taskId: optionalText(source.taskId, 2_048) } : {}),
    ...(optionalText(source.flowId, 2_048) ? { flowId: optionalText(source.flowId, 2_048) } : {}),
    ...(optionalText(source.parentTaskId, 2_048) ? { parentTaskId: optionalText(source.parentTaskId, 2_048) } : {}),
    ...(optionalText(source.sourceId, 2_048) ? { sourceId: optionalText(source.sourceId, 2_048) } : {}),
    ...(timestamp(source.createdAt) !== undefined ? { createdAt: timestamp(source.createdAt) } : {}),
    ...(timestamp(source.updatedAt) !== undefined ? { updatedAt: timestamp(source.updatedAt) } : {}),
    ...(timestamp(source.startedAt) !== undefined ? { startedAt: timestamp(source.startedAt) } : {}),
    ...(timestamp(source.endedAt) !== undefined ? { endedAt: timestamp(source.endedAt) } : {}),
    ...(optionalText(source.progressSummary, 2_048) ? { progressSummary: optionalText(source.progressSummary, 2_048) } : {}),
    ...(optionalText(source.terminalSummary, 2_048) ? { terminalSummary: optionalText(source.terminalSummary, 2_048) } : {}),
    ...(optionalText(source.error, 2_048) ? { error: optionalText(source.error, 2_048) } : {}),
  };
}

export function parseOpenClawTaskListPage(value: unknown): OpenClawTaskListPage {
  const source = record(value);
  if (!source || !Array.isArray(source.tasks)) throw new OpenClawTaskLedgerResponseError();
  const nextCursor = optionalText(source.nextCursor);
  return {
    tasks: source.tasks.map(parseOpenClawTaskSummary),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

function listParams(input: OpenClawTaskListInput): Record<string, unknown> {
  const statuses = input.status === undefined ? undefined : Array.isArray(input.status) ? input.status : [input.status];
  if (statuses?.some((status) => !STATUSES.has(status))) throw new Error('Invalid OpenClaw task status filter');
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 500)) {
    throw new Error('Invalid OpenClaw task list limit');
  }
  const agentId = input.agentId === undefined ? undefined : text(input.agentId);
  const sessionKey = input.sessionKey === undefined ? undefined : text(input.sessionKey);
  const cursor = input.cursor === undefined ? undefined : text(input.cursor);
  if ((input.agentId !== undefined && !agentId) || (input.sessionKey !== undefined && !sessionKey) || (input.cursor !== undefined && !cursor)) {
    throw new Error('Invalid OpenClaw task list identifier');
  }
  return {
    ...(statuses ? { status: statuses.length === 1 ? statuses[0] : statuses } : {}),
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export class OpenClawTaskLedgerClient {
  constructor(
    private readonly request: OpenClawTaskRequester,
    private readonly requestPrivileged: OpenClawTaskRequester,
  ) {}

  async list(input: OpenClawTaskListInput = {}): Promise<OpenClawTaskListPage> {
    return parseOpenClawTaskListPage(await this.request<unknown>('tasks.list', listParams(input)));
  }

  async get(taskId: string): Promise<OpenClawTaskSummary> {
    const normalizedTaskId = text(taskId);
    if (!normalizedTaskId) throw new Error('Invalid OpenClaw task id');
    const result = record(await this.request<unknown>('tasks.get', { taskId: normalizedTaskId }));
    if (!result) throw new OpenClawTaskLedgerResponseError();
    return parseOpenClawTaskSummary(result.task);
  }

  async cancel(taskId: string, reason?: string): Promise<OpenClawTaskCancelResult> {
    const normalizedTaskId = text(taskId);
    const normalizedReason = reason === undefined ? undefined : text(reason, 2_048);
    if (!normalizedTaskId || (reason !== undefined && !normalizedReason)) throw new Error('Invalid OpenClaw task cancellation input');
    const result = record(await this.requestPrivileged<unknown>('tasks.cancel', {
      taskId: normalizedTaskId,
      ...(normalizedReason ? { reason: normalizedReason } : {}),
    }));
    if (!result || typeof result.found !== 'boolean' || typeof result.cancelled !== 'boolean') {
      throw new OpenClawTaskLedgerResponseError();
    }
    const resultReason = optionalText(result.reason, 2_048);
    return {
      found: result.found,
      cancelled: result.cancelled,
      ...(resultReason ? { reason: resultReason } : {}),
      ...(result.task === undefined ? {} : { task: parseOpenClawTaskSummary(result.task) }),
    };
  }
}
