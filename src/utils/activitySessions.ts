import type { Session } from '@/stores/chatStore';
import type { SessionInfo } from '@/stores/gatewayDataStore';

export interface ActivitySessionRecord {
  session: Session;
  usage?: Record<string, unknown>;
}

export interface ActivitySessionMetrics {
  tokens?: number;
  cost?: number;
  durationMs?: number;
}

type DataRecord = Record<string, unknown>;

function asRecord(value: unknown): DataRecord {
  return value && typeof value === 'object' ? value as DataRecord : {};
}

function nonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== undefined) return number;
  }
  return undefined;
}

function epochMs(value: unknown): number | undefined {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())
      ? Number(value)
      : undefined;
  if (numeric !== undefined && Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function timestampString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const ms = epochMs(value);
    if (ms !== undefined) return new Date(ms).toISOString();
  }
  return undefined;
}

function modelFrom(record: DataRecord, usage: DataRecord, metadata: DataRecord): string | undefined {
  return nonEmptyString(
    record.model,
    record.modelName,
    record.modelId,
    record.modelSlug,
    usage.model,
    usage.modelName,
    usage.modelId,
    metadata.model,
    metadata.modelName,
  );
}

function costFrom(record: DataRecord, usage: DataRecord): number | undefined {
  const nestedCost = asRecord(usage.cost);
  const recordCost = asRecord(record.cost);
  return firstNumber(
    record.totalCost,
    record.cost,
    recordCost.total,
    recordCost.totalCost,
    recordCost.amount,
    usage.totalCost,
    nestedCost.total,
    nestedCost.totalCost,
    nestedCost.amount,
  );
}

function sessionFromRecord(record: DataRecord): Session | null {
  const key = nonEmptyString(record.key, record.sessionKey, record.sessionId);
  if (!key) return null;
  const usage = asRecord(record.usage);
  const metadata = asRecord(record.metadata);
  const updatedAt = timestampString(
    record.updatedAt,
    record.lastActive,
    record.lastTimestamp,
    usage.lastActivity,
    usage.updatedAt,
  );
  const createdAt = epochMs(record.createdAt) ?? epochMs(updatedAt);
  const totalTokens = firstNumber(
    record.totalTokens,
    usage.totalTokens,
    usage.inputTokens !== undefined && usage.outputTokens !== undefined
      ? Number(usage.inputTokens) + Number(usage.outputTokens)
      : undefined,
  );
  const model = modelFrom(record, usage, metadata);

  return {
    ...record,
    key,
    label: nonEmptyString(record.label, record.displayName, record.topic, key) || key,
    agentId: nonEmptyString(record.agentId, record.agent, key.split(':')[1]),
    model,
    totalTokens,
    createdAt,
    updatedAt,
    lastActive: updatedAt,
    status: nonEmptyString(record.status) || 'stopped',
    running: false,
  } as Session;
}

export function normalizeUsageSession(value: unknown): ActivitySessionRecord | null {
  const record = asRecord(value);
  const session = sessionFromRecord(record);
  if (!session) return null;
  return { session, usage: asRecord(record.usage) };
}

export function activitySessionMetrics(record: ActivitySessionRecord): ActivitySessionMetrics {
  const session = asRecord(record.session);
  const usage = record.usage || {};
  const tokens = firstNumber(session.totalTokens, usage.totalTokens);
  const cost = costFrom(session, usage);
  const durationMs = firstNumber(
    session.durationMs,
    session.duration,
    usage.durationMs,
    usage.duration,
  );
  return {
    tokens: tokens !== undefined && tokens > 0 ? tokens : undefined,
    cost: cost !== undefined && cost > 0 ? cost : undefined,
    durationMs: durationMs !== undefined && durationMs > 0 ? durationMs : undefined,
  };
}

function normalizeSession(value: Session | SessionInfo): Session {
  const record = asRecord(value);
  const key = nonEmptyString(record.key) || '';
  return {
    ...record,
    key,
    label: nonEmptyString(record.label, record.displayName, record.topic, key) || key,
  } as Session;
}

/**
 * Merge historical usage rows with live Gateway and chat snapshots. Usage is
 * inserted first so live snapshots win while their nested metrics remain
 * available for rows that only exist in sessions.usage.
 */
export function mergeActivitySessions({
  usageSessions,
  gatewaySessions,
  chatSessions,
}: {
  usageSessions?: unknown[];
  gatewaySessions: SessionInfo[];
  chatSessions: Session[];
}): ActivitySessionRecord[] {
  const byKey = new Map<string, ActivitySessionRecord>();

  const put = (session: Session, usage?: Record<string, unknown>) => {
    if (!session.key) return;
    const previous = byKey.get(session.key);
    const merged = {
      ...(previous?.session || {}),
      ...session,
      key: session.key,
      label: nonEmptyString(session.label, previous?.session.label, session.key) || session.key,
    } as Session;
    if (!merged.model && previous?.session.model) merged.model = previous.session.model;
    if (!(merged.totalTokens && merged.totalTokens > 0) && previous?.session.totalTokens) {
      merged.totalTokens = previous.session.totalTokens;
    }
    if (!merged.lastActive && previous?.session.lastActive) merged.lastActive = previous.session.lastActive;
    if (!merged.updatedAt && previous?.session.updatedAt) merged.updatedAt = previous.session.updatedAt;
    byKey.set(session.key, {
      session: merged,
      usage: previous?.usage || usage ? { ...(previous?.usage || {}), ...(usage || {}) } : undefined,
    });
  };

  for (const value of usageSessions || []) {
    const normalized = normalizeUsageSession(value);
    if (normalized) put(normalized.session, normalized.usage);
  }
  for (const session of gatewaySessions) put(normalizeSession(session));
  for (const session of chatSessions) put(normalizeSession(session));
  return [...byKey.values()];
}
