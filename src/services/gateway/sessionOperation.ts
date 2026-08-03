export type SessionOperationPhase = 'start' | 'end';

export interface SessionOperationEvent {
  operationId: string;
  operation: 'compact';
  phase: SessionOperationPhase;
  sessionKey: string;
  agentId?: string;
  ts: number;
  completed?: boolean;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value) ?? undefined;
}

export function parseSessionOperationEvent(value: unknown): SessionOperationEvent | null {
  if (!isRecord(value)) return null;
  const operationId = requiredString(value.operationId);
  const sessionKey = requiredString(value.sessionKey);
  const agentId = optionalString(value.agentId);
  const reason = optionalString(value.reason);
  const ts = value.ts;
  if (!operationId || value.operation !== 'compact' || !sessionKey
    || (value.agentId !== undefined && !agentId)
    || (value.reason !== undefined && !reason)
    || typeof ts !== 'number' || !Number.isSafeInteger(ts) || ts < 0
    || (value.phase !== 'start' && value.phase !== 'end')) {
    return null;
  }
  if (value.phase === 'start') {
    if (value.completed !== undefined || value.reason !== undefined) return null;
  } else if (typeof value.completed !== 'boolean') {
    return null;
  }
  return {
    operationId,
    operation: 'compact',
    phase: value.phase,
    sessionKey,
    ...(agentId ? { agentId } : {}),
    ts,
    ...(value.completed !== undefined ? { completed: value.completed } : {}),
    ...(reason ? { reason } : {}),
  };
}
