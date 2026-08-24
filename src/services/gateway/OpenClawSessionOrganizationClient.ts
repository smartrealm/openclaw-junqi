import { GatewayRpcError } from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';
import { resolveOpenClawSessionTarget } from './OpenClawSessionTarget';

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
 * 表示已安装的 Gateway 早于原生会话组织协议。
 * 调用方据此展示不可用的原生能力；不得以此授权客户端自建组织功能。
 * 鉴权和传输失败不使用此错误。
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

function isConfirmedTimestamp(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** 组织字段只能以 Gateway 已持久化的时间戳回执为准，不能以请求值推断成功。 */
function requireConfirmedTimestampState(
  entry: Record<string, unknown>,
  field: 'pinnedAt' | 'archivedAt' | 'markedUnreadAt',
  expected: boolean,
): void {
  if (expected ? !isConfirmedTimestamp(entry[field]) : entry[field] !== undefined) {
    throw new SessionOrganizationResponseError();
  }
}

/** 原生 OpenClaw 会话组织 API，与 UI 和状态仓隔离。 */
export class OpenClawSessionOrganizationClient {
  constructor(private readonly deps: OpenClawSessionOrganizationClientDeps) {}

  private async request<T>(method: string, params: Record<string, unknown>): Promise<T> {
    try {
      return await this.deps.request<T>(method, params);
    } catch (error) {
      if (isOpenClawUnknownMethodError(error, method)) {
        throw new SessionOrganizationProtocolUnsupportedError(error as GatewayRpcError);
      }
      throw error;
    }
  }

  private patch(
    sessionKey: string,
    patch: Record<string, boolean | string | null>,
    expectedSessionId?: string,
  ): Promise<Record<string, unknown>> {
    const target = resolveOpenClawSessionTarget(sessionKey);
    return this.deps.runMutation(target.localKey, async () => {
      const result = await this.request<unknown>('sessions.patch', {
        key: target.key,
        ...(target.agentId ? { agentId: target.agentId } : {}),
        ...(expectedSessionId?.trim() ? { expectedSessionId: expectedSessionId.trim() } : {}),
        ...patch,
      });
      return confirmedPatchResult(result, target.key);
    });
  }

  async setPinned(sessionKey: string, pinned: boolean): Promise<void> {
    requireConfirmedTimestampState(await this.patch(sessionKey, { pinned }), 'pinnedAt', pinned);
  }

  async setUnread(sessionKey: string, unread: boolean): Promise<void> {
    const entry = await this.patch(sessionKey, { unread });
    requireConfirmedTimestampState(entry, 'markedUnreadAt', unread);
    if (!unread && !isConfirmedTimestamp(entry.lastReadAt)) {
      throw new SessionOrganizationResponseError();
    }
  }

  async setArchived(sessionKey: string, archived: boolean, expectedSessionId?: string): Promise<void> {
    const entry = await this.patch(sessionKey, { archived }, expectedSessionId);
    requireConfirmedTimestampState(entry, 'archivedAt', archived);
    if (archived && entry.pinnedAt !== undefined) {
      throw new SessionOrganizationResponseError();
    }
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
