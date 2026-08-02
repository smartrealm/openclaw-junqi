export const OPENCLAW_MEMORY_SEARCH_METHOD = 'memory.search' as const;

export type OpenClawMemorySource = 'memory' | 'sessions';
export type OpenClawMemorySearchMode = 'hybrid' | 'fts-only';

export interface OpenClawMemorySearchInput {
  readonly query: string;
  readonly maxResults?: number;
  readonly minScore?: number;
  readonly agentId?: string;
}

export interface OpenClawMemorySearchResult {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly vectorScore?: number;
  readonly textScore?: number;
  readonly snippet: string;
  readonly source: OpenClawMemorySource;
  readonly citation?: string;
}

export interface OpenClawMemorySearchResponse {
  readonly agentId: string;
  readonly provider: string;
  readonly searchMode: OpenClawMemorySearchMode;
  readonly results: readonly OpenClawMemorySearchResult[];
  readonly stale?: true;
  readonly warning?: string;
  readonly action?: string;
}

export type OpenClawMemorySearchRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawMemorySearchResponseError extends Error {
  readonly code = 'OPENCLAW_MEMORY_SEARCH_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid memory.search response');
    this.name = 'OpenClawMemorySearchResponseError';
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

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const normalized = nonEmptyString(value);
  if (!normalized) throw new OpenClawMemorySearchResponseError();
  return normalized;
}

function finiteNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OpenClawMemorySearchResponseError();
  }
  return value;
}

const SOURCES: readonly OpenClawMemorySource[] = ['memory', 'sessions'];
const SEARCH_MODES: readonly OpenClawMemorySearchMode[] = ['hybrid', 'fts-only'];

function parseResult(value: unknown): OpenClawMemorySearchResult {
  const source = record(value);
  const path = source ? nonEmptyString(source.path) : null;
  if (
    !source
    || !path
    || typeof source.snippet !== 'string'
    || !SOURCES.includes(source.source as OpenClawMemorySource)
  ) {
    throw new OpenClawMemorySearchResponseError();
  }
  const vectorScore = source.vectorScore === undefined ? undefined : finiteNumber(source.vectorScore);
  const textScore = source.textScore === undefined ? undefined : finiteNumber(source.textScore);
  const citation = optionalString(source.citation);
  return {
    path,
    startLine: finiteNumber(source.startLine),
    endLine: finiteNumber(source.endLine),
    score: finiteNumber(source.score),
    ...(vectorScore !== undefined ? { vectorScore } : {}),
    ...(textScore !== undefined ? { textScore } : {}),
    snippet: source.snippet,
    source: source.source as OpenClawMemorySource,
    ...(citation ? { citation } : {}),
  };
}

/** Decode the official read-only memory.search response without synthesizing results. */
export function parseOpenClawMemorySearchResponse(value: unknown): OpenClawMemorySearchResponse {
  const source = record(value);
  const agentId = source ? nonEmptyString(source.agentId) : null;
  const provider = source ? nonEmptyString(source.provider) : null;
  if (
    !source
    || !agentId
    || !provider
    || !SEARCH_MODES.includes(source.searchMode as OpenClawMemorySearchMode)
    || !Array.isArray(source.results)
  ) {
    throw new OpenClawMemorySearchResponseError();
  }
  if (source.stale !== undefined && source.stale !== true) {
    throw new OpenClawMemorySearchResponseError();
  }
  const warning = optionalString(source.warning);
  const action = optionalString(source.action);
  return {
    agentId,
    provider,
    searchMode: source.searchMode as OpenClawMemorySearchMode,
    results: source.results.map(parseResult),
    ...(source.stale === true ? { stale: true as const } : {}),
    ...(warning ? { warning } : {}),
    ...(action ? { action } : {}),
  };
}

function buildParams(input: OpenClawMemorySearchInput): Record<string, unknown> {
  const query = nonEmptyString(input.query);
  if (!query) throw new Error('OpenClaw memory.search requires a non-empty query');

  let maxResults: number | undefined;
  if (input.maxResults !== undefined) {
    if (typeof input.maxResults !== 'number' || !Number.isFinite(input.maxResults)) {
      throw new Error('Invalid OpenClaw memory.search maxResults');
    }
    maxResults = Math.min(50, Math.max(1, Math.floor(input.maxResults)));
  }

  if (input.minScore !== undefined && (typeof input.minScore !== 'number' || !Number.isFinite(input.minScore))) {
    throw new Error('Invalid OpenClaw memory.search minScore');
  }

  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw memory.search agentId');
  }

  return {
    query,
    ...(maxResults !== undefined ? { maxResults } : {}),
    ...(input.minScore !== undefined ? { minScore: input.minScore } : {}),
    ...(agentId ? { agentId } : {}),
  };
}

/** Narrow client for OpenClaw's operator.read memory.search RPC. */
export class OpenClawMemorySearchClient {
  constructor(private readonly request: OpenClawMemorySearchRequester) {}

  async search(input: OpenClawMemorySearchInput): Promise<OpenClawMemorySearchResponse> {
    return parseOpenClawMemorySearchResponse(
      await this.request<unknown>(OPENCLAW_MEMORY_SEARCH_METHOD, buildParams(input)),
    );
  }
}
