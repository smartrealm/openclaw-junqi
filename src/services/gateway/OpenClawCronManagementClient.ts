import { GatewayRpcError } from './Connection';
import type { CronAgentTurnAddParams } from './cronContract';

export interface OpenClawCronManagedJob {
  readonly id: string;
}

export interface OpenClawCronMutationPatch {
  readonly enabled?: boolean;
  readonly agentId?: string | null;
}

export type OpenClawCronManagementRequester = <T>(method: string, params: object) => Promise<T>;

const CRON_ADD_METHOD = 'cron.add';
const CRON_UPDATE_METHOD = 'cron.update';
const CRON_REMOVE_METHOD = 'cron.remove';

export class OpenClawCronManagementUnsupportedError extends Error {
  readonly code = 'OPENCLAW_CRON_MANAGEMENT_UNSUPPORTED';

  constructor(method: string) {
    super(`The connected OpenClaw Gateway does not support ${method}`);
    this.name = 'OpenClawCronManagementUnsupportedError';
  }
}

export class OpenClawCronManagementResponseError extends Error {
  readonly code = 'OPENCLAW_CRON_MANAGEMENT_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid cron mutation response');
    this.name = 'OpenClawCronManagementResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requiredInputString(value: string, message: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(message);
  return normalized;
}

function parseJob(value: unknown): OpenClawCronManagedJob {
  const source = record(value);
  const id = source?.id;
  if (typeof id !== 'string' || !id.trim()) throw new OpenClawCronManagementResponseError();
  return { id };
}

function parseAddResult(value: unknown): OpenClawCronManagedJob {
  const source = record(value);
  if (!source) throw new OpenClawCronManagementResponseError();
  if ('job' in source) {
    if (typeof source.created !== 'boolean') throw new OpenClawCronManagementResponseError();
    if (source.updated !== undefined && typeof source.updated !== 'boolean') {
      throw new OpenClawCronManagementResponseError();
    }
    return parseJob(source.job);
  }
  return parseJob(source);
}

function parseRemoveResult(value: unknown): void {
  const source = record(value);
  if (!source || source.ok !== true || source.removed !== true) {
    throw new OpenClawCronManagementResponseError();
  }
}

function validatePatch(patch: OpenClawCronMutationPatch): Record<string, unknown> {
  const source = record(patch);
  if (!source) throw new Error('Invalid OpenClaw cron update patch');
  const keys = Object.keys(source);
  if (keys.length === 0 || keys.some((key) => key !== 'enabled' && key !== 'agentId')) {
    throw new Error('Invalid OpenClaw cron update patch');
  }
  if ('enabled' in source && typeof source.enabled !== 'boolean') {
    throw new Error('Invalid OpenClaw cron enabled value');
  }
  if ('agentId' in source && source.agentId !== null) {
    if (typeof source.agentId !== 'string' || !source.agentId.trim()) {
      throw new Error('Invalid OpenClaw cron agent id');
    }
  }
  return source;
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

export class OpenClawCronManagementClient {
  constructor(
    private readonly request: OpenClawCronManagementRequester,
  ) {}

  async addAgentTurn(params: CronAgentTurnAddParams): Promise<OpenClawCronManagedJob> {
    try {
      return parseAddResult(await this.request<unknown>(CRON_ADD_METHOD, params));
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronManagementUnsupportedError(CRON_ADD_METHOD);
      throw error;
    }
  }

  async update(jobId: string, patch: OpenClawCronMutationPatch): Promise<OpenClawCronManagedJob> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    const validatedPatch = validatePatch(patch);
    try {
      return parseJob(await this.request<unknown>(CRON_UPDATE_METHOD, { id, patch: validatedPatch }));
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronManagementUnsupportedError(CRON_UPDATE_METHOD);
      throw error;
    }
  }

  async remove(jobId: string): Promise<void> {
    const id = requiredInputString(jobId, 'Invalid OpenClaw cron job id');
    try {
      parseRemoveResult(await this.request<unknown>(CRON_REMOVE_METHOD, { id }));
    } catch (error) {
      if (unsupportedMethod(error)) throw new OpenClawCronManagementUnsupportedError(CRON_REMOVE_METHOD);
      throw error;
    }
  }
}
