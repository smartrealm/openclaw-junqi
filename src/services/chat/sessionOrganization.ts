export interface SessionOrganizationSubject {
  readonly key: string;
  readonly sessionId?: string;
}

export interface SessionGroup {
  readonly id: string;
  readonly label: string;
  readonly createdAt: number;
}

export interface SessionOrganizationEntry {
  readonly pinned?: boolean;
  readonly unread?: boolean;
  readonly archived?: boolean;
  readonly groupId?: string;
  readonly topic?: string;
}

interface SessionOrganizationSnapshot {
  readonly version: 1;
  readonly groups: Record<string, SessionGroup>;
  readonly entries: Record<string, SessionOrganizationEntry>;
}

export interface SessionOrganizationProjection {
  readonly pinned: boolean;
  readonly unread: boolean;
  readonly archived: boolean;
  readonly groupId?: string;
  readonly topic?: string;
}

const STORAGE_KEY = 'junqi:session-organization:v1';
const LEGACY_PIN_STORAGE_KEY = 'aegis:session-pin-prefs';
const LEGACY_ARCHIVE_STORAGE_KEY = 'aegis:session-archive-prefs';
const LEGACY_TOPIC_STORAGE_KEY = 'aegis:session-topic-prefs';

const EMPTY_SNAPSHOT: SessionOrganizationSnapshot = {
  version: 1,
  groups: {},
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

function readLegacyBooleanMap(storageKey: string): Record<string, boolean> {
  const target = storage();
  if (!target) return {};
  try {
    const parsed = record(JSON.parse(target.getItem(storageKey) ?? 'null'));
    if (!parsed) return {};
    return Object.entries(parsed).reduce<Record<string, boolean>>((result, [key, value]) => {
      if (nonEmptyString(key) && typeof value === 'boolean') result[key] = value;
      return result;
    }, {});
  } catch {
    return {};
  }
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
  const rawGroups = record(source.groups) ?? {};
  const groups = Object.fromEntries(Object.entries(rawGroups).flatMap(([id, value]) => {
    const item = record(value);
    const label = item ? nonEmptyString(item.label) : undefined;
    const createdAt = item?.createdAt;
    return label && typeof createdAt === 'number' && Number.isFinite(createdAt)
      ? [[id, { id, label, createdAt } satisfies SessionGroup]]
      : [];
  }));
  const rawEntries = record(source.entries) ?? {};
  const entries = Object.fromEntries(Object.entries(rawEntries).flatMap(([identity, value]) => {
    const item = record(value);
    if (!item || !nonEmptyString(identity)) return [];
    const groupId = nonEmptyString(item.groupId);
    const topic = nonEmptyString(item.topic);
    const entry: SessionOrganizationEntry = {
      ...(typeof item.pinned === 'boolean' ? { pinned: item.pinned } : {}),
      ...(typeof item.unread === 'boolean' ? { unread: item.unread } : {}),
      ...(typeof item.archived === 'boolean' ? { archived: item.archived } : {}),
      ...(groupId && Object.prototype.hasOwnProperty.call(groups, groupId) ? { groupId } : {}),
      ...(topic ? { topic } : {}),
    };
    return Object.keys(entry).length ? [[identity, entry]] : [];
  }));
  return { version: 1, groups, entries };
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
    // A stale legacy cache must not prevent current organization persistence.
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

function migrateLegacyEntry(
  snapshot: SessionOrganizationSnapshot,
  subject: SessionOrganizationSubject,
): SessionOrganizationSnapshot {
  const currentIdentity = identity(subject);
  if (!currentIdentity) return snapshot;
  if (snapshot.entries[currentIdentity]) return snapshot;
  const key = legacyIdentity(subject);
  if (!key) return snapshot;
  const legacyPinned = readLegacyBooleanMap(LEGACY_PIN_STORAGE_KEY)[key];
  const legacyArchived = readLegacyBooleanMap(LEGACY_ARCHIVE_STORAGE_KEY)[key];
  const legacyTopic = readLegacyStringMap(LEGACY_TOPIC_STORAGE_KEY)[key];
  if (legacyPinned === undefined && legacyArchived === undefined && legacyTopic === undefined) return snapshot;
  const next: SessionOrganizationSnapshot = {
    ...snapshot,
    entries: {
      ...snapshot.entries,
      [currentIdentity]: {
        ...(legacyPinned !== undefined ? { pinned: legacyPinned } : {}),
        ...(legacyArchived !== undefined ? { archived: legacyArchived } : {}),
        ...(legacyTopic !== undefined ? { topic: legacyTopic } : {}),
      },
    },
  };
  save(next);
  removeLegacyEntry(LEGACY_PIN_STORAGE_KEY, key);
  removeLegacyEntry(LEGACY_ARCHIVE_STORAGE_KEY, key);
  removeLegacyEntry(LEGACY_TOPIC_STORAGE_KEY, key);
  return next;
}

function updateEntry(
  subject: SessionOrganizationSubject,
  updater: (entry: SessionOrganizationEntry) => SessionOrganizationEntry,
): SessionOrganizationSnapshot {
  const snapshot = migrateLegacyEntry(loadRaw(), subject);
  const entryIdentity = identity(subject);
  if (!entryIdentity) return snapshot;
  const next: SessionOrganizationSnapshot = {
    ...snapshot,
    entries: {
      ...snapshot.entries,
      [entryIdentity]: updater(snapshot.entries[entryIdentity] ?? {}),
    },
  };
  save(next);
  return next;
}

export function getSessionOrganizationGroups(): SessionGroup[] {
  return Object.values(loadRaw().groups).sort((left, right) => left.createdAt - right.createdAt);
}

export function projectSessionOrganization(subject: SessionOrganizationSubject): SessionOrganizationProjection {
  const snapshot = migrateLegacyEntry(loadRaw(), subject);
  const entryIdentity = identity(subject);
  const entry = entryIdentity ? snapshot.entries[entryIdentity] ?? {} : {};
  return {
    pinned: entry.pinned === true,
    unread: entry.unread === true,
    archived: entry.archived === true,
    ...(entry.groupId ? { groupId: entry.groupId } : {}),
    ...(entry.topic ? { topic: entry.topic } : {}),
  };
}

export function setSessionOrganizationFlag(
  subject: SessionOrganizationSubject,
  flag: 'pinned' | 'unread' | 'archived',
  value: boolean,
): SessionOrganizationProjection {
  const snapshot = updateEntry(subject, (entry) => ({ ...entry, [flag]: value }));
  const entryIdentity = identity(subject);
  const entry = entryIdentity ? snapshot.entries[entryIdentity] ?? {} : {};
  return {
    pinned: entry.pinned === true,
    unread: entry.unread === true,
    archived: entry.archived === true,
    ...(entry.groupId ? { groupId: entry.groupId } : {}),
    ...(entry.topic ? { topic: entry.topic } : {}),
  };
}

export function createSessionOrganizationGroup(label: string): SessionGroup | null {
  const normalizedLabel = nonEmptyString(label);
  if (!normalizedLabel) return null;
  const snapshot = loadRaw();
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const group: SessionGroup = { id, label: normalizedLabel, createdAt: Date.now() };
  save({ ...snapshot, groups: { ...snapshot.groups, [id]: group } });
  return group;
}

export function renameSessionOrganizationGroup(groupId: string, label: string): SessionGroup | null {
  const normalizedLabel = nonEmptyString(label);
  if (!normalizedLabel) return null;
  const snapshot = loadRaw();
  const group = snapshot.groups[groupId];
  if (!group) return null;
  const nextGroup: SessionGroup = { ...group, label: normalizedLabel };
  save({ ...snapshot, groups: { ...snapshot.groups, [groupId]: nextGroup } });
  return nextGroup;
}

export function setSessionOrganizationGroup(
  subject: SessionOrganizationSubject,
  groupId: string | null,
): SessionOrganizationProjection {
  const normalizedGroupId = nonEmptyString(groupId);
  const snapshot = loadRaw();
  const validGroupId = normalizedGroupId && Object.prototype.hasOwnProperty.call(snapshot.groups, normalizedGroupId)
    ? normalizedGroupId
    : undefined;
  const entryIdentity = identity(subject);
  if (!entryIdentity) return { pinned: false, unread: false, archived: false };
  const next: SessionOrganizationSnapshot = {
    ...snapshot,
    entries: {
      ...snapshot.entries,
      [entryIdentity]: {
        ...(snapshot.entries[entryIdentity] ?? {}),
        ...(validGroupId ? { groupId: validGroupId } : { groupId: undefined }),
      },
    },
  };
  save(next);
  const entry = next.entries[entryIdentity];
  return {
    pinned: entry?.pinned === true,
    unread: entry?.unread === true,
    archived: entry?.archived === true,
    ...(entry?.groupId ? { groupId: entry.groupId } : {}),
    ...(entry?.topic ? { topic: entry.topic } : {}),
  };
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
  const entry = entryIdentity ? snapshot.entries[entryIdentity] ?? {} : {};
  return {
    pinned: entry.pinned === true,
    unread: entry.unread === true,
    archived: entry.archived === true,
    ...(entry.groupId ? { groupId: entry.groupId } : {}),
    ...(entry.topic ? { topic: entry.topic } : {}),
  };
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

export function deleteSessionOrganizationGroup(groupId: string): void {
  const snapshot = loadRaw();
  if (!Object.prototype.hasOwnProperty.call(snapshot.groups, groupId)) return;
  const groups = { ...snapshot.groups };
  delete groups[groupId];
  const entries = Object.fromEntries(Object.entries(snapshot.entries).map(([id, entry]) => [
    id,
    entry.groupId === groupId ? { ...entry, groupId: undefined } : entry,
  ]));
  save({ ...snapshot, groups, entries });
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
