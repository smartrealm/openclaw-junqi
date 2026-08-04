import {
  GatewayConnectionFenceError,
  GatewayDisconnectedError,
  GatewayRpcError,
} from './Connection';

export const OPENCLAW_HOOKS_STATUS_METHOD = 'hooks.status' as const;

export type OpenClawHookBlockedReason =
  | 'disabled in config'
  | 'workspace hook (disabled by default)'
  | 'missing requirements'
  | 'no events defined';

export interface OpenClawHookStatusEntry {
  readonly name: string;
  readonly description: string;
  readonly pluginId?: string;
  readonly events: readonly string[];
  readonly unknownEvents: readonly string[];
  readonly enabledByConfig: boolean;
  readonly requirementsSatisfied: boolean;
  readonly loadable: boolean;
  readonly blockedReason?: OpenClawHookBlockedReason;
  readonly managedByPlugin: boolean;
}

export interface OpenClawHooksStatusSnapshot {
  readonly hooks: readonly OpenClawHookStatusEntry[];
}

export interface OpenClawHooksStatusClientDependencies {
  captureConnectionId: () => string | null;
  isConnectionCurrent: (connectionId: string) => boolean;
  requestFenced: (method: string, params: Record<string, unknown>, connectionId: string) => Promise<unknown>;
}

export class OpenClawHooksStatusUnavailableError extends Error {
  readonly code = 'OPENCLAW_HOOKS_STATUS_UNAVAILABLE';

  constructor(message: string) {
    super(message);
    this.name = 'OpenClawHooksStatusUnavailableError';
  }
}

export class OpenClawHooksStatusResponseError extends Error {
  readonly code = 'OPENCLAW_HOOKS_STATUS_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid hooks.status response');
    this.name = 'OpenClawHooksStatusResponseError';
  }
}

const BLOCKED_REASONS: readonly OpenClawHookBlockedReason[] = [
  'disabled in config',
  'workspace hook (disabled by default)',
  'missing requirements',
  'no events defined',
];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const entries = value.map(nonEmptyString);
  return entries.every((entry): entry is string => entry !== null) ? entries : null;
}

function optionalBlockedReason(value: unknown): OpenClawHookBlockedReason | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === 'string' && BLOCKED_REASONS.includes(value as OpenClawHookBlockedReason)
    ? value as OpenClawHookBlockedReason
    : null;
}

function parseEntry(value: unknown): OpenClawHookStatusEntry {
  const source = record(value);
  const name = nonEmptyString(source?.name);
  const description = typeof source?.description === 'string' ? source.description : null;
  const pluginId = source?.pluginId === undefined ? undefined : nonEmptyString(source.pluginId);
  const events = stringArray(source?.events);
  const unknownEvents = stringArray(source?.unknownEvents);
  const blockedReason = optionalBlockedReason(source?.blockedReason);
  if (
    !source
    || !name
    || description === null
    || pluginId === null
    || events === null
    || unknownEvents === null
    || blockedReason === null
    || typeof source.enabledByConfig !== 'boolean'
    || typeof source.requirementsSatisfied !== 'boolean'
    || typeof source.loadable !== 'boolean'
    || typeof source.managedByPlugin !== 'boolean'
  ) {
    throw new OpenClawHooksStatusResponseError();
  }
  return {
    name,
    description,
    ...(pluginId === undefined ? {} : { pluginId }),
    events,
    unknownEvents,
    enabledByConfig: source.enabledByConfig,
    requirementsSatisfied: source.requirementsSatisfied,
    loadable: source.loadable,
    ...(blockedReason === undefined ? {} : { blockedReason }),
    managedByPlugin: source.managedByPlugin,
  };
}

function unsupportedMethod(error: unknown): boolean {
  return error instanceof GatewayRpcError
    && (error.code === 'METHOD_NOT_FOUND' || error.code === 'UNKNOWN_METHOD' || error.code === 'UNKNOWN_COMMAND');
}

function connectionUnavailable(error: unknown): boolean {
  return error instanceof GatewayDisconnectedError || error instanceof GatewayConnectionFenceError;
}

/** 只投影 Gateway 已计算的 Hook 可用性，不向界面暴露本机路径或需求细节。 */
export function parseOpenClawHooksStatus(value: unknown): OpenClawHooksStatusSnapshot {
  const source = record(value);
  if (!source || !Array.isArray(source.hooks)) throw new OpenClawHooksStatusResponseError();
  return { hooks: source.hooks.map(parseEntry) };
}

export class OpenClawHooksStatusClient {
  constructor(private readonly dependencies: OpenClawHooksStatusClientDependencies) {}

  async get(): Promise<OpenClawHooksStatusSnapshot> {
    const connectionId = this.dependencies.captureConnectionId();
    if (!connectionId || !this.dependencies.isConnectionCurrent(connectionId)) {
      throw this.unavailable('No attested Gateway connection is available for hooks.status');
    }
    try {
      const response = await this.dependencies.requestFenced(OPENCLAW_HOOKS_STATUS_METHOD, {}, connectionId);
      if (!this.dependencies.isConnectionCurrent(connectionId)) {
        throw this.unavailable('Gateway connection changed while reading hooks.status');
      }
      return parseOpenClawHooksStatus(response);
    } catch (error) {
      if (unsupportedMethod(error)) {
        throw this.unavailable('The connected OpenClaw Gateway does not support hooks.status');
      }
      if (connectionUnavailable(error)) {
        throw this.unavailable('No attested Gateway connection is available for hooks.status');
      }
      throw error;
    }
  }

  private unavailable(message: string): OpenClawHooksStatusUnavailableError {
    return new OpenClawHooksStatusUnavailableError(message);
  }
}
