type SessionKeyLike = { key?: string };

const deletedSessionKeys = new Set<string>();
let fallbackKeySequence = 0;

export function normalizeSessionKey(value: string): string {
  return String(value ?? '').trim();
}

export function isAgentMainSession(sessionKey: string): boolean {
  return /^agent:[^:]+:main$/.test(normalizeSessionKey(sessionKey));
}

export function markSessionDeleted(sessionKey: string): void {
  const key = normalizeSessionKey(sessionKey);
  if (key && !isAgentMainSession(key)) deletedSessionKeys.add(key);
}

export function restoreSessionKey(sessionKey: string): void {
  const key = normalizeSessionKey(sessionKey);
  if (key) deletedSessionKeys.delete(key);
}

export function isSessionDeleted(sessionKey: string): boolean {
  const key = normalizeSessionKey(sessionKey);
  return Boolean(key) && deletedSessionKeys.has(key);
}

export function withoutDeletedSessions<T extends SessionKeyLike>(sessions: T[]): T[] {
  return sessions.filter((session) => !isSessionDeleted(session.key ?? ''));
}

function failureDetail(value: unknown, seen: Set<object> = new Set()): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  return failureDetail(record.message, seen)
    || failureDetail(record.error, seen)
    || failureDetail(record.detail, seen);
}

export function gatewayMutationFailure(response: unknown, fallback: string): string | null {
  if (!response || typeof response !== 'object') return null;
  const result = response as Record<string, unknown>;
  if (result.success !== false && result.ok !== false) return null;
  return failureDetail(result.error) || failureDetail(result.message) || fallback;
}

export interface LatestRequestGate {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (requestId: number) => boolean;
}

export function createLatestRequestGate(): LatestRequestGate {
  let current = 0;
  return {
    begin: () => ++current,
    invalidate: () => { current += 1; },
    isCurrent: (requestId) => requestId === current,
  };
}

function randomKeySuffix(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.replace(/-/g, '').slice(0, 12);
  fallbackKeySequence += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `${fallbackKeySequence.toString(36)}${random}`;
}

export function createAgentSessionKey(agentId: string): string {
  const normalizedAgentId = String(agentId ?? '').trim();
  if (!normalizedAgentId || normalizedAgentId.includes(':')) {
    throw new Error('Invalid agent id for session key');
  }
  return `agent:${normalizedAgentId}:desktop-${Date.now().toString(36)}-${randomKeySuffix()}`;
}

export function __resetSessionLifecycleForTest(): void {
  deletedSessionKeys.clear();
  fallbackKeySequence = 0;
}
