import { GatewayDisconnectedError, GatewayRpcError } from './Connection';

export const OPENCLAW_SETUP_DETECT_METHOD = 'openclaw.setup.detect' as const;
export const OPENCLAW_SETUP_VERIFY_METHOD = 'openclaw.setup.verify' as const;

export interface OpenClawSetupDetection {
  readonly setupComplete: boolean;
  readonly configuredModel?: string;
}

export type OpenClawSetupVerification =
  | { readonly ok: true; readonly modelRef: string; readonly latencyMs: number }
  | { readonly ok: false; readonly status: OpenClawSetupVerificationFailureStatus; readonly error: string };

const FAILURE_STATUSES = [
  'auth',
  'rate_limit',
  'billing',
  'timeout',
  'format',
  'unavailable',
  'unknown',
] as const;

export type OpenClawSetupVerificationFailureStatus = typeof FAILURE_STATUSES[number];

export class OpenClawSetupMethodUnavailableError extends Error {
  readonly code = 'OPENCLAW_SETUP_METHOD_UNAVAILABLE';

  constructor(method: string, reason: string) {
    super(`OpenClaw setup method ${method} is unavailable: ${reason}`);
    this.name = 'OpenClawSetupMethodUnavailableError';
  }
}

export class OpenClawSetupResponseError extends Error {
  readonly code = 'OPENCLAW_SETUP_RESPONSE_INVALID';

  constructor(method: string) {
    super(`The OpenClaw Gateway returned an invalid ${method} response`);
    this.name = 'OpenClawSetupResponseError';
  }
}

export interface OpenClawSetupClientDependencies {
  requestPrivileged: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function failureStatus(value: unknown): OpenClawSetupVerificationFailureStatus | null {
  return typeof value === 'string' && FAILURE_STATUSES.includes(value as OpenClawSetupVerificationFailureStatus)
    ? value as OpenClawSetupVerificationFailureStatus
    : null;
}

function unsupportedMethod(error: unknown): boolean {
  if (!(error instanceof GatewayRpcError)) return false;
  if (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND') {
    return true;
  }
  return error.code === 'INVALID_REQUEST' && /^unknown method:/i.test(error.message.trim());
}

export function parseOpenClawSetupDetection(value: unknown): OpenClawSetupDetection {
  const source = record(value);
  if (!source || typeof source.setupComplete !== 'boolean') {
    throw new OpenClawSetupResponseError(OPENCLAW_SETUP_DETECT_METHOD);
  }
  const configuredModel = source.configuredModel === undefined
    ? undefined
    : nonEmptyText(source.configuredModel);
  if (source.configuredModel !== undefined && !configuredModel) {
    throw new OpenClawSetupResponseError(OPENCLAW_SETUP_DETECT_METHOD);
  }
  return {
    setupComplete: source.setupComplete,
    ...(configuredModel ? { configuredModel } : {}),
  };
}

export function parseOpenClawSetupVerification(value: unknown): OpenClawSetupVerification {
  const source = record(value);
  if (!source || typeof source.ok !== 'boolean') {
    throw new OpenClawSetupResponseError(OPENCLAW_SETUP_VERIFY_METHOD);
  }
  if (source.ok) {
    const modelRef = nonEmptyText(source.modelRef);
    const latencyMs = source.latencyMs;
    if (!modelRef || typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) {
      throw new OpenClawSetupResponseError(OPENCLAW_SETUP_VERIFY_METHOD);
    }
    return { ok: true, modelRef, latencyMs };
  }

  const status = failureStatus(source.status);
  const error = nonEmptyText(source.error);
  if (!status || !error) throw new OpenClawSetupResponseError(OPENCLAW_SETUP_VERIFY_METHOD);
  return { ok: false, status, error };
}

export class OpenClawSetupClient {
  constructor(private readonly dependencies: OpenClawSetupClientDependencies) {}

  async detect(): Promise<OpenClawSetupDetection> {
    return await this.request(
      OPENCLAW_SETUP_DETECT_METHOD,
      parseOpenClawSetupDetection,
    );
  }

  async verify(): Promise<OpenClawSetupVerification> {
    return await this.request(
      OPENCLAW_SETUP_VERIFY_METHOD,
      parseOpenClawSetupVerification,
    );
  }

  private async request<T>(method: string, parse: (value: unknown) => T): Promise<T> {
    try {
      return parse(await this.dependencies.requestPrivileged(method, {}));
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawSetupMethodUnavailableError(method, 'Gateway method is not supported');
      }
      if (error instanceof GatewayDisconnectedError) {
        throw new OpenClawSetupMethodUnavailableError(method, 'authenticated Gateway connection is unavailable');
      }
      throw error;
    }
  }
}
