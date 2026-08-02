import { GatewayRpcError } from './Connection';

type SessionMutationRunner = <T>(sessionKey: string, operation: () => Promise<T>) => Promise<T>;
type GatewayRequester = <T>(method: string, params: Record<string, unknown>) => Promise<T>;

export type NativeSessionGroup = {
  readonly id: string;
  readonly label: string;
};

export interface OpenClawSessionOrganizationClientDeps {
  readonly runMutation: SessionMutationRunner;
  readonly requestPrivileged: GatewayRequester;
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
 * Authentication and transport failures deliberately do not use this error.
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

function confirmedPatchResult(result: unknown, sessionKey: string): void {
  if (!isRecord(result) || result.ok !== true || result.key !== sessionKey || !isRecord(result.entry)) {
    throw new SessionOrganizationResponseError();
  }
}

function isUnsupportedProtocolError(error: unknown): error is GatewayRpcError {
  if (!(error instanceof GatewayRpcError)) return false;
  const code = error.code?.trim().toUpperCase();
  if (code === 'METHOD_NOT_FOUND' || code === 'UNKNOWN_METHOD' || code === 'UNKNOWN_COMMAND') return true;
  if (code !== 'INVALID_PARAMS' && code !== 'INVALID_REQUEST' && code !== 'VALIDATION_ERROR') return false;
  return /sessions\.groups|\b(pinned|unread|archived|category)\b/i.test(error.message);
}

function normalizeGroups(result: unknown): NativeSessionGroup[] {
  if (!isRecord(result) || !Array.isArray(result.groups)) {
    throw new SessionOrganizationResponseError();
  }
  return result.groups.flatMap((value) => {
    if (isRecord(value) && typeof value.name === 'string' && value.name.trim()) {
      const label = value.name.trim();
      return [{ id: label, label }];
    }
    return [];
  });
}

function confirmedGroupMutation(result: unknown): void {
  if (!isRecord(result) || result.ok !== true || !Array.isArray(result.groups)) {
    throw new SessionOrganizationResponseError();
  }
}

/** Native OpenClaw session organization API, isolated from UI and store code. */
export class OpenClawSessionOrganizationClient {
  constructor(private readonly deps: OpenClawSessionOrganizationClientDeps) {}

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.deps.requestPrivileged<T>(method, params);
    } catch (error) {
      if (isUnsupportedProtocolError(error)) {
        throw new SessionOrganizationProtocolUnsupportedError(error);
      }
      throw error;
    }
  }

  private patch(sessionKey: string, patch: Record<string, boolean | string | null>): Promise<void> {
    return this.deps.runMutation(sessionKey, async () => {
      const result = await this.request<unknown>('sessions.patch', { key: sessionKey, ...patch });
      confirmedPatchResult(result, sessionKey);
    });
  }

  setPinned(sessionKey: string, pinned: boolean): Promise<void> {
    return this.patch(sessionKey, { pinned });
  }

  setUnread(sessionKey: string, unread: boolean): Promise<void> {
    return this.patch(sessionKey, { unread });
  }

  setArchived(sessionKey: string, archived: boolean): Promise<void> {
    return this.patch(sessionKey, { archived });
  }

  setCategory(sessionKey: string, category: string | null): Promise<void> {
    return this.patch(sessionKey, { category });
  }

  async listGroups(): Promise<NativeSessionGroup[]> {
    return normalizeGroups(await this.request<unknown>('sessions.groups.list', {}));
  }

  async putGroup(label: string): Promise<void> {
    const groups = await this.listGroups();
    const names = groups.map((group) => group.label);
    if (!names.includes(label)) names.push(label);
    confirmedGroupMutation(await this.request<unknown>('sessions.groups.put', { names }));
  }

  async renameGroup(from: string, to: string): Promise<void> {
    confirmedGroupMutation(await this.request<unknown>('sessions.groups.rename', { name: from, to }));
  }

  async deleteGroup(label: string): Promise<void> {
    confirmedGroupMutation(await this.request<unknown>('sessions.groups.delete', { name: label }));
  }
}
