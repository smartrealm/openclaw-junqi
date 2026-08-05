export type SessionOperationPhase = 'start' | 'end';

/** The current OpenClaw gateway-protocol SessionOperationEvent contract. */
export interface OpenClawSessionOperationEvent {
  operationId: string;
  operation: 'compact';
  phase: SessionOperationPhase;
  sessionKey: string;
  agentId?: string;
  ts: number;
  completed?: boolean;
  reason?: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

const SESSION_OPERATION_FIELDS = new Set([
  'operationId',
  'operation',
  'phase',
  'sessionKey',
  'agentId',
  'ts',
  'completed',
  'reason',
]);

/** Decode only fields present in OpenClaw's official session.operation schema. */
export function parseOpenClawSessionOperationEvent(value: unknown): OpenClawSessionOperationEvent | null {
  const source = record(value);
  if (!source) return null;
  if (Object.keys(source).some((key) => !SESSION_OPERATION_FIELDS.has(key))) return null;

  const operationId = nonEmptyString(source.operationId);
  const sessionKey = nonEmptyString(source.sessionKey);
  const agentId = source.agentId === undefined ? undefined : nonEmptyString(source.agentId);
  const reason = source.reason === undefined
    ? undefined
    : typeof source.reason === 'string'
      ? source.reason
      : null;
  if (
    !operationId
    || source.operation !== 'compact'
    || (source.phase !== 'start' && source.phase !== 'end')
    || !sessionKey
    || (source.agentId !== undefined && !agentId)
    || typeof source.ts !== 'number'
    || !Number.isSafeInteger(source.ts)
    || source.ts < 0
    || reason === null
    || (source.completed !== undefined && typeof source.completed !== 'boolean')
  ) {
    return null;
  }

  return {
    operationId,
    operation: 'compact',
    phase: source.phase,
    sessionKey,
    ...(agentId ? { agentId } : {}),
    ts: source.ts,
    ...(source.completed !== undefined ? { completed: source.completed } : {}),
    ...(reason !== undefined ? { reason } : {}),
  };
}
