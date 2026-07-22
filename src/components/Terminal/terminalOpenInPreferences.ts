/** Persistent Kooky-style ordering, visibility, and primary choice for Open In. */
export interface TerminalOpenInPreferencesSnapshot {
  orderedAppIds: readonly string[];
  hiddenAppIds: readonly string[];
  lastUsedAppId: string | null;
}

interface StoredTerminalOpenInPreferences {
  orderedAppIds?: unknown;
  hiddenAppIds?: unknown;
  lastUsedAppId?: unknown;
}

interface AppIdentity {
  id: string;
}

const STORAGE_KEY = 'junqi:terminal-open-in-preferences';
const listeners = new Set<() => void>();
const LEGACY_APP_IDS: Record<string, string> = {
  'file-manager': 'finder',
  code: 'vscode',
  idea: 'intellij',
};

function canonicalAppId(value: string): string {
  const id = value.trim();
  return LEGACY_APP_IDS[id] ?? id;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    .map(canonicalAppId))];
}

function normalize(value: StoredTerminalOpenInPreferences | null | undefined): TerminalOpenInPreferencesSnapshot {
  return Object.freeze({
    orderedAppIds: Object.freeze(ids(value?.orderedAppIds)),
    hiddenAppIds: Object.freeze(ids(value?.hiddenAppIds)),
    lastUsedAppId: typeof value?.lastUsedAppId === 'string' && value.lastUsedAppId.trim()
      ? canonicalAppId(value.lastUsedAppId)
      : null,
  });
}

function read(): TerminalOpenInPreferencesSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) as StoredTerminalOpenInPreferences : null);
  } catch {
    return normalize(null);
  }
}

let snapshot = read();

function publish(next: TerminalOpenInPreferencesSnapshot): void {
  snapshot = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  for (const listener of listeners) listener();
}

export function getTerminalOpenInPreferencesSnapshot(): TerminalOpenInPreferencesSnapshot {
  return snapshot;
}

export function subscribeTerminalOpenInPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Known installed apps move first; stale ids survive to support app reinstallation. */
export function orderedTerminalOpenInApps<T extends AppIdentity>(
  apps: readonly T[],
  preferences: TerminalOpenInPreferencesSnapshot = snapshot,
): readonly T[] {
  const byId = new Map(apps.map((app) => [app.id, app]));
  const ordered = preferences.orderedAppIds.flatMap((id) => {
    const app = byId.get(id);
    return app ? [app] : [];
  });
  const known = new Set(ordered.map((app) => app.id));
  return [...ordered, ...apps.filter((app) => !known.has(app.id))];
}

export function visibleTerminalOpenInApps<T extends AppIdentity>(
  apps: readonly T[],
  preferences: TerminalOpenInPreferencesSnapshot = snapshot,
): readonly T[] {
  const hidden = new Set(preferences.hiddenAppIds);
  return orderedTerminalOpenInApps(apps, preferences).filter((app) => !hidden.has(app.id));
}

export function setTerminalOpenInLastUsed(id: string | null): void {
  publish(normalize({
    orderedAppIds: snapshot.orderedAppIds,
    hiddenAppIds: snapshot.hiddenAppIds,
    lastUsedAppId: id ? canonicalAppId(id) : null,
  }));
}

export function setTerminalOpenInAppHidden(id: string, hidden: boolean): void {
  const canonicalId = canonicalAppId(id);
  const next = new Set(snapshot.hiddenAppIds);
  if (hidden) next.add(canonicalId);
  else next.delete(canonicalId);
  publish(normalize({
    orderedAppIds: snapshot.orderedAppIds,
    hiddenAppIds: [...next],
    lastUsedAppId: hidden && snapshot.lastUsedAppId === canonicalId ? null : snapshot.lastUsedAppId,
  }));
}

export function moveTerminalOpenInApp(id: string, direction: -1 | 1, installedAppIds: readonly string[]): void {
  const canonicalId = canonicalAppId(id);
  const current = orderedTerminalOpenInApps(installedAppIds.map((appId) => ({ id: canonicalAppId(appId) }))).map((app) => app.id);
  const index = current.indexOf(canonicalId);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= current.length) return;
  [current[index], current[destination]] = [current[destination]!, current[index]!];
  const installed = new Set(installedAppIds);
  const preservedUnknown = snapshot.orderedAppIds.filter((candidate) => !installed.has(candidate));
  publish(normalize({
    orderedAppIds: [...current, ...preservedUnknown],
    hiddenAppIds: snapshot.hiddenAppIds,
    lastUsedAppId: snapshot.lastUsedAppId,
  }));
}

export function resetTerminalOpenInPreferences(): void {
  snapshot = normalize(null);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const listener of listeners) listener();
}
