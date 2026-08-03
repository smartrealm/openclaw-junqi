import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_SESSION_USAGE_LOGS_METHOD = 'sessions.usage.logs' as const;

export type OpenClawSessionUsageLogRole = 'user' | 'assistant' | 'tool' | 'toolResult';

export interface OpenClawSessionUsageLogEntry {
  readonly timestamp: number;
  readonly role: OpenClawSessionUsageLogRole;
  readonly content: string;
  readonly tokens?: number;
}

export interface OpenClawSessionUsageLogsClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawSessionUsageLogsUnavailableError extends Error {
  readonly code = 'OPENCLAW_SESSION_USAGE_LOGS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawSessionUsageLogsUnavailableError';
  }
}

export class OpenClawSessionUsageLogsResponseError extends Error {
  readonly code = 'OPENCLAW_SESSION_USAGE_LOGS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid sessions.usage.logs response');
    this.name = 'OpenClawSessionUsageLogsResponseError';
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

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function role(value: unknown): OpenClawSessionUsageLogRole | null {
  switch (value) {
    case 'user':
    case 'assistant':
    case 'tool':
    case 'toolResult':
      return value;
    default:
      return null;
  }
}

function optionalTokens(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  return nonNegativeInteger(value);
}

function entry(value: unknown): OpenClawSessionUsageLogEntry {
  const source = record(value);
  const timestamp = nonNegativeInteger(source?.timestamp);
  const entryRole = role(source?.role);
  const content = text(source?.content);
  const tokens = optionalTokens(source?.tokens);
  if (!source || timestamp === null || !entryRole || !content || tokens === null) {
    throw new OpenClawSessionUsageLogsResponseError();
  }
  return {
    timestamp,
    role: entryRole,
    content,
    ...(tokens === undefined ? {} : { tokens }),
  };
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

export function parseOpenClawSessionUsageLogs(value: unknown): readonly OpenClawSessionUsageLogEntry[] {
  const source = record(value);
  if (!source || !Array.isArray(source.logs)) throw new OpenClawSessionUsageLogsResponseError();
  return source.logs.map(entry);
}

export class OpenClawSessionUsageLogsClient {
  constructor(private readonly dependencies: OpenClawSessionUsageLogsClientDependencies) {}

  async get(sessionKey: string): Promise<readonly OpenClawSessionUsageLogEntry[]> {
    const key = sessionKey.trim();
    if (!key) throw new OpenClawSessionUsageLogsResponseError();
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId) {
      throw new OpenClawSessionUsageLogsUnavailableError(
        'No attested Gateway connection is available for session usage logs',
      );
    }
    try {
      const response = await this.dependencies.requestFenced(
        OPENCLAW_SESSION_USAGE_LOGS_METHOD,
        { key },
        connectionId,
      );
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw new OpenClawSessionUsageLogsUnavailableError(
          'Gateway connection changed while reading session usage logs',
        );
      }
      return parseOpenClawSessionUsageLogs(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw new OpenClawSessionUsageLogsUnavailableError(
          'The connected OpenClaw Gateway does not support sessions.usage.logs',
        );
      }
      if (connectionUnavailable(error)) {
        throw new OpenClawSessionUsageLogsUnavailableError(
          'No attested Gateway connection is available for session usage logs',
        );
      }
      throw error;
    }
  }
}
