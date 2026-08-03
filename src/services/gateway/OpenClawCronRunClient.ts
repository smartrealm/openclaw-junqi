import { GatewayRpcError } from './Connection';

export type OpenClawCronRunStatus = 'ok' | 'error' | 'skipped';

export interface OpenClawCronRunEntry {
  readonly ts: number;
  readonly jobId: string;
  readonly action: 'finished';
  readonly status?: OpenClawCronRunStatus;
  readonly runId?: string;
  readonly summary?: string;
  readonly error?: string;
  readonly durationMs?: number;
  readonly jobName?: string;
}

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
export type OpenClawCronRunAdvertisedMethodLookup = (method: string) => boolean | null;

const CRON_RUN_METHOD = 'cron.run';
const CRON_RUNS_METHOD = 'cron.runs';

export class OpenClawCronRunUnsupportedError extends Error {
  readonly code = 'OPENCLAW_CRON_RUN_UNSUPPORTED';

  constructor(method: string) {
    super(`The connected OpenClaw Gateway does not advertise ${method}`);
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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new OpenClawCronRunResponseError();
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new OpenClawCronRunResponseError();
  return value;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new OpenClawCronRunResponseError();
  }
  return value;
}

function requiredInteger(value: unknown): number {
  const parsed = optionalInteger(value);
  if (parsed === undefined) throw new OpenClawCronRunResponseError();
  return parsed;
}

function requiredInputString(value: string, message: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(message);
  return value;
}

function cronRunStatus(value: unknown): OpenClawCronRunStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'ok' || value === 'error' || value === 'skipped') return value;
  throw new OpenClawCronRunResponseError();
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

export function parseOpenClawCronRunEntry(value: unknown): OpenClawCronRunEntry {
  const source = record(value);
  if (!source || source.action !== 'finished') throw new OpenClawCronRunResponseError();
  const status = cronRunStatus(source.status);
  const runId = optionalString(source.runId);
  const summary = optionalString(source.summary);
  const error = optionalString(source.error);
  const durationMs = optionalInteger(source.durationMs);
  const jobName = optionalString(source.jobName);
  return {
    ts: requiredInteger(source.ts),
    jobId: requiredString(source.jobId),
    action: 'finished',
    ...(status === undefined ? {} : { status }),
    ...(runId === undefined ? {} : { runId }),
    ...(summary === undefined ? {} : { summary }),
    ...(error === undefined ? {} : { error }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(jobName === undefined ? {} : { jobName }),
  };
}

export function parseOpenClawCronRunPage(value: unknown): OpenClawCronRunPage {
  const source = record(value);
  if (!source || !Array.isArray(source.entries)) throw new OpenClawCronRunResponseError();
  return { entries: source.entries.map(parseOpenClawCronRunEntry) };
}

export class OpenClawCronRunClient {
  constructor(
    private readonly request: OpenClawCronRunRequester,
    private readonly hasAdvertisedMethod: OpenClawCronRunAdvertisedMethodLookup,
  ) {}

  async enqueue(jobId: string): Promise<OpenClawCronRunAcknowledgement> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    if (this.hasAdvertisedMethod(CRON_RUN_METHOD) === false) {
      throw new OpenClawCronRunUnsupportedError(CRON_RUN_METHOD);
    }
    try {
      const source = record(await this.request<unknown>(CRON_RUN_METHOD, { id, mode: 'force' }));
      if (!source || typeof source.ok !== 'boolean') throw new OpenClawCronRunResponseError();
      const enqueued = source.enqueued === true;
      const runId = optionalString(source.runId);
      const reason = optionalString(source.reason);
      if (enqueued && runId === undefined) throw new OpenClawCronRunResponseError();
      return { ok: source.ok, enqueued, ...(runId === undefined ? {} : { runId }), ...(reason === undefined ? {} : { reason }) };
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronRunUnsupportedError(CRON_RUN_METHOD);
      throw error;
    }
  }

  async list(jobId: string, runId?: string): Promise<OpenClawCronRunPage> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    if (runId !== undefined) requiredInputString(runId, 'Invalid OpenClaw cron run id');
    if (this.hasAdvertisedMethod(CRON_RUNS_METHOD) === false) {
      throw new OpenClawCronRunUnsupportedError(CRON_RUNS_METHOD);
    }
    try {
      return parseOpenClawCronRunPage(await this.request<unknown>(CRON_RUNS_METHOD, {
        id,
        ...(runId === undefined ? {} : { runId }),
        limit: runId === undefined ? 14 : 1,
      }));
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronRunUnsupportedError(CRON_RUNS_METHOD);
      throw error;
    }
  }

  async findTerminal(jobId: string, runId: string): Promise<OpenClawCronRunEntry | null> {
    const page = await this.list(jobId, runId);
    const entry = page.entries.find((candidate) => candidate.jobId === jobId && candidate.runId === runId);
    return entry?.status === undefined ? null : entry;
  }
}
