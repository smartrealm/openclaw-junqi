import { GatewayRpcError } from './Connection';

type SessionMutationRunner = <T>(sessionKey: string, operation: () => Promise<T>) => Promise<T>;
type GatewayRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export interface OpenClawSessionOrganizationClientDeps {
  readonly runMutation: SessionMutationRunner;
  readonly request: GatewayRequester;
}

export class SessionOrganizationResponseError extends Error {
  readonly code = 'SESSION_ORGANIZATION_RESPONSE_INVALID';

  constructor() {
    super('SESSION_ORGANIZATION_RESPONSE_INVALID');
    this.name = 'SessionOrganizationResponseError';
  }
}

/**
 * Signals an installed Gateway that predates the native organization protocol.
 * Callers use it to report the unavailable native capability; it never authorizes
 * a client-owned organization fallback. Authentication and transport failures
 * deliberately do not use this error.
 */
export class SessionOrganizationProtocolUnsupportedError extends Error {
  readonly code = 'SESSION_ORGANIZATION_PROTOCOL_UNSUPPORTED';

  constructor(readonly cause: GatewayRpcError) {
    super(cause.message);
    this.name = 'SessionOrganizationProtocolUnsupportedError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function confirmedPatchResult(result: unknown, sessionKey: string): Record<string, unknown> {
  if (!isRecord(result) || result.ok !== true || result.key !== sessionKey || !isRecord(result.entry)) {
    throw new SessionOrganizationResponseError();
  }
  return result.entry;
}

function isUnsupportedProtocolError(error: unknown): error is GatewayRpcError {
  if (!(error instanceof GatewayRpcError)) return false;
  const code = error.code?.trim().toUpperCase();
  if (code === 'METHOD_NOT_FOUND' || code === 'UNKNOWN_METHOD' || code === 'UNKNOWN_COMMAND') return true;
  if (code !== 'INVALID_PARAMS' && code !== 'INVALID_REQUEST' && code !== 'VALIDATION_ERROR') return false;
  return /\b(pinned|unread|archived|category)\b/i.test(error.message);
}

/** Native OpenClaw session organization API, isolated from UI and store code. */
export class OpenClawSessionOrganizationClient {
  constructor(private readonly deps: OpenClawSessionOrganizationClientDeps) {}

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.deps.request<T>(method, params);
    } catch (error) {
      if (isUnsupportedProtocolError(error)) {
        throw new SessionOrganizationProtocolUnsupportedError(error);
      }
      throw error;
    }
  }

  private patch(sessionKey: string, patch: Record<string, boolean | string | null>): Promise<Record<string, unknown>> {
    return this.deps.runMutation(sessionKey, async () => {
      const result = await this.request<unknown>('sessions.patch', { key: sessionKey, ...patch });
      return confirmedPatchResult(result, sessionKey);
    });
  }

  async setPinned(sessionKey: string, pinned: boolean): Promise<void> {
    await this.patch(sessionKey, { pinned });
  }

  async setUnread(sessionKey: string, unread: boolean): Promise<void> {
    await this.patch(sessionKey, { unread });
  }

  async setArchived(sessionKey: string, archived: boolean): Promise<void> {
    await this.patch(sessionKey, { archived });
  }

  async setCategory(sessionKey: string, category: string | null): Promise<string | null> {
    const entry = await this.patch(sessionKey, { category });
    const confirmed = entry.category;
    if (category === null) {
      if (confirmed !== undefined && confirmed !== null) throw new SessionOrganizationResponseError();
      return null;
    }
    const expected = category.trim();
    if (typeof confirmed !== 'string' || confirmed.trim() !== expected) {
      throw new SessionOrganizationResponseError();
    }
    return confirmed.trim();
  }
}
