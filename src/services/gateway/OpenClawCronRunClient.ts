import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import {
  enqueueCronRun,
  listCronRuns,
  parseCronRunLogEntry,
  parseCronRunsPage,
  type CronRunLogEntry,
  type CronRunStatus,
  type CronRunsParams,
} from './cronRuns';

export type OpenClawCronRunStatus = CronRunStatus;
export type OpenClawCronRunEntry = CronRunLogEntry;

export interface OpenClawCronRunPage {
  readonly entries: readonly OpenClawCronRunEntry[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
  readonly nextOffset: number | null;
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
    return parseCronRunsPage(value);
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
      if (isOpenClawUnknownMethodError(error, CRON_RUN_METHOD)) {
        throw new OpenClawCronRunUnsupportedError(CRON_RUN_METHOD);
      }
      if (invalidCronResponse(error, CRON_RUN_METHOD)) {
        this.dependencies.diagnostics?.recordCapabilityInvalidResponse?.(CRON_RUN_METHOD);
        throw new OpenClawCronRunResponseError();
      }
      throw error;
    }
  }

  async list(params: CronRunsParams): Promise<OpenClawCronRunPage> {
    try {
      return await listCronRuns(
        (method, params) => this.dependencies.request<unknown>(method, params),
        params,
      );
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, CRON_RUNS_METHOD)) {
        throw new OpenClawCronRunUnsupportedError(CRON_RUNS_METHOD);
      }
      if (invalidCronResponse(error, CRON_RUNS_METHOD)) {
        this.dependencies.diagnostics?.recordCapabilityInvalidResponse?.(CRON_RUNS_METHOD);
        throw new OpenClawCronRunResponseError();
      }
      throw error;
    }
  }

  async findTerminal(jobId: string, runId: string): Promise<OpenClawCronRunEntry | null> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    const normalizedRunId = requiredInputString(runId, 'Invalid OpenClaw cron run id');
    const page = await this.list({ scope: 'job', jobId: id, runId: normalizedRunId, limit: 1, sortDir: 'desc' });
    const entry = page.entries.find((candidate) => candidate.jobId === id && candidate.runId === normalizedRunId);
    return entry?.status === undefined ? null : entry;
  }
}
