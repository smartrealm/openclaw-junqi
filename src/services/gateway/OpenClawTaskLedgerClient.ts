import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

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
  readonly toolUseCount?: number;
  readonly lastToolName?: string;
  readonly progressSummary?: string;
  readonly terminalSummary?: string;
  readonly error?: string;
  readonly deliveryStatus?: OpenClawTaskDeliveryStatus;
  readonly terminalOutcome?: OpenClawTaskTerminalOutcome;
  readonly result?: string;
  readonly prompt?: string;
}

export type OpenClawTaskDeliveryStatus =
  | 'pending'
  | 'delivered'
  | 'session_queued'
  | 'failed'
  | 'dismissed'
  | 'parent_missing'
  | 'not_applicable';

export type OpenClawTaskTerminalOutcome = 'succeeded' | 'blocked';

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
  readonly availability: 'available' | 'unavailable';
}

export interface OpenClawTaskCancelResult {
  readonly found: boolean;
  readonly cancelled: boolean;
  readonly reason?: string;
  readonly task?: OpenClawTaskSummary;
}

export interface OpenClawTaskRecoveryItem {
  readonly taskId: string;
  readonly ok: boolean;
  readonly reason?: string;
  readonly duplicateRisk?: boolean;
  readonly task?: OpenClawTaskSummary;
}

export interface OpenClawTaskRecoveryResult {
  readonly results: readonly OpenClawTaskRecoveryItem[];
}

export interface OpenClawTaskLedgerClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

const TASKS_LIST_METHOD = 'tasks.list';
const TASKS_GET_METHOD = 'tasks.get';
const TASKS_CANCEL_METHOD = 'tasks.cancel';
const TASKS_RETRY_METHOD = 'tasks.retry';
const TASKS_DISMISS_METHOD = 'tasks.dismiss';
const TASK_STATUSES: readonly OpenClawTaskLedgerStatus[] = [
  'queued', 'running', 'completed', 'failed', 'cancelled', 'timed_out',
];
const TASK_DELIVERY_STATUSES: readonly OpenClawTaskDeliveryStatus[] = [
  'pending', 'delivered', 'session_queued', 'failed', 'dismissed', 'parent_missing', 'not_applicable',
];
const TASK_TERMINAL_OUTCOMES: readonly OpenClawTaskTerminalOutcome[] = ['succeeded', 'blocked'];

export class OpenClawTaskLedgerUnsupportedError extends Error {
  readonly code = 'OPENCLAW_TASK_LEDGER_UNSUPPORTED';

  constructor(method: string) {
    super(`The connected OpenClaw Gateway does not support ${method}`);
    this.name = 'OpenClawTaskLedgerUnsupportedError';
  }
}

export class OpenClawTaskLedgerUnavailableError extends Error {
  readonly code = 'OPENCLAW_TASK_LEDGER_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawTaskLedgerUnavailableError';
  }
}

export class OpenClawTaskLedgerResponseError extends Error {
  readonly code = 'OPENCLAW_TASK_LEDGER_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid task ledger response');
    this.name = 'OpenClawTaskLedgerResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new OpenClawTaskLedgerResponseError();
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new OpenClawTaskLedgerResponseError();
  return value;
}

function optionalTimestamp(value: unknown): string | number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new OpenClawTaskLedgerResponseError();
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  throw new OpenClawTaskLedgerResponseError();
}

function isTaskStatus(value: string): value is OpenClawTaskLedgerStatus {
  return TASK_STATUSES.some((status) => status === value);
}

function taskStatus(value: unknown): OpenClawTaskLedgerStatus {
  if (typeof value !== 'string' || !isTaskStatus(value)) {
    throw new OpenClawTaskLedgerResponseError();
  }
  return value;
}

function optionalDeliveryStatus(value: unknown): OpenClawTaskDeliveryStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TASK_DELIVERY_STATUSES.includes(value as OpenClawTaskDeliveryStatus)) {
    throw new OpenClawTaskLedgerResponseError();
  }
  return value as OpenClawTaskDeliveryStatus;
}

function optionalTerminalOutcome(value: unknown): OpenClawTaskTerminalOutcome | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !TASK_TERMINAL_OUTCOMES.includes(value as OpenClawTaskTerminalOutcome)) {
    throw new OpenClawTaskLedgerResponseError();
  }
  return value as OpenClawTaskTerminalOutcome;
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

function requiredInputString(value: string, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}

const SUMMARY_FIELDS = new Set([
  'id', 'status', 'kind', 'runtime', 'title', 'agentId', 'sessionKey', 'childSessionKey',
  'ownerKey', 'runId', 'taskId', 'flowId', 'parentTaskId', 'sourceId', 'createdAt',
  'updatedAt', 'startedAt', 'endedAt', 'progressSummary', 'terminalSummary', 'error',
  'toolUseCount', 'lastToolName', 'deliveryStatus', 'terminalOutcome',
]);

/**
 * `tasks.get` 的当前 Gateway handler 明确返回 lookup-only prompt；
 * list 与 cancel 仍严格遵循稳定 TaskSummary schema，不能接纳该扩展字段。
 */
export function parseOpenClawTaskSummary(value: unknown, allowDetailFields = false): OpenClawTaskSummary {
  const source = record(value);
  if (!source || Object.keys(source).some((key) => !SUMMARY_FIELDS.has(key) && !(allowDetailFields && (key === 'prompt' || key === 'result')))) {
    throw new OpenClawTaskLedgerResponseError();
  }
  const id = requiredString(source.id);
  const status = taskStatus(source.status);
  const kind = optionalString(source.kind);
  const runtime = optionalString(source.runtime);
  const title = optionalString(source.title);
  const agentId = optionalString(source.agentId);
  const sessionKey = optionalString(source.sessionKey);
  const childSessionKey = optionalString(source.childSessionKey);
  const ownerKey = optionalString(source.ownerKey);
  const runId = optionalString(source.runId);
  const taskId = optionalString(source.taskId);
  const flowId = optionalString(source.flowId);
  const parentTaskId = optionalString(source.parentTaskId);
  const sourceId = optionalString(source.sourceId);
  const createdAt = optionalTimestamp(source.createdAt);
  const updatedAt = optionalTimestamp(source.updatedAt);
  const startedAt = optionalTimestamp(source.startedAt);
  const endedAt = optionalTimestamp(source.endedAt);
  const toolUseCount = optionalNonNegativeInteger(source.toolUseCount);
  const lastToolName = optionalString(source.lastToolName);
  const progressSummary = optionalString(source.progressSummary);
  const terminalSummary = optionalString(source.terminalSummary);
  const error = optionalString(source.error);
  const deliveryStatus = optionalDeliveryStatus(source.deliveryStatus);
  const terminalOutcome = optionalTerminalOutcome(source.terminalOutcome);
  const result = optionalString(source.result);
  const prompt = optionalString(source.prompt);
  return {
    id,
    status,
    ...(kind === undefined ? {} : { kind }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(title === undefined ? {} : { title }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(sessionKey === undefined ? {} : { sessionKey }),
    ...(childSessionKey === undefined ? {} : { childSessionKey }),
    ...(ownerKey === undefined ? {} : { ownerKey }),
    ...(runId === undefined ? {} : { runId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(flowId === undefined ? {} : { flowId }),
    ...(parentTaskId === undefined ? {} : { parentTaskId }),
    ...(sourceId === undefined ? {} : { sourceId }),
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(toolUseCount === undefined ? {} : { toolUseCount }),
    ...(lastToolName === undefined ? {} : { lastToolName }),
    ...(progressSummary === undefined ? {} : { progressSummary }),
    ...(terminalSummary === undefined ? {} : { terminalSummary }),
    ...(error === undefined ? {} : { error }),
    ...(deliveryStatus === undefined ? {} : { deliveryStatus }),
    ...(terminalOutcome === undefined ? {} : { terminalOutcome }),
    ...(result === undefined ? {} : { result }),
    ...(prompt === undefined ? {} : { prompt }),
  };
}

function parseRecoveryResult(value: unknown): OpenClawTaskRecoveryResult {
  const source = record(value);
  if (!source || !Array.isArray(source.results) || Object.keys(source).some((key) => key !== 'results')) {
    throw new OpenClawTaskLedgerResponseError();
  }
  return {
    results: source.results.map((item) => {
      const entry = record(item);
      if (!entry || typeof entry.ok !== 'boolean' || Object.keys(entry).some((key) => !['taskId', 'ok', 'reason', 'duplicateRisk', 'task'].includes(key))) {
        throw new OpenClawTaskLedgerResponseError();
      }
      const taskId = requiredString(entry.taskId);
      const reason = optionalString(entry.reason);
      if (entry.duplicateRisk !== undefined && typeof entry.duplicateRisk !== 'boolean') {
        throw new OpenClawTaskLedgerResponseError();
      }
      return {
        taskId,
        ok: entry.ok,
        ...(reason === undefined ? {} : { reason }),
        ...(entry.duplicateRisk === undefined ? {} : { duplicateRisk: entry.duplicateRisk }),
        ...(entry.task === undefined ? {} : { task: parseOpenClawTaskSummary(entry.task, true) }),
      };
    }),
  };
}

export function parseOpenClawTaskListPage(value: unknown): Omit<OpenClawTaskListPage, 'availability'> {
  const source = record(value);
  if (!source || !Array.isArray(source.tasks)) throw new OpenClawTaskLedgerResponseError();
  const nextCursor = optionalString(source.nextCursor);
  return {
    tasks: source.tasks.map((task) => parseOpenClawTaskSummary(task)),
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function listParams(input: OpenClawTaskListInput): Record<string, unknown> {
  const statuses = input.status === undefined ? undefined : Array.isArray(input.status) ? input.status : [input.status];
  if (statuses?.some((status) => !TASK_STATUSES.includes(status))) {
    throw new Error('Invalid OpenClaw task status filter');
  }
  if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500)) {
    throw new Error('Invalid OpenClaw task list limit');
  }
  const agentId = input.agentId === undefined ? undefined : requiredInputString(input.agentId, 'Invalid OpenClaw task agent id');
  const sessionKey = input.sessionKey === undefined ? undefined : requiredInputString(input.sessionKey, 'Invalid OpenClaw task session key');
  const cursor = input.cursor === undefined ? undefined : input.cursor;
  if (cursor !== undefined && typeof cursor !== 'string') throw new Error('Invalid OpenClaw task list cursor');
  return {
    ...(statuses === undefined ? {} : { status: statuses.length === 1 ? statuses[0] : statuses }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(sessionKey === undefined ? {} : { sessionKey }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function recoveryParams(taskIds: readonly string[]): Record<string, unknown> {
  if (!Array.isArray(taskIds) || taskIds.length < 1 || taskIds.length > 10) {
    throw new Error('OpenClaw task recovery requires between one and ten task ids');
  }
  return { taskIds: taskIds.map((taskId) => requiredInputString(taskId, 'Invalid OpenClaw task id')) };
}

export class OpenClawTaskLedgerClient {
  constructor(private readonly dependencies: OpenClawTaskLedgerClientDependencies) {}

  async list(input: OpenClawTaskListInput = {}): Promise<OpenClawTaskListPage> {
    try {
      return { ...parseOpenClawTaskListPage(await this.request(TASKS_LIST_METHOD, listParams(input))), availability: 'available' };
    } catch (error) {
      if (unsupportedMethod(error)) return { tasks: [], availability: 'unavailable' };
      throw error;
    }
  }

  async get(taskId: string): Promise<OpenClawTaskSummary> {
    const normalizedTaskId = requiredInputString(taskId, 'Invalid OpenClaw task id');
    try {
      const result = record(await this.request(TASKS_GET_METHOD, { taskId: normalizedTaskId }));
      if (!result) throw new OpenClawTaskLedgerResponseError();
      return parseOpenClawTaskSummary(result.task, true);
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawTaskLedgerUnsupportedError(TASKS_GET_METHOD);
      throw error;
    }
  }

  async cancel(taskId: string, reason?: string): Promise<OpenClawTaskCancelResult> {
    const normalizedTaskId = requiredInputString(taskId, 'Invalid OpenClaw task id');
    if (reason !== undefined && typeof reason !== 'string') throw new Error('Invalid OpenClaw task cancellation reason');
    try {
      const result = record(await this.request(TASKS_CANCEL_METHOD, {
        taskId: normalizedTaskId,
        ...(reason === undefined ? {} : { reason }),
      }));
      if (!result || typeof result.found !== 'boolean' || typeof result.cancelled !== 'boolean') {
        throw new OpenClawTaskLedgerResponseError();
      }
      const resultReason = optionalString(result.reason);
      return {
        found: result.found,
        cancelled: result.cancelled,
        ...(resultReason === undefined ? {} : { reason: resultReason }),
        ...(result.task === undefined ? {} : { task: parseOpenClawTaskSummary(result.task) }),
      };
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawTaskLedgerUnsupportedError(TASKS_CANCEL_METHOD);
      throw error;
    }
  }

  async retry(taskIds: readonly string[]): Promise<OpenClawTaskRecoveryResult> {
    return this.recover(TASKS_RETRY_METHOD, taskIds);
  }

  async dismiss(taskIds: readonly string[]): Promise<OpenClawTaskRecoveryResult> {
    return this.recover(TASKS_DISMISS_METHOD, taskIds);
  }

  private async recover(method: string, taskIds: readonly string[]): Promise<OpenClawTaskRecoveryResult> {
    try {
      return parseRecoveryResult(await this.request(method, recoveryParams(taskIds)));
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawTaskLedgerUnsupportedError(method);
      throw error;
    }
  }

  private unavailable(message: string): OpenClawTaskLedgerUnavailableError {
    return new OpenClawTaskLedgerUnavailableError(message);
  }

  private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !this.dependencies.isConnectionCurrent(connectionId)) {
      throw this.unavailable(`No attested Gateway connection is available for ${method}`);
    }
    try {
      const response = await this.dependencies.requestFenced(method, params, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw this.unavailable(`Gateway connection changed while requesting ${method}`);
      }
      return response;
    } catch (error) {
      if (connectionUnavailable(error)) {
        throw this.unavailable(`No attested Gateway connection is available for ${method}`);
      }
      throw error;
    }
  }
}
