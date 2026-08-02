export const OPENCLAW_SESSIONS_SEARCH_METHOD = 'sessions.search' as const;
export const OPENCLAW_SESSIONS_SEARCH_MAX_SESSION_KEYS = 200;
export const OPENCLAW_SESSIONS_SEARCH_MAX_QUERY_LENGTH = 4096;
export const OPENCLAW_SESSIONS_SEARCH_MAX_LIMIT = 25;

export type OpenClawSessionSearchRole = 'user' | 'assistant';

export interface OpenClawSessionSearchHit {
  readonly sessionKey: string;
  readonly sessionId: string;
  readonly messageId: string;
  readonly role: OpenClawSessionSearchRole;
  readonly timestamp: number;
  readonly snippet: string;
  readonly score: number;
}

export interface OpenClawSessionSearchResult {
  readonly results: readonly OpenClawSessionSearchHit[];
  readonly indexing?: boolean;
  readonly truncated?: boolean;
}

export interface OpenClawSessionSearchInput {
  readonly query: string;
  readonly agentId?: string;
  readonly sessionKeys?: readonly string[];
  readonly limit?: number;
}

export type OpenClawSessionSearchRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawSessionSearchResponseError extends Error {
  readonly code = 'OPENCLAW_SESSIONS_SEARCH_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid sessions.search response');
    this.name = 'OpenClawSessionSearchResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new OpenClawSessionSearchResponseError();
  return value;
}

function finiteInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || !Number.isFinite(value) || value < 0) {
    throw new OpenClawSessionSearchResponseError();
  }
  return value;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OpenClawSessionSearchResponseError();
  }
  return value;
}

const ROLES: readonly OpenClawSessionSearchRole[] = ['user', 'assistant'];

function parseHit(value: unknown): OpenClawSessionSearchHit {
  const source = record(value);
  const sessionKey = source ? nonEmptyString(source.sessionKey) : null;
  const sessionId = source ? nonEmptyString(source.sessionId) : null;
  const messageId = source ? nonEmptyString(source.messageId) : null;
  if (
    !source
    || !sessionKey
    || !sessionId
    || !messageId
    || !ROLES.includes(source.role as OpenClawSessionSearchRole)
    || typeof source.snippet !== 'string'
  ) {
    throw new OpenClawSessionSearchResponseError();
  }
  return {
    sessionKey,
    sessionId,
    messageId,
    role: source.role as OpenClawSessionSearchRole,
    timestamp: finiteInteger(source.timestamp),
    snippet: source.snippet,
    score: finiteNumber(source.score),
  };
}

export function parseOpenClawSessionSearchResult(value: unknown): OpenClawSessionSearchResult {
  const source = record(value);
  if (!source || !Array.isArray(source.results)) {
    throw new OpenClawSessionSearchResponseError();
  }
  const indexing = optionalBoolean(source.indexing);
  const truncated = optionalBoolean(source.truncated);
  return {
    results: source.results.map(parseHit),
    ...(indexing !== undefined ? { indexing } : {}),
    ...(truncated !== undefined ? { truncated } : {}),
  };
}

function buildParams(input: OpenClawSessionSearchInput): Record<string, unknown> {
  const query = nonEmptyString(input.query);
  if (!query || query.length > OPENCLAW_SESSIONS_SEARCH_MAX_QUERY_LENGTH) {
    throw new Error('OpenClaw sessions.search requires a query within the official length limit');
  }

  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw sessions.search agentId');
  }

  let sessionKeys: string[] | undefined;
  if (input.sessionKeys !== undefined) {
    if (!Array.isArray(input.sessionKeys)) throw new Error('Invalid OpenClaw sessions.search sessionKeys');
    sessionKeys = [...new Set(input.sessionKeys.map((key) => {
      if (typeof key !== 'string' || !key.trim()) {
        throw new Error('Invalid OpenClaw sessions.search session key');
      }
      return key.trim();
    }))];
    if (sessionKeys.length === 0 || sessionKeys.length > OPENCLAW_SESSIONS_SEARCH_MAX_SESSION_KEYS) {
      throw new Error('OpenClaw sessions.search sessionKeys exceed the official bounds');
    }
  }

  if (input.limit !== undefined && (
    !Number.isInteger(input.limit)
    || input.limit < 1
    || input.limit > OPENCLAW_SESSIONS_SEARCH_MAX_LIMIT
  )) {
    throw new Error('Invalid OpenClaw sessions.search limit');
  }

  return {
    query,
    ...(agentId ? { agentId } : {}),
    ...(sessionKeys ? { sessionKeys } : {}),
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  };
}

/** Narrow client for OpenClaw's read-only sessions.search RPC. */
export class OpenClawSessionSearchClient {
  constructor(private readonly request: OpenClawSessionSearchRequester) {}

  async search(input: OpenClawSessionSearchInput): Promise<OpenClawSessionSearchResult> {
    return parseOpenClawSessionSearchResult(
      await this.request<unknown>(OPENCLAW_SESSIONS_SEARCH_METHOD, buildParams(input)),
    );
  }
}
