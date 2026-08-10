import { scopeOpenClawGlobalSessionRow } from './OpenClawSessionTarget';

export type OpenClawSessionListRequester = (
  method: 'sessions.list',
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface OpenClawSessionListResponse extends Record<string, unknown> {
  readonly sessions: unknown[];
  readonly totalCount: number;
  readonly offset: number;
  readonly nextOffset: null;
  readonly hasMore: false;
}

export interface OpenClawSessionListResponses {
  readonly active: OpenClawSessionListResponse;
  readonly archived: OpenClawSessionListResponse;
}

const PAGE_LIMIT = 100;
const PRESENTATION_PARAMS = {
  includeGlobal: true,
  includeUnknown: true,
  configuredAgentsOnly: true,
  includeDerivedTitles: true,
  includeLastMessage: true,
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parsePage(value: unknown, expectedOffset: number): {
  response: Record<string, unknown>;
  sessions: unknown[];
  hasMore: boolean;
  nextOffset: number | null;
  totalCount: number;
} {
  const response = record(value);
  if (!response || !Array.isArray(response.sessions)) {
    throw new Error('sessions.list returned an invalid response');
  }
  if (response.hasMore !== true && response.hasMore !== false) {
    throw new Error('sessions.list returned no pagination state');
  }
  const offset = response.offset;
  const totalCount = response.totalCount;
  const nextOffset = response.nextOffset;
  if (!Number.isSafeInteger(totalCount) || Number(totalCount) < 0) {
    throw new Error('sessions.list returned invalid pagination metadata');
  }
  if (response.hasMore === true) {
    if (offset !== expectedOffset) {
      throw new Error('sessions.list returned invalid pagination metadata');
    }
    if (!Number.isSafeInteger(nextOffset) || Number(nextOffset) <= expectedOffset) {
      throw new Error('sessions.list returned an invalid next offset');
    }
    return {
      response,
      sessions: response.sessions,
      hasMore: true,
      nextOffset: Number(nextOffset),
      totalCount: Number(totalCount),
    };
  }
  // OpenClaw 的首个终止页可以省略 offset；后续页必须保留位置证明。
  if ((offset === undefined && expectedOffset !== 0) || (offset !== undefined && offset !== expectedOffset)) {
    throw new Error('sessions.list returned invalid pagination metadata');
  }
  if (nextOffset !== null) throw new Error('sessions.list returned an invalid terminal offset');
  return {
    response,
    sessions: response.sessions,
    hasMore: false,
    nextOffset: null,
    totalCount: Number(totalCount),
  };
}

export async function listAllOpenClawSessions(
  request: OpenClawSessionListRequester,
  filters: Readonly<Record<string, unknown>> = {},
): Promise<OpenClawSessionListResponse> {
  const sessions: unknown[] = [];
  let offset = 0;
  let totalCount = 0;
  let firstResponse: Record<string, unknown> = {};
  while (true) {
    const page = parsePage(await request('sessions.list', {
      ...filters,
      ...PRESENTATION_PARAMS,
      limit: PAGE_LIMIT,
      offset,
    }), offset);
    if (offset === 0) firstResponse = page.response;
    sessions.push(...page.sessions);
    totalCount = page.totalCount;
    if (!page.hasMore) break;
    offset = page.nextOffset!;
  }
  if (sessions.length !== totalCount) {
    throw new Error('sessions.list pagination did not return the declared session count');
  }
  return {
    ...firstResponse,
    sessions,
    totalCount,
    offset: 0,
    nextOffset: null,
    hasMore: false,
  };
}

function uniqueAgentIds(agentIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of agentIds) {
    const agentId = typeof candidate === 'string' ? candidate.trim() : '';
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    normalized.push(agentId);
  }
  if (normalized.length === 0) {
    throw new Error('sessions.list requires at least one Gateway-confirmed agent');
  }
  return normalized;
}

/**
 * 按 OpenClaw 官方智能体作用域读取完整会话集合。
 *
 * 单个裸 `global` key 无法唯一标识多智能体会话，因此每个范围独立分页后
 * 立即投影为 Control UI 使用的作用域别名，禁止在本地以裸 key 合并。
 */
export async function listAllOpenClawSessionsForAgents(
  request: OpenClawSessionListRequester,
  agentIds: readonly string[],
  filters: Readonly<Record<string, unknown>> = {},
): Promise<OpenClawSessionListResponse> {
  const scopedAgentIds = uniqueAgentIds(agentIds);
  const responses = await Promise.all(scopedAgentIds.map(async (agentId) => {
    const response = await listAllOpenClawSessions(request, { ...filters, agentId });
    return {
      response,
      sessions: response.sessions.map((session) => scopeOpenClawGlobalSessionRow(session, agentId)),
    };
  }));
  const firstResponse = responses[0]?.response;
  if (!firstResponse) throw new Error('sessions.list did not return a Gateway response');
  const sessions = responses.flatMap((response) => response.sessions);
  return {
    ...firstResponse,
    sessions,
    totalCount: sessions.length,
    offset: 0,
    nextOffset: null,
    hasMore: false,
  };
}

export async function listOpenClawSessionLifecycle(
  request: OpenClawSessionListRequester,
  agentIds: readonly string[],
): Promise<OpenClawSessionListResponses> {
  const [active, archived] = await Promise.all([
    listAllOpenClawSessionsForAgents(request, agentIds),
    listAllOpenClawSessionsForAgents(request, agentIds, { archived: true }),
  ]);
  return { active, archived };
}
