import { GatewayRpcError } from './Connection';
import {
  enqueueCronRun,
  listCronRuns,
  parseCronRunLogEntry,
  parseCronRunsPage,
  type CronRunLogEntry,
  type CronRunStatus,
} from './cronRuns';

export type OpenClawCronRunStatus = CronRunStatus;
export type OpenClawCronRunEntry = CronRunLogEntry;

export interface OpenClawCronRunPage {
  readonly entries: readonly OpenClawCronRunEntry[];
}

export interface OpenClawCronRunAcknowledgement {
  readonly ok: boolean;
  readonly enqueued: boolean;
  readonly runId?: string;
  readonly reason?: string;
}

export type OpenClawCronRunRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export interface OpenClawCronRunDiagnostics {
  recordCapabilityInvalidResponse?: (method: string) => void;
}

export interface OpenClawCronRunClientDependencies {
  readonly request: OpenClawCronRunRequester;
  readonly requestPrivileged: OpenClawCronRunRequester;
  readonly diagnostics?: OpenClawCronRunDiagnostics;
}

const CRON_RUN_METHOD = 'cron.run';
const CRON_RUNS_METHOD = 'cron.runs';

export class OpenClawCronRunUnsupportedError extends Error {
  readonly code = 'OPENCLAW_CRON_RUN_UNSUPPORTED';

  constructor(method: string) {
    super(`The connected OpenClaw Gateway does not support ${method}`);
    this.name = 'OpenClawCronRunUnsupportedError';
  }
}

export class OpenClawCronRunResponseError extends Error {
  readonly code = 'OPENCLAW_CRON_RUN_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid cron run response');
    this.name = 'OpenClawCronRunResponseError';
  }
}

function requiredInputString(value: string, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function invalidCronResponse(error: unknown, method: string): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith(`${method} returned an invalid`)
    || (method === CRON_RUN_METHOD && error.message.startsWith('cron.run returned an enqueued result'));
}

export function parseOpenClawCronRunEntry(value: unknown): OpenClawCronRunEntry {
  try {
    return parseCronRunLogEntry(value);
  } catch {
    throw new OpenClawCronRunResponseError();
  }
}

export function parseOpenClawCronRunPage(value: unknown): OpenClawCronRunPage {
  try {
    return { entries: parseCronRunsPage(value).entries };
  } catch {
    throw new OpenClawCronRunResponseError();
  }
}

export class OpenClawCronRunClient {
  constructor(private readonly dependencies: OpenClawCronRunClientDependencies) {}

  async enqueue(jobId: string): Promise<OpenClawCronRunAcknowledgement> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    try {
      const result = await enqueueCronRun(
        (method, params) => this.dependencies.requestPrivileged<unknown>(method, params),
        id,
        'force',
      );
      return {
        ok: result.ok,
        enqueued: result.enqueued === true,
        ...(result.runId ? { runId: result.runId } : {}),
        ...(result.reason ? { reason: result.reason } : {}),
      };
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronRunUnsupportedError(CRON_RUN_METHOD);
      if (invalidCronResponse(error, CRON_RUN_METHOD)) {
        this.dependencies.diagnostics?.recordCapabilityInvalidResponse?.(CRON_RUN_METHOD);
        throw new OpenClawCronRunResponseError();
      }
      throw error;
    }
  }

  async list(jobId: string, runId?: string): Promise<OpenClawCronRunPage> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    if (runId !== undefined) requiredInputString(runId, 'Invalid OpenClaw cron run id');
    try {
      const page = await listCronRuns(
        (method, params) => this.dependencies.request<unknown>(method, params),
        {
          jobId: id,
          ...(runId === undefined ? {} : { runId }),
          limit: runId === undefined ? 14 : 1,
        },
      );
      return { entries: page.entries };
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronRunUnsupportedError(CRON_RUNS_METHOD);
      if (invalidCronResponse(error, CRON_RUNS_METHOD)) {
        this.dependencies.diagnostics?.recordCapabilityInvalidResponse?.(CRON_RUNS_METHOD);
        throw new OpenClawCronRunResponseError();
      }
      throw error;
    }
  }

  async findTerminal(jobId: string, runId: string): Promise<OpenClawCronRunEntry | null> {
    const page = await this.list(jobId, runId);
    const entry = page.entries.find((candidate) => candidate.jobId === jobId && candidate.runId === runId);
    return entry?.status === undefined ? null : entry;
  }
}
