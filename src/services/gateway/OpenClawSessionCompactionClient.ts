export interface OpenClawSessionCompactionInput {
  readonly key: string;
  readonly agentId?: string;
  readonly maxLines?: number;
}

export interface OpenClawSessionCompactionResult {
  readonly ok: boolean;
  readonly key: string;
  readonly compacted: boolean;
  readonly reason?: string;
}

export type OpenClawSessionCompactionRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawSessionCompactionResponseError extends Error {
  constructor() {
    super('OPENCLAW_SESSION_COMPACTION_RESPONSE_INVALID');
    this.name = 'OpenClawSessionCompactionResponseError';
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

function buildParams(input: OpenClawSessionCompactionInput): Record<string, unknown> {
  const key = nonEmptyString(input.key);
  if (!key) throw new Error('Invalid OpenClaw sessions.compact key');
  const agentId = input.agentId === undefined ? undefined : nonEmptyString(input.agentId);
  if (input.agentId !== undefined && !agentId) {
    throw new Error('Invalid OpenClaw sessions.compact agentId');
  }
  if (input.maxLines !== undefined && (!Number.isInteger(input.maxLines) || input.maxLines < 1)) {
    throw new Error('Invalid OpenClaw sessions.compact maxLines');
  }
  return {
    key,
    ...(agentId ? { agentId } : {}),
    ...(input.maxLines !== undefined ? { maxLines: input.maxLines } : {}),
  };
}

/** Decode the stable result fields emitted by OpenClaw's sessions.compact handler. */
export function parseOpenClawSessionCompactionResult(value: unknown): OpenClawSessionCompactionResult {
  const source = record(value);
  const key = source ? nonEmptyString(source.key) : null;
  if (
    !source
    || typeof source.ok !== 'boolean'
    || !key
    || typeof source.compacted !== 'boolean'
    || (source.reason !== undefined && typeof source.reason !== 'string')
  ) {
    throw new OpenClawSessionCompactionResponseError();
  }
  return {
    ok: source.ok,
    key,
    compacted: source.compacted,
    ...(source.reason !== undefined ? { reason: source.reason } : {}),
  };
}

/**
 * Narrow client for the admin-scoped native compaction RPC. The caller owns
 * authorization and transport selection; this class only validates the
 * OpenClaw request and response contract.
 */
export class OpenClawSessionCompactionClient {
  constructor(private readonly request: OpenClawSessionCompactionRequester) {}

  async compact(input: OpenClawSessionCompactionInput): Promise<OpenClawSessionCompactionResult> {
    const params = buildParams(input);
    return parseOpenClawSessionCompactionResult(
      await this.request<unknown>('sessions.compact', params),
    );
  }
}
