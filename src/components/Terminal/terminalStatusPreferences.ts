/** Real status signals the embedded terminal can currently produce. */
export const TERMINAL_STATUS_ITEMS = [
  'tool-calls',
  'remote-login',
  'python-venv',
  'node-version',
  'proxy',
  'git-branch',
  'git-diff',
] as const;

export type TerminalStatusItem = (typeof TERMINAL_STATUS_ITEMS)[number];

export const TERMINAL_STATUS_ITEM_LABELS: Record<TerminalStatusItem, string> = {
  'tool-calls': 'Tool calls',
  'remote-login': 'Remote login',
  'python-venv': 'Python venv',
  'node-version': 'Node version',
  proxy: 'Proxy',
  'git-branch': 'Git branch',
  'git-diff': 'Git diff',
};

export interface TerminalStatusPreferencesSnapshot {
  orderedItems: readonly TerminalStatusItem[];
  hiddenItems: readonly TerminalStatusItem[];
}

interface StoredTerminalStatusPreferences {
  orderedItems?: unknown;
  hiddenItems?: unknown;
}

const STORAGE_KEY = 'junqi:terminal-status-preferences';
const listeners = new Set<() => void>();
const known = new Set<string>(TERMINAL_STATUS_ITEMS);

function items(value: unknown): TerminalStatusItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<TerminalStatusItem>();
  return value.flatMap((candidate) => {
    if (typeof candidate !== 'string' || !known.has(candidate) || seen.has(candidate as TerminalStatusItem)) return [];
    const item = candidate as TerminalStatusItem;
    seen.add(item);
    return [item];
  });
}

function normalize(value: StoredTerminalStatusPreferences | null | undefined): TerminalStatusPreferencesSnapshot {
  const requested = items(value?.orderedItems);
  const listed = new Set(requested);
  return Object.freeze({
    orderedItems: Object.freeze([...requested, ...TERMINAL_STATUS_ITEMS.filter((item) => !listed.has(item))]),
    hiddenItems: Object.freeze(items(value?.hiddenItems)),
  });
}

function read(): TerminalStatusPreferencesSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) as StoredTerminalStatusPreferences : null);
  } catch {
    return normalize(null);
  }
}

let snapshot = read();

function publish(next: TerminalStatusPreferencesSnapshot): void {
  snapshot = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  for (const listener of listeners) listener();
}

export function getTerminalStatusPreferencesSnapshot(): TerminalStatusPreferencesSnapshot {
  return snapshot;
}

export function subscribeTerminalStatusPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function visibleTerminalStatusItems(
  preferences: TerminalStatusPreferencesSnapshot = snapshot,
): readonly TerminalStatusItem[] {
  const hidden = new Set(preferences.hiddenItems);
  return preferences.orderedItems.filter((item) => !hidden.has(item));
}

export function moveTerminalStatusItem(item: TerminalStatusItem, direction: -1 | 1): void {
  const order = [...snapshot.orderedItems];
  const index = order.indexOf(item);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= order.length) return;
  [order[index], order[destination]] = [order[destination]!, order[index]!];
  publish(normalize({ orderedItems: order, hiddenItems: snapshot.hiddenItems }));
}

export function setTerminalStatusItemHidden(item: TerminalStatusItem, hidden: boolean): void {
  const next = new Set(snapshot.hiddenItems);
  if (hidden) next.add(item);
  else next.delete(item);
  publish(normalize({ orderedItems: snapshot.orderedItems, hiddenItems: [...next] }));
}

export function resetTerminalStatusPreferences(): void {
  snapshot = normalize(null);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const listener of listeners) listener();
}
