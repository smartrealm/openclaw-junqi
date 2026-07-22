type SessionKeyLike = {
  key?: string;
  sessionId?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  lastActive?: string | number;
  lastTimestamp?: string | number;
};

type LocalSessionLike = SessionKeyLike & {
  localOnly?: boolean;
};

/**
 * A deleted OpenClaw transcript is identified by both its stable routing key
 * and its ephemeral session id.  Keeping the id prevents a confirmed delete
 * from hiding a later transcript that legitimately reuses the same key.
 * `null` is retained only when the Gateway could not provide an identity; in
 * that fail-closed case an explicit local restore is required.
 */
const deletedSessionIdentities = new Map<string, string | null>();
let fallbackKeySequence = 0;

export function normalizeSessionKey(value: string): string {
  return String(value ?? '').trim();
}

export function isAgentMainSession(sessionKey: string): boolean {
  return /^agent:[^:]+:main$/.test(normalizeSessionKey(sessionKey));
}

function normalizeSessionId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function markSessionDeleted(sessionKey: string, sessionId?: string | null): void {
  const key = normalizeSessionKey(sessionKey);
  if (key && !isAgentMainSession(key)) {
    deletedSessionIdentities.set(key, normalizeSessionId(sessionId));
  }
}

export function restoreSessionKey(sessionKey: string): void {
  const key = normalizeSessionKey(sessionKey);
  if (key) deletedSessionIdentities.delete(key);
}

export function isSessionDeleted(sessionKey: string, sessionId?: string | null): boolean {
  const key = normalizeSessionKey(sessionKey);
  if (!key || !deletedSessionIdentities.has(key)) return false;
  const deletedSessionId = deletedSessionIdentities.get(key) ?? null;
  const candidateSessionId = normalizeSessionId(sessionId);
  return !deletedSessionId || !candidateSessionId || deletedSessionId === candidateSessionId;
}

export function withoutDeletedSessions<T extends SessionKeyLike>(sessions: T[]): T[] {
  return sessions.filter((session) => {
    const key = normalizeSessionKey(session.key ?? '');
    if (!key || !deletedSessionIdentities.has(key)) return true;
    const deletedSessionId = deletedSessionIdentities.get(key) ?? null;
    const incomingSessionId = normalizeSessionId(session.sessionId);
    if (deletedSessionId && incomingSessionId && deletedSessionId !== incomingSessionId) {
      deletedSessionIdentities.delete(key);
      return true;
    }
    return false;
  });
}

export function hasSessionIdentityChanged(
  previousSessionId: string | null | undefined,
  nextSessionId: string | null | undefined,
): boolean {
  const previous = normalizeSessionId(previousSessionId);
  const next = normalizeSessionId(nextSessionId);
  return Boolean(previous && next && previous !== next);
}

/** A renderer placeholder has no corresponding OpenClaw transcript yet. */
export function isUnmaterializedLocalSession(
  session: LocalSessionLike | undefined,
  messages: readonly unknown[] | undefined,
): boolean {
  return Boolean(
    session
    && session.localOnly === true
    && !normalizeSessionId(session.sessionId)
    && (!messages || messages.length === 0),
  );
}

function sessionRevision(session: SessionKeyLike): number {
  const candidates = [
    session.updatedAt,
    session.lastActive,
    session.lastTimestamp,
    session.createdAt,
  ];
  let latest = 0;
  for (const candidate of candidates) {
    const value = typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string' && candidate.trim()
        ? Date.parse(candidate)
        : Number.NaN;
    if (Number.isFinite(value)) latest = Math.max(latest, value);
  }
  return latest;
}

/**
 * Collapse repeated Gateway snapshots into one record per normalized session
 * key. Newer records own conflicting fields while sparse metadata from the
 * other snapshot is retained. Distinct keys are never collapsed merely because
 * their labels match: users may legitimately name two conversations alike.
 */
export function coalesceSessionsByKey<T extends SessionKeyLike>(sessions: readonly T[]): T[] {
  const byKey = new Map<string, { session: T; revision: number }>();

  for (const source of sessions) {
    const key = normalizeSessionKey(source.key ?? '');
    if (!key) continue;
    const candidate = (key === source.key ? source : { ...source, key }) as T;
    const revision = sessionRevision(candidate);
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { session: candidate, revision });
      continue;
    }

    const candidateWins = revision >= current.revision;
    const session = candidateWins
      ? { ...current.session, ...candidate, key }
      : { ...candidate, ...current.session, key };
    byKey.set(key, {
      session: session as T,
      revision: Math.max(current.revision, revision),
    });
  }

  return [...byKey.values()].map(({ session }) => session);
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
  deletedSessionIdentities.clear();
  fallbackKeySequence = 0;
}
