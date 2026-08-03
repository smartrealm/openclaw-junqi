import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_MODEL_AUTH_STATUS_METHOD = 'models.authStatus' as const;

const MODEL_AUTH_STATUSES = ['ok', 'expiring', 'expired', 'missing', 'static'] as const;
const MODEL_AUTH_PROFILE_TYPES = ['oauth', 'token', 'api_key'] as const;

export type OpenClawModelAuthStatus = typeof MODEL_AUTH_STATUSES[number];
export type OpenClawModelAuthProfileType = typeof MODEL_AUTH_PROFILE_TYPES[number];

export interface OpenClawModelAuthExpiry {
  readonly at: number;
  readonly remainingMs: number;
  readonly label: string;
}

export interface OpenClawModelAuthProfile {
  readonly type: OpenClawModelAuthProfileType;
  readonly status: OpenClawModelAuthStatus;
  readonly expiry?: OpenClawModelAuthExpiry;
}

export interface OpenClawModelAuthProvider {
  readonly provider: string;
  readonly displayName: string;
  readonly status: OpenClawModelAuthStatus;
  readonly expiry?: OpenClawModelAuthExpiry;
  readonly profiles: readonly OpenClawModelAuthProfile[];
}

export interface OpenClawModelAuthStatusSnapshot {
  readonly timestampMs: number;
  readonly providers: readonly OpenClawModelAuthProvider[];
}

export interface OpenClawModelAuthStatusClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawModelAuthStatusUnavailableError extends Error {
  readonly code = 'OPENCLAW_MODEL_AUTH_STATUS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawModelAuthStatusUnavailableError';
  }
}

export class OpenClawModelAuthStatusResponseError extends Error {
  readonly code = 'OPENCLAW_MODEL_AUTH_STATUS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid models.authStatus response');
    this.name = 'OpenClawModelAuthStatusResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? value as T : null;
}

function expiry(value: unknown): OpenClawModelAuthExpiry | undefined {
  if (value === undefined) return undefined;
  const source = record(value);
  const at = safeTimestamp(source?.at);
  const remainingMs = safeDuration(source?.remainingMs);
  const label = nonEmptyText(source?.label);
  if (!source || at === null || remainingMs === null || !label) {
    throw new OpenClawModelAuthStatusResponseError();
  }
  return { at, remainingMs, label };
}

function profile(value: unknown): OpenClawModelAuthProfile {
  const source = record(value);
  const type = oneOf(source?.type, MODEL_AUTH_PROFILE_TYPES);
  const status = oneOf(source?.status, MODEL_AUTH_STATUSES);
  if (!source || !type || !status) throw new OpenClawModelAuthStatusResponseError();
  const profileExpiry = expiry(source.expiry);
  return { type, status, ...(profileExpiry ? { expiry: profileExpiry } : {}) };
}

function provider(value: unknown): OpenClawModelAuthProvider {
  const source = record(value);
  const providerId = nonEmptyText(source?.provider);
  const displayName = nonEmptyText(source?.displayName);
  const status = oneOf(source?.status, MODEL_AUTH_STATUSES);
  if (!source || !providerId || !displayName || !status || !Array.isArray(source.profiles)) {
    throw new OpenClawModelAuthStatusResponseError();
  }
  const providerExpiry = expiry(source.expiry);
  return {
    provider: providerId,
    displayName,
    status,
    ...(providerExpiry ? { expiry: providerExpiry } : {}),
    profiles: source.profiles.map(profile),
  };
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawModelAuthStatus(value: unknown): OpenClawModelAuthStatusSnapshot {
  const source = record(value);
  const timestampMs = safeTimestamp(source?.ts);
  if (!source || timestampMs === null || !Array.isArray(source.providers)) {
    throw new OpenClawModelAuthStatusResponseError();
  }
  return { timestampMs, providers: source.providers.map(provider) };
}

export class OpenClawModelAuthStatusClient {
  constructor(private readonly dependencies: OpenClawModelAuthStatusClientDependencies) {}

  async get(): Promise<OpenClawModelAuthStatusSnapshot> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawModelAuthStatusUnavailableError('No attested Gateway connection is available for model authentication status');
    }
    try {
      const response = await this.dependencies.requestFenced(OPENCLAW_MODEL_AUTH_STATUS_METHOD, {}, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawModelAuthStatusUnavailableError('Gateway connection changed while reading model authentication status');
      }
      return parseOpenClawModelAuthStatus(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawModelAuthStatusUnavailableError('The connected OpenClaw Gateway does not support models.authStatus');
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawModelAuthStatusUnavailableError('No attested Gateway connection is available for model authentication status');
      }
      throw error;
    }
  }
}
