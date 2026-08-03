import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_PROVIDER_USAGE_METHOD = 'usage.status' as const;

export interface OpenClawProviderUsageWindow {
  readonly label: string;
  readonly usedPercent: number;
  readonly resetAt?: number;
}

export interface OpenClawProviderUsageProvider {
  readonly provider: string;
  readonly displayName: string;
  readonly windows: readonly OpenClawProviderUsageWindow[];
}

export interface OpenClawProviderUsageSnapshot {
  readonly updatedAt: number;
  readonly providers: readonly OpenClawProviderUsageProvider[];
}

export interface OpenClawProviderUsageClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawProviderUsageUnavailableError extends Error {
  readonly code = 'OPENCLAW_PROVIDER_USAGE_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawProviderUsageUnavailableError';
  }
}

export class OpenClawProviderUsageResponseError extends Error {
  readonly code = 'OPENCLAW_PROVIDER_USAGE_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid usage.status response');
    this.name = 'OpenClawProviderUsageResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function percent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function window(value: unknown): OpenClawProviderUsageWindow {
  const source = record(value);
  const label = text(source?.label);
  const usedPercent = percent(source?.usedPercent);
  const resetAt = source?.resetAt === undefined ? undefined : timestamp(source.resetAt);
  if (!source || !label || usedPercent === null || resetAt === null) {
    throw new OpenClawProviderUsageResponseError();
  }
  return { label, usedPercent, ...(resetAt === undefined ? {} : { resetAt }) };
}

function provider(value: unknown): OpenClawProviderUsageProvider {
  const source = record(value);
  const providerId = text(source?.provider);
  const displayName = text(source?.displayName);
  if (!source || !providerId || !displayName || !Array.isArray(source.windows)) {
    throw new OpenClawProviderUsageResponseError();
  }
  return { provider: providerId, displayName, windows: source.windows.map(window) };
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawProviderUsage(value: unknown): OpenClawProviderUsageSnapshot {
  const source = record(value);
  const updatedAt = timestamp(source?.updatedAt);
  if (!source || updatedAt === null || !Array.isArray(source.providers)) {
    throw new OpenClawProviderUsageResponseError();
  }
  return { updatedAt, providers: source.providers.map(provider) };
}

export class OpenClawProviderUsageClient {
  constructor(private readonly dependencies: OpenClawProviderUsageClientDependencies) {}

  async get(): Promise<OpenClawProviderUsageSnapshot> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawProviderUsageUnavailableError('No attested Gateway connection is available for provider usage');
    }
    try {
      const response = await this.dependencies.requestFenced(OPENCLAW_PROVIDER_USAGE_METHOD, {}, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawProviderUsageUnavailableError('Gateway connection changed while reading provider usage');
      }
      return parseOpenClawProviderUsage(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawProviderUsageUnavailableError('The connected OpenClaw Gateway does not support usage.status');
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawProviderUsageUnavailableError('No attested Gateway connection is available for provider usage');
      }
      throw error;
    }
  }
}
