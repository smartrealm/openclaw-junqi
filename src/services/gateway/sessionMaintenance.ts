export interface SessionsCompactParams {
  key: string;
  agentId?: string;
  maxLines?: number;
}

export interface SessionsCompactResult {
  ok: boolean;
  key: string;
  compacted: boolean;
  reason?: string;
  kept?: number;
  archived?: boolean;
  result?: unknown;
}

function requiredKey(value: string): string {
  const key = value.trim();
  if (!key) throw new Error('sessions.compact requires a session key');
  return key;
}

export function buildSessionsCompactParams(
  key: string,
  options: Pick<SessionsCompactParams, 'agentId' | 'maxLines'> = {},
): SessionsCompactParams {
  const normalizedKey = requiredKey(key);
  const agentId = options.agentId?.trim();
  const maxLines = options.maxLines === undefined ? undefined : Math.floor(options.maxLines);
  if (maxLines !== undefined && (!Number.isSafeInteger(maxLines) || maxLines < 1)) {
    throw new Error('sessions.compact maxLines must be a positive integer');
  }
  return {
    key: normalizedKey,
    ...(agentId ? { agentId } : {}),
    ...(maxLines !== undefined ? { maxLines } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`sessions.compact returned an invalid ${field}`);
  return value;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`sessions.compact returned an invalid ${field}`);
  }
  return value as number;
}

export function parseSessionsCompactResult(value: unknown, expectedKey?: string): SessionsCompactResult {
  if (!isRecord(value)
    || typeof value.ok !== 'boolean'
    || typeof value.key !== 'string'
    || value.key.trim().length === 0
    || typeof value.compacted !== 'boolean') {
    throw new Error('sessions.compact returned an invalid result');
  }
  const key = value.key.trim();
  if (expectedKey !== undefined && key !== requiredKey(expectedKey)) {
    throw new Error('sessions.compact returned a different session key');
  }
  return {
    ok: value.ok,
    key,
    compacted: value.compacted,
    ...(value.reason !== undefined ? { reason: optionalString(value.reason, 'reason') } : {}),
    ...(value.kept !== undefined ? { kept: optionalNonNegativeInteger(value.kept, 'kept') } : {}),
    ...(value.archived !== undefined
      ? typeof value.archived === 'boolean'
        ? { archived: value.archived }
        : (() => { throw new Error('sessions.compact returned an invalid archived'); })()
      : {}),
    ...(value.result !== undefined ? { result: value.result } : {}),
  };
}
