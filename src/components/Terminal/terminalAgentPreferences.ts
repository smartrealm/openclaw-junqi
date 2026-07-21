import {
  TERMINAL_AGENT_LAUNCHERS,
  isTerminalAgentId,
  type TerminalAgentId,
} from './terminalAgentCatalog';

export type TerminalDefaultLauncherId = 'terminal' | TerminalAgentId | null;

export interface TerminalAgentPreferencesSnapshot {
  orderedAgentIds: readonly TerminalAgentId[];
  hiddenAgentIds: readonly TerminalAgentId[];
  defaultLauncherId: TerminalDefaultLauncherId;
}

interface StoredTerminalAgentPreferences {
  orderedAgentIds?: unknown;
  hiddenAgentIds?: unknown;
  defaultLauncherId?: unknown;
}

const STORAGE_KEY = 'junqi:terminal-agent-preferences';
const ALL_AGENT_IDS = TERMINAL_AGENT_LAUNCHERS.map((launcher) => launcher.id);
const listeners = new Set<() => void>();

function uniqueAgentIds(value: unknown): TerminalAgentId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<TerminalAgentId>();
  const ids: TerminalAgentId[] = [];
  for (const candidate of value) {
    if (typeof candidate !== 'string' || !isTerminalAgentId(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    ids.push(candidate);
  }
  return ids;
}

function normalize(value: StoredTerminalAgentPreferences | null | undefined): TerminalAgentPreferencesSnapshot {
  const requestedOrder = uniqueAgentIds(value?.orderedAgentIds);
  const known = new Set(requestedOrder);
  const orderedAgentIds = Object.freeze([
    ...requestedOrder,
    ...ALL_AGENT_IDS.filter((id) => !known.has(id)),
  ]);
  const hiddenAgentIds = Object.freeze(uniqueAgentIds(value?.hiddenAgentIds));
  const defaultLauncherId = value?.defaultLauncherId === 'terminal'
    ? 'terminal'
    : typeof value?.defaultLauncherId === 'string' && isTerminalAgentId(value.defaultLauncherId)
      ? value.defaultLauncherId
      : null;
  return Object.freeze({ orderedAgentIds, hiddenAgentIds, defaultLauncherId });
}

function read(): TerminalAgentPreferencesSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) as StoredTerminalAgentPreferences : null);
  } catch {
    return normalize(null);
  }
}

let snapshot = read();

function persist(next: TerminalAgentPreferencesSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      orderedAgentIds: next.orderedAgentIds,
      hiddenAgentIds: next.hiddenAgentIds,
      defaultLauncherId: next.defaultLauncherId,
    }));
  } catch {}
}

function publish(next: TerminalAgentPreferencesSnapshot): void {
  snapshot = next;
  persist(next);
  for (const listener of listeners) listener();
}

export function getTerminalAgentPreferencesSnapshot(): TerminalAgentPreferencesSnapshot {
  return snapshot;
}

export function subscribeTerminalAgentPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ordered visible builtins shared by every terminal launch surface. */
export function visibleTerminalAgentIds(
  preferences: TerminalAgentPreferencesSnapshot = snapshot,
): readonly TerminalAgentId[] {
  const hidden = new Set(preferences.hiddenAgentIds);
  return preferences.orderedAgentIds.filter((id) => !hidden.has(id));
}

export function setTerminalAgentHidden(agent: TerminalAgentId, hidden: boolean): void {
  const nextHidden = new Set(snapshot.hiddenAgentIds);
  if (hidden) nextHidden.add(agent);
  else nextHidden.delete(agent);
  const defaultLauncherId = hidden && snapshot.defaultLauncherId === agent
    ? null
    : snapshot.defaultLauncherId;
  publish(normalize({
    orderedAgentIds: snapshot.orderedAgentIds,
    hiddenAgentIds: [...nextHidden],
    defaultLauncherId,
  }));
}

export function moveTerminalAgent(agent: TerminalAgentId, direction: -1 | 1): void {
  const order = [...snapshot.orderedAgentIds];
  const index = order.indexOf(agent);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= order.length) return;
  [order[index], order[destination]] = [order[destination]!, order[index]!];
  publish(normalize({
    orderedAgentIds: order,
    hiddenAgentIds: snapshot.hiddenAgentIds,
    defaultLauncherId: snapshot.defaultLauncherId,
  }));
}

export function setTerminalDefaultLauncher(defaultLauncherId: TerminalDefaultLauncherId): void {
  publish(normalize({
    orderedAgentIds: snapshot.orderedAgentIds,
    hiddenAgentIds: snapshot.hiddenAgentIds,
    defaultLauncherId,
  }));
}

/** Test-only reset for a module that intentionally survives route changes. */
export function resetTerminalAgentPreferences(): void {
  snapshot = normalize(null);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const listener of listeners) listener();
}
