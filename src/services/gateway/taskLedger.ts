export const TASK_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface OpenClawTaskSummary {
  id: string;
  status: TaskStatus;
  kind?: string;
  runtime?: string;
  title?: string;
  agentId?: string;
  sessionKey?: string;
  childSessionKey?: string;
  ownerKey?: string;
  runId?: string;
  taskId?: string;
  flowId?: string;
  parentTaskId?: string;
  sourceId?: string;
  createdAt?: number;
  updatedAt?: number;
  startedAt?: number;
  endedAt?: number;
  progressSummary?: string;
  terminalSummary?: string;
  error?: string;
}

export interface TasksListParams {
  status?: TaskStatus | TaskStatus[];
  agentId?: string;
  sessionKey?: string;
  limit?: number;
  cursor?: string;
}

export interface TasksListPage {
  tasks: OpenClawTaskSummary[];
  nextCursor?: string;
}

export interface TasksGetResult {
  task: OpenClawTaskSummary;
}

export interface TasksCancelResult {
  found: boolean;
  cancelled: boolean;
  reason?: string;
  task?: OpenClawTaskSummary;
}

interface TaskRequester {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`tasks returned an invalid ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`tasks returned an invalid ${field}`);
  return value;
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value)) return value;
    throw new Error(`tasks returned an invalid ${field}`);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new Error(`tasks returned an invalid ${field}`);
}

function parseTask(value: unknown): OpenClawTaskSummary {
  if (!isRecord(value)) throw new Error('tasks returned an invalid task');
  return {
    id: requiredString(value.id, 'task id'),
    status: value.status && TASK_STATUSES.includes(value.status as TaskStatus)
      ? value.status as TaskStatus
      : (() => { throw new Error('tasks returned an invalid task status'); })(),
    ...(value.kind !== undefined ? { kind: optionalString(value.kind, 'kind') } : {}),
    ...(value.runtime !== undefined ? { runtime: optionalString(value.runtime, 'runtime') } : {}),
    ...(value.title !== undefined ? { title: optionalString(value.title, 'title') } : {}),
    ...(value.agentId !== undefined ? { agentId: optionalString(value.agentId, 'agentId') } : {}),
    ...(value.sessionKey !== undefined ? { sessionKey: optionalString(value.sessionKey, 'sessionKey') } : {}),
    ...(value.childSessionKey !== undefined ? { childSessionKey: optionalString(value.childSessionKey, 'childSessionKey') } : {}),
    ...(value.ownerKey !== undefined ? { ownerKey: optionalString(value.ownerKey, 'ownerKey') } : {}),
    ...(value.runId !== undefined ? { runId: optionalString(value.runId, 'runId') } : {}),
    ...(value.taskId !== undefined ? { taskId: optionalString(value.taskId, 'taskId') } : {}),
    ...(value.flowId !== undefined ? { flowId: optionalString(value.flowId, 'flowId') } : {}),
    ...(value.parentTaskId !== undefined ? { parentTaskId: optionalString(value.parentTaskId, 'parentTaskId') } : {}),
    ...(value.sourceId !== undefined ? { sourceId: optionalString(value.sourceId, 'sourceId') } : {}),
    ...(value.createdAt !== undefined ? { createdAt: optionalTimestamp(value.createdAt, 'createdAt') } : {}),
    ...(value.updatedAt !== undefined ? { updatedAt: optionalTimestamp(value.updatedAt, 'updatedAt') } : {}),
    ...(value.startedAt !== undefined ? { startedAt: optionalTimestamp(value.startedAt, 'startedAt') } : {}),
    ...(value.endedAt !== undefined ? { endedAt: optionalTimestamp(value.endedAt, 'endedAt') } : {}),
    ...(value.progressSummary !== undefined ? { progressSummary: optionalString(value.progressSummary, 'progressSummary') } : {}),
    ...(value.terminalSummary !== undefined ? { terminalSummary: optionalString(value.terminalSummary, 'terminalSummary') } : {}),
    ...(value.error !== undefined ? { error: optionalString(value.error, 'error') } : {}),
  };
}

export function parseTasksListPage(value: unknown): TasksListPage {
  if (!isRecord(value) || !Array.isArray(value.tasks) || value.tasks.length > 500) {
    throw new Error('tasks.list returned an invalid page');
  }
  const nextCursor = value.nextCursor === undefined
    ? undefined
    : requiredString(value.nextCursor, 'nextCursor');
  return {
    tasks: value.tasks.map(parseTask),
    ...(nextCursor ? { nextCursor } : {}),
  };
}

export function parseTasksGetResult(value: unknown): TasksGetResult {
  if (!isRecord(value) || value.task === undefined) {
    throw new Error('tasks.get returned an invalid result');
  }
  return { task: parseTask(value.task) };
}

export function parseTasksCancelResult(value: unknown): TasksCancelResult {
  if (!isRecord(value) || typeof value.found !== 'boolean' || typeof value.cancelled !== 'boolean') {
    throw new Error('tasks.cancel returned an invalid result');
  }
  return {
    found: value.found,
    cancelled: value.cancelled,
    ...(value.reason !== undefined ? { reason: optionalString(value.reason, 'reason') } : {}),
    ...(value.task !== undefined ? { task: parseTask(value.task) } : {}),
  };
}

function taskStatuses(status: TasksListParams['status']): TaskStatus[] | undefined {
  if (!status) return undefined;
  return Array.isArray(status) ? [...status] : [status];
}

export async function listTasks(request: TaskRequester, params: TasksListParams = {}): Promise<TasksListPage> {
  const statuses = taskStatuses(params.status);
  const result = await request('tasks.list', {
    ...(statuses?.length ? { status: statuses.length === 1 ? statuses[0] : statuses } : {}),
    ...(params.agentId?.trim() ? { agentId: params.agentId.trim() } : {}),
    ...(params.sessionKey?.trim() ? { sessionKey: params.sessionKey.trim() } : {}),
    limit: Math.min(Math.max(Math.floor(params.limit ?? 100), 1), 500),
    ...(params.cursor?.trim() ? { cursor: params.cursor.trim() } : {}),
  });
  return parseTasksListPage(result);
}

export async function getTask(request: TaskRequester, taskId: string): Promise<TasksGetResult> {
  const normalized = taskId.trim();
  if (!normalized) throw new Error('tasks.get requires a taskId');
  const result = await request('tasks.get', { taskId: normalized });
  return parseTasksGetResult(result);
}

export async function cancelTask(
  request: TaskRequester,
  taskId: string,
  reason = 'junqi_activity_center',
): Promise<TasksCancelResult> {
  const normalized = taskId.trim();
  if (!normalized) throw new Error('tasks.cancel requires a taskId');
  const result = await request('tasks.cancel', { taskId: normalized, reason });
  return parseTasksCancelResult(result);
}
