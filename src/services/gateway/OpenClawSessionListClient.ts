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
  if (offset !== expectedOffset || !Number.isSafeInteger(totalCount) || Number(totalCount) < 0) {
    throw new Error('sessions.list returned invalid pagination metadata');
  }
  if (response.hasMore === true) {
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

export async function listOpenClawSessionLifecycle(
  request: OpenClawSessionListRequester,
): Promise<OpenClawSessionListResponses> {
  const [active, archived] = await Promise.all([
    listAllOpenClawSessions(request),
    listAllOpenClawSessions(request, { archived: true }),
  ]);
  return { active, archived };
}
