export interface SessionOrganizationSubject {
  readonly key: string;
  readonly sessionId?: string;
}

interface SessionOrganizationEntry {
  readonly topic?: string;
}

interface SessionOrganizationSnapshot {
  readonly version: 1;
  readonly entries: Record<string, SessionOrganizationEntry>;
}

export interface SessionOrganizationProjection {
  readonly topic?: string;
}

const STORAGE_KEY = 'junqi:session-organization:v1';
const LEGACY_TOPIC_STORAGE_KEY = 'aegis:session-topic-prefs';
const LEGACY_PIN_STORAGE_KEY = 'aegis:session-pin-prefs';
const LEGACY_ARCHIVE_STORAGE_KEY = 'aegis:session-archive-prefs';

const EMPTY_SNAPSHOT: SessionOrganizationSnapshot = {
  version: 1,
  entries: {},
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readLegacyStringMap(storageKey: string): Record<string, string> {
  const target = storage();
  if (!target) return {};
  try {
    const parsed = record(JSON.parse(target.getItem(storageKey) ?? 'null'));
    if (!parsed) return {};
    return Object.entries(parsed).reduce<Record<string, string>>((result, [key, value]) => {
      const normalizedKey = nonEmptyString(key);
      const normalizedValue = nonEmptyString(value);
      if (normalizedKey && normalizedValue) result[normalizedKey] = normalizedValue;
      return result;
    }, {});
  } catch {
    return {};
  }
}

function parseSnapshot(value: unknown): SessionOrganizationSnapshot {
  const source = record(value);
  if (!source || source.version !== 1) return EMPTY_SNAPSHOT;
  const rawEntries = record(source.entries) ?? {};
  const entries = Object.fromEntries(Object.entries(rawEntries).flatMap(([identity, value]) => {
    const item = record(value);
    const topic = item ? nonEmptyString(item.topic) : undefined;
    return nonEmptyString(identity) && topic ? [[identity, { topic } satisfies SessionOrganizationEntry]] : [];
  }));
  return { version: 1, entries };
}

function save(snapshot: SessionOrganizationSnapshot): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Persistence is optional; the current renderer state remains usable.
  }
}

function identity(subject: SessionOrganizationSubject): string | null {
  const key = nonEmptyString(subject.key);
  const sessionId = nonEmptyString(subject.sessionId);
  return key && sessionId ? `${key}#${sessionId}` : null;
}

function legacyIdentity(subject: SessionOrganizationSubject): string {
  return nonEmptyString(subject.key) ?? '';
}

function removeLegacyEntry(storageKey: string, sessionKey: string): void {
  const target = storage();
  if (!target || !sessionKey) return;
  try {
    const parsed = record(JSON.parse(target.getItem(storageKey) ?? 'null'));
    if (!parsed || !Object.prototype.hasOwnProperty.call(parsed, sessionKey)) return;
    delete parsed[sessionKey];
    target.setItem(storageKey, JSON.stringify(parsed));
  } catch {
    // A stale legacy cache must not prevent current title persistence.
  }
}

function loadRaw(): SessionOrganizationSnapshot {
  const target = storage();
  if (!target) return EMPTY_SNAPSHOT;
  try {
    return parseSnapshot(JSON.parse(target.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

function migrateLegacyTopic(
  snapshot: SessionOrganizationSnapshot,
  subject: SessionOrganizationSubject,
): SessionOrganizationSnapshot {
  const currentIdentity = identity(subject);
  if (!currentIdentity || snapshot.entries[currentIdentity]) return snapshot;
  const key = legacyIdentity(subject);
  if (!key) return snapshot;
  const topic = readLegacyStringMap(LEGACY_TOPIC_STORAGE_KEY)[key];
  if (!topic) return snapshot;
  const next = {
    ...snapshot,
    entries: { ...snapshot.entries, [currentIdentity]: { topic } },
  };
  save(next);
  removeLegacyEntry(LEGACY_TOPIC_STORAGE_KEY, key);
  return next;
}

function updateEntry(
  subject: SessionOrganizationSubject,
  updater: (entry: SessionOrganizationEntry) => SessionOrganizationEntry,
): SessionOrganizationSnapshot {
  const snapshot = migrateLegacyTopic(loadRaw(), subject);
  const entryIdentity = identity(subject);
  if (!entryIdentity) return snapshot;
  const next: SessionOrganizationSnapshot = {
    ...snapshot,
    entries: { ...snapshot.entries, [entryIdentity]: updater(snapshot.entries[entryIdentity] ?? {}) },
  };
  save(next);
  return next;
}

export function projectSessionOrganization(subject: SessionOrganizationSubject): SessionOrganizationProjection {
  const snapshot = migrateLegacyTopic(loadRaw(), subject);
  const entryIdentity = identity(subject);
  const topic = entryIdentity ? snapshot.entries[entryIdentity]?.topic : undefined;
  return topic ? { topic } : {};
}

export function setSessionOrganizationTopic(
  subject: SessionOrganizationSubject,
  topic: string | undefined,
): SessionOrganizationProjection {
  const normalizedTopic = nonEmptyString(topic);
  const snapshot = updateEntry(subject, (entry) => ({
    ...entry,
    ...(normalizedTopic ? { topic: normalizedTopic } : { topic: undefined }),
  }));
  const entryIdentity = identity(subject);
  const persistedTopic = entryIdentity ? snapshot.entries[entryIdentity]?.topic : undefined;
  return persistedTopic ? { topic: persistedTopic } : {};
}

export function removeSessionOrganization(subject: SessionOrganizationSubject): void {
  const snapshot = loadRaw();
  const currentIdentity = identity(subject);
  const key = legacyIdentity(subject);
  if (!currentIdentity || !key) return;
  const entries = Object.fromEntries(Object.entries(snapshot.entries).filter(([entryIdentity]) => (
    entryIdentity !== currentIdentity && entryIdentity !== key && !entryIdentity.startsWith(`${key}#`)
  )));
  save({ ...snapshot, entries });
}

export function __resetSessionOrganizationForTests(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
    storage()?.removeItem(LEGACY_PIN_STORAGE_KEY);
    storage()?.removeItem(LEGACY_ARCHIVE_STORAGE_KEY);
    storage()?.removeItem(LEGACY_TOPIC_STORAGE_KEY);
  } catch {
    // Test cleanup should not fail when a DOM storage shim is absent.
  }
}
