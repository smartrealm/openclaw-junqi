export interface OpenClawSessionEntry {
  readonly sessionId: string;
  readonly label?: string;
  readonly model?: string;
  readonly parentSessionKey?: string;
  readonly updatedAt?: number;
  readonly createdAt?: number;
  readonly [key: string]: unknown;
}

export interface OpenClawCreatedSession {
  readonly key: string;
  readonly sessionId: string;
  readonly entry: OpenClawSessionEntry;
}

export interface OpenClawSessionCreateInput {
  readonly agentId: string;
  readonly label?: string;
  readonly parentSessionKey?: string;
  readonly fork?: boolean;
}

export type OpenClawSessionRequester = <T>(
  method: string,
  params: Record<string, unknown>,
) => Promise<T>;

export class OpenClawSessionLifecycleResponseError extends Error {
  constructor(readonly reason: 'invalid-payload' | 'not-confirmed' | 'missing-identity') {
    super(`OPENCLAW_SESSION_LIFECYCLE_${reason.toUpperCase()}`);
    this.name = 'OpenClawSessionLifecycleResponseError';
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

export function parseOpenClawCreatedSession(value: unknown): OpenClawCreatedSession {
  const response = record(value);
  if (!response) throw new OpenClawSessionLifecycleResponseError('invalid-payload');
  if (response.ok !== true) throw new OpenClawSessionLifecycleResponseError('not-confirmed');

  const key = nonEmptyString(response.key);
  const sessionId = nonEmptyString(response.sessionId);
  const entry = record(response.entry);
  const entrySessionId = entry ? nonEmptyString(entry.sessionId) : null;
  if (!key || !sessionId || !entry || !entrySessionId || entrySessionId !== sessionId) {
    throw new OpenClawSessionLifecycleResponseError('missing-identity');
  }

  return {
    key,
    sessionId,
    entry: {
      ...entry,
      sessionId,
      ...(nonEmptyString(entry.label) ? { label: nonEmptyString(entry.label)! } : {}),
      ...(nonEmptyString(entry.model) ? { model: nonEmptyString(entry.model)! } : {}),
      ...(nonEmptyString(entry.parentSessionKey)
        ? { parentSessionKey: nonEmptyString(entry.parentSessionKey)! }
        : {}),
      ...(typeof entry.updatedAt === 'number' ? { updatedAt: entry.updatedAt } : {}),
      ...(typeof entry.createdAt === 'number' ? { createdAt: entry.createdAt } : {}),
    },
  };
}

/**
 * Narrow client for the protocol-owned session creation contract. It keeps
 * response validation away from React surfaces and prevents optimistic local
 * sessions that do not have a Gateway transcript identity.
 */
export class OpenClawSessionLifecycleClient {
  constructor(private readonly request: OpenClawSessionRequester) {}

  async create(input: OpenClawSessionCreateInput): Promise<OpenClawCreatedSession> {
    const agentId = input.agentId.trim();
    if (!agentId) throw new Error('agentId is required');

    const label = input.label?.trim();
    const parentSessionKey = input.parentSessionKey?.trim();
    if (input.fork === true && !parentSessionKey) {
      throw new Error('parentSessionKey is required when fork is true');
    }
    const result = await this.request<unknown>('sessions.create', {
      agentId,
      ...(label ? { label } : {}),
      ...(parentSessionKey ? { parentSessionKey } : {}),
      ...(input.fork === true ? { fork: true } : {}),
    });
    return parseOpenClawCreatedSession(result);
  }
}
