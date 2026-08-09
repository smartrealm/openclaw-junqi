export interface OpenClawSessionProjection extends Record<string, unknown> {
  readonly key: string;
  readonly sessionId?: string;
  readonly agentId?: string;
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
  if (snapshot.scope === 'global') return 'global';
  return `agent:${snapshot.defaultId}:${snapshot.mainKey}`;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
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

export function projectOpenClawSession(value: unknown): OpenClawSessionProjection {
  const source = record(value);
  const key = text(source?.key);
  if (!source || !key) throw new Error('sessions.list returned a session without key');
  return {
    ...source,
    key,
    ...(text(source.sessionId) ? { sessionId: text(source.sessionId) } : {}),
    ...(text(source.agentId) ? { agentId: text(source.agentId) } : {}),
    ...(typeof source.label === 'string' ? { label: source.label.trim() } : {}),
    ...(text(source.displayName) ? { displayName: text(source.displayName) } : {}),
    ...(text(source.derivedTitle) ? { derivedTitle: text(source.derivedTitle) } : {}),
    ...(text(source.lastMessagePreview) ? { lastMessagePreview: text(source.lastMessagePreview) } : {}),
    ...(text(source.category) ? { category: text(source.category) } : {}),
    ...(text(source.model) ? { model: text(source.model) } : {}),
    ...(optionalBoolean(source.running, 'running') !== undefined ? { running: source.running as boolean } : {}),
    ...(optionalNumber(source.totalTokens, 'totalTokens') !== undefined ? { totalTokens: source.totalTokens as number } : {}),
    ...(optionalNumber(source.contextTokens, 'contextTokens') !== undefined ? { contextTokens: source.contextTokens as number } : {}),
    ...(optionalBoolean(source.pinned, 'pinned') !== undefined ? { pinned: source.pinned as boolean } : {}),
    ...(optionalBoolean(source.archived, 'archived') !== undefined ? { archived: source.archived as boolean } : {}),
    ...(optionalBoolean(source.unread, 'unread') !== undefined ? { unread: source.unread as boolean } : {}),
  };
}

export function parseOpenClawAgentList(value: unknown): OpenClawAgentListProjection {
  const source = record(value);
  const defaultId = text(source?.defaultId);
  const mainKey = text(source?.mainKey);
  const scope = source?.scope;
  if (!source || !defaultId || !mainKey || (scope !== 'per-sender' && scope !== 'global') || !Array.isArray(source.agents)) {
    throw new Error('agents.list returned an invalid response');
  }
  const agents = source.agents.map((candidate) => {
    const agent = record(candidate);
    const id = text(agent?.id);
    if (!agent || !id) throw new Error('agents.list returned an agent without id');
    return { ...agent, id };
  });
  if (!agents.some((agent) => agent.id === defaultId)) {
    throw new Error('agents.list defaultId is absent from agents');
  }
  return { defaultId, mainKey, scope, agents };
}

export function parseOpenClawDescribedSession(value: unknown): OpenClawSessionProjection {
  const source = record(value);
  if (!source || source.session === null) throw new Error('sessions.describe did not find the session');
  return projectOpenClawSession(source.session);
}
