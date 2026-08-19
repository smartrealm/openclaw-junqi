import { createOpenClawGlobalSessionAlias } from './OpenClawSessionTarget';

export interface OpenClawSessionProjection extends Record<string, unknown> {
  readonly key: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly createdAt?: number;
  readonly label?: string;
  readonly displayName?: string;
  readonly derivedTitle?: string;
  readonly lastMessagePreview?: string;
  readonly category?: string;
  readonly running?: boolean;
  readonly totalTokens?: number;
  readonly contextTokens?: number;
  readonly model?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly unread?: boolean;
}

export interface OpenClawAgentListProjection {
  readonly defaultId: string;
  readonly mainKey: string;
  readonly scope: 'per-sender' | 'global';
  readonly agents: ReadonlyArray<Record<string, unknown> & { id: string }>;
}

/** 根据 OpenClaw 的会话路由规则还原默认智能体的完整主会话 key。 */
export function resolveOpenClawDefaultMainSessionKey(snapshot: Pick<
  OpenClawAgentListProjection,
  'defaultId' | 'mainKey' | 'scope'
>): string {
  if (snapshot.scope === 'global') return createOpenClawGlobalSessionAlias(snapshot.defaultId);
  return `agent:${snapshot.defaultId}:${snapshot.mainKey}`;
}

/** 按 OpenClaw 显式智能体路由规则还原该智能体的主会话 key。 */
export function resolveOpenClawExplicitAgentMainSessionKey(
  snapshot: Pick<OpenClawAgentListProjection, 'mainKey' | 'scope' | 'agents'>,
  agentId: string,
): string | null {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId || !snapshot.agents.some((agent) => agent.id === normalizedAgentId)) {
    return null;
  }
  return snapshot.scope === 'global'
    ? createOpenClawGlobalSessionAlias(normalizedAgentId)
    : `agent:${normalizedAgentId}:${snapshot.mainKey}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`sessions.list returned invalid ${field}`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`sessions.list returned invalid ${field}`);
  }
  return value;
}

function optionalTimestamp(value: unknown, field: string): number | undefined {
  const timestamp = optionalNumber(value, field);
  if (timestamp !== undefined && timestamp < 0) {
    throw new Error(`sessions.list returned invalid ${field}`);
  }
  return timestamp;
}

export function projectOpenClawSession(value: unknown): OpenClawSessionProjection {
  if (!record(value)) throw new Error('sessions.list returned a session without key');
  const {
    key: rawKey,
    sessionId: rawSessionId,
    agentId: rawAgentId,
    createdAt: rawCreatedAt,
    label: rawLabel,
    displayName: rawDisplayName,
    derivedTitle: rawDerivedTitle,
    lastMessagePreview: rawLastMessagePreview,
    category: rawCategory,
    model: rawModel,
    running: rawRunning,
    totalTokens: rawTotalTokens,
    contextTokens: rawContextTokens,
    pinned: rawPinned,
    archived: rawArchived,
    unread: rawUnread,
    ...extra
  } = value;
  const key = text(rawKey);
  if (!key) throw new Error('sessions.list returned a session without key');
  const createdAt = optionalTimestamp(rawCreatedAt, 'createdAt');
  const running = optionalBoolean(rawRunning, 'running');
  const totalTokens = optionalNumber(rawTotalTokens, 'totalTokens');
  const contextTokens = optionalNumber(rawContextTokens, 'contextTokens');
  const pinned = optionalBoolean(rawPinned, 'pinned');
  const archived = optionalBoolean(rawArchived, 'archived');
  const unread = optionalBoolean(rawUnread, 'unread');
  return {
    ...extra,
    key,
    ...(text(rawSessionId) ? { sessionId: text(rawSessionId) } : {}),
    ...(text(rawAgentId) ? { agentId: text(rawAgentId) } : {}),
    ...(createdAt !== undefined ? { createdAt } : {}),
    ...(typeof rawLabel === 'string' ? { label: rawLabel.trim() } : {}),
    ...(text(rawDisplayName) ? { displayName: text(rawDisplayName) } : {}),
    ...(text(rawDerivedTitle) ? { derivedTitle: text(rawDerivedTitle) } : {}),
    ...(text(rawLastMessagePreview) ? { lastMessagePreview: text(rawLastMessagePreview) } : {}),
    ...(text(rawCategory) ? { category: text(rawCategory) } : {}),
    ...(text(rawModel) ? { model: text(rawModel) } : {}),
    ...(running !== undefined ? { running } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(unread !== undefined ? { unread } : {}),
  };
}

export function parseOpenClawAgentList(value: unknown): OpenClawAgentListProjection {
  if (!record(value)) {
    throw new Error('agents.list returned an invalid response');
  }
  const defaultId = text(value.defaultId);
  const mainKey = text(value.mainKey);
  const scope = value.scope;
  if (!defaultId || !mainKey || (scope !== 'per-sender' && scope !== 'global') || !Array.isArray(value.agents)) {
    throw new Error('agents.list returned an invalid response');
  }
  const agents = value.agents.map((candidate) => {
    if (!record(candidate)) throw new Error('agents.list returned an agent without id');
    const id = text(candidate.id);
    if (!id) throw new Error('agents.list returned an agent without id');
    return { ...candidate, id };
  });
  if (!agents.some((agent) => agent.id === defaultId)) {
    throw new Error('agents.list defaultId is absent from agents');
  }
  return { defaultId, mainKey, scope, agents };
}

export function parseOpenClawDescribedSession(value: unknown): OpenClawSessionProjection {
  if (!record(value) || value.session === null) throw new Error('sessions.describe did not find the session');
  return projectOpenClawSession(value.session);
}
