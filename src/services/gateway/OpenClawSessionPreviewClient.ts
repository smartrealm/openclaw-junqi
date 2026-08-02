export const OPENCLAW_SESSIONS_PREVIEW_METHOD = 'sessions.preview' as const;
export const OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS = 64;

export type OpenClawSessionPreviewRole = 'user' | 'assistant' | 'tool' | 'system' | 'other';
export type OpenClawSessionPreviewStatus = 'ok' | 'empty' | 'missing' | 'error';

export interface OpenClawSessionPreviewItem {
  readonly role: OpenClawSessionPreviewRole;
  readonly text: string;
}

export interface OpenClawSessionPreviewEntry {
  readonly key: string;
  readonly status: OpenClawSessionPreviewStatus;
  readonly items: readonly OpenClawSessionPreviewItem[];
}

export interface OpenClawSessionPreviewResult {
  readonly ts: number;
  readonly previews: readonly OpenClawSessionPreviewEntry[];
}

export interface OpenClawSessionPreviewInput {
  readonly keys: readonly string[];
  readonly limit?: number;
  readonly maxChars?: number;
}

export type OpenClawSessionPreviewRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawSessionPreviewResponseError extends Error {
  readonly code = 'OPENCLAW_SESSIONS_PREVIEW_RESPONSE_INVALID';

  constructor() {
    super('The OpenClaw Gateway returned an invalid sessions.preview response');
    this.name = 'OpenClawSessionPreviewResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeKeys(keys: readonly string[]): string[] {
  if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
    throw new Error('Invalid OpenClaw sessions.preview keys');
  }
  const normalized = [...new Set(keys.map((key) => key.trim()))].filter(Boolean);
  if (normalized.length === 0) throw new Error('OpenClaw sessions.preview requires at least one key');
  if (normalized.length > OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS) {
    throw new Error(`OpenClaw sessions.preview accepts at most ${OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS} keys`);
  }
  return normalized;
}

function buildParams(input: OpenClawSessionPreviewInput): Record<string, unknown> {
  const keys = normalizeKeys(input.keys);
  if (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) {
    throw new Error('Invalid OpenClaw sessions.preview limit');
  }
  if (input.maxChars !== undefined && (!Number.isInteger(input.maxChars) || input.maxChars < 20)) {
    throw new Error('Invalid OpenClaw sessions.preview maxChars');
  }
  return {
    keys,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.maxChars !== undefined ? { maxChars: input.maxChars } : {}),
  };
}

const ROLES: readonly OpenClawSessionPreviewRole[] = ['user', 'assistant', 'tool', 'system', 'other'];
const STATUSES: readonly OpenClawSessionPreviewStatus[] = ['ok', 'empty', 'missing', 'error'];

function parseItem(value: unknown): OpenClawSessionPreviewItem {
  const source = record(value);
  if (!source || typeof source.text !== 'string' || !ROLES.includes(source.role as OpenClawSessionPreviewRole)) {
    throw new OpenClawSessionPreviewResponseError();
  }
  return {
    role: source.role as OpenClawSessionPreviewRole,
    text: source.text,
  };
}

function parseEntry(value: unknown): OpenClawSessionPreviewEntry {
  const source = record(value);
  if (
    !source
    || typeof source.key !== 'string'
    || !source.key.trim()
    || !STATUSES.includes(source.status as OpenClawSessionPreviewStatus)
    || !Array.isArray(source.items)
  ) {
    throw new OpenClawSessionPreviewResponseError();
  }
  const status = source.status as OpenClawSessionPreviewStatus;
  const items = source.items.map(parseItem);
  if (status !== 'ok' && items.length > 0) {
    throw new OpenClawSessionPreviewResponseError();
  }
  return {
    key: source.key.trim(),
    status,
    items,
  };
}

/** Decode the bounded result emitted by OpenClaw's read-scoped preview handler. */
export function parseOpenClawSessionPreviewResult(value: unknown): OpenClawSessionPreviewResult {
  const source = record(value);
  if (
    !source
    || typeof source.ts !== 'number'
    || !Number.isFinite(source.ts)
    || source.ts < 0
    || !Array.isArray(source.previews)
  ) {
    throw new OpenClawSessionPreviewResponseError();
  }
  const previews = source.previews.map(parseEntry);
  const keys = new Set<string>();
  for (const preview of previews) {
    if (keys.has(preview.key)) throw new OpenClawSessionPreviewResponseError();
    keys.add(preview.key);
  }
  return { ts: source.ts, previews };
}

/**
 * Narrow client for OpenClaw's operator.read sessions.preview RPC. It does not
 * synthesize transcript content and requires the Gateway to return one result
 * for every requested key.
 */
export class OpenClawSessionPreviewClient {
  constructor(private readonly request: OpenClawSessionPreviewRequester) {}

  async preview(input: OpenClawSessionPreviewInput): Promise<OpenClawSessionPreviewResult> {
    const params = buildParams(input);
    const requestedKeys = params.keys as string[];
    const result = parseOpenClawSessionPreviewResult(
      await this.request<unknown>(OPENCLAW_SESSIONS_PREVIEW_METHOD, params),
    );
    const returnedKeys = new Set(result.previews.map((preview) => preview.key));
    if (
      returnedKeys.size !== requestedKeys.length
      || requestedKeys.some((key) => !returnedKeys.has(key))
    ) {
      throw new OpenClawSessionPreviewResponseError();
    }
    return result;
  }
}
