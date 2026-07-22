/**
 * Persistent "Terminal at <path>" launch entries.
 *
 * This intentionally lives apart from Agent preferences: a preset starts a
 * plain shell at a real directory and never claims agent lifecycle state.
 */
export interface TerminalPreset {
  id: string;
  title: string;
  path: string;
}

export interface TerminalPresetPreferencesSnapshot {
  presets: readonly TerminalPreset[];
  hiddenPresetIds: readonly string[];
}

interface StoredTerminalPresetPreferences {
  presets?: unknown;
  hiddenPresetIds?: unknown;
}

const STORAGE_KEY = 'junqi:terminal-presets';
const listeners = new Set<() => void>();

function plainText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isPresetId(value: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/i.test(value);
}

function normalizePreset(value: unknown, occupied: Set<string>): TerminalPreset | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = plainText(record.id);
  if (!isPresetId(id) || occupied.has(id) || id === 'terminal') return null;
  occupied.add(id);
  return Object.freeze({
    id,
    title: plainText(record.title),
    path: plainText(record.path),
  });
}

function normalize(value: StoredTerminalPresetPreferences | null | undefined): TerminalPresetPreferencesSnapshot {
  const occupied = new Set<string>();
  const presets: TerminalPreset[] = [];
  if (Array.isArray(value?.presets)) {
    value.presets.forEach((candidate) => {
      const preset = normalizePreset(candidate, occupied);
      if (preset) presets.push(preset);
    });
  }
  const known = new Set(presets.map((preset) => preset.id));
  const hiddenPresetIds = Array.isArray(value?.hiddenPresetIds)
    ? [...new Set(value.hiddenPresetIds.filter((id): id is string => typeof id === 'string' && known.has(id)))]
    : [];
  return Object.freeze({
    presets: Object.freeze(presets),
    hiddenPresetIds: Object.freeze(hiddenPresetIds),
  });
}

function read(): TerminalPresetPreferencesSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) as StoredTerminalPresetPreferences : null);
  } catch {
    return normalize(null);
  }
}

let snapshot = read();

function persist(next: TerminalPresetPreferencesSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

function publish(next: TerminalPresetPreferencesSnapshot): void {
  snapshot = next;
  persist(next);
  for (const listener of listeners) listener();
}

function nextPresetId(presets: readonly TerminalPreset[]): string {
  const occupied = new Set(presets.map((preset) => preset.id));
  let number = 1;
  while (occupied.has(`preset-${number}`)) number += 1;
  return `preset-${number}`;
}

export function terminalPresetDisplayTitle(preset: Pick<TerminalPreset, 'id' | 'title' | 'path'>): string {
  if (preset.title.trim()) return preset.title.trim();
  const normalized = preset.path.trim().replace(/[\\/]+$/, '');
  const basename = normalized.split(/[\\/]/).pop()?.trim();
  return basename || preset.id;
}

export function getTerminalPresetPreferencesSnapshot(): TerminalPresetPreferencesSnapshot {
  return snapshot;
}

export function subscribeTerminalPresetPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Kooky's launch-surface rule: blank paths and hidden rows never launch. */
export function visibleTerminalPresets(
  preferences: TerminalPresetPreferencesSnapshot = snapshot,
): readonly TerminalPreset[] {
  const hidden = new Set(preferences.hiddenPresetIds);
  return preferences.presets.filter((preset) => preset.path.trim() && !hidden.has(preset.id));
}

export function addTerminalPreset(): TerminalPreset {
  const preset = Object.freeze({ id: nextPresetId(snapshot.presets), title: '', path: '' });
  publish(normalize({
    presets: [...snapshot.presets, preset],
    hiddenPresetIds: snapshot.hiddenPresetIds,
  }));
  return preset;
}

export function updateTerminalPreset(id: string, patch: Partial<Pick<TerminalPreset, 'title' | 'path'>>): void {
  const target = id.trim();
  if (!target || !snapshot.presets.some((preset) => preset.id === target)) return;
  publish(normalize({
    presets: snapshot.presets.map((preset) => preset.id === target ? {
      ...preset,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.path !== undefined ? { path: patch.path } : {}),
    } : preset),
    hiddenPresetIds: snapshot.hiddenPresetIds,
  }));
}

export function deleteTerminalPreset(id: string): void {
  const target = id.trim();
  if (!target || !snapshot.presets.some((preset) => preset.id === target)) return;
  publish(normalize({
    presets: snapshot.presets.filter((preset) => preset.id !== target),
    hiddenPresetIds: snapshot.hiddenPresetIds.filter((candidate) => candidate !== target),
  }));
}

export function moveTerminalPreset(id: string, direction: -1 | 1): void {
  const index = snapshot.presets.findIndex((preset) => preset.id === id);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= snapshot.presets.length) return;
  const presets = [...snapshot.presets];
  [presets[index], presets[destination]] = [presets[destination]!, presets[index]!];
  publish(normalize({ presets, hiddenPresetIds: snapshot.hiddenPresetIds }));
}

export function setTerminalPresetHidden(id: string, hidden: boolean): void {
  if (!snapshot.presets.some((preset) => preset.id === id)) return;
  const next = new Set(snapshot.hiddenPresetIds);
  if (hidden) next.add(id);
  else next.delete(id);
  publish(normalize({ presets: snapshot.presets, hiddenPresetIds: [...next] }));
}

/** Test-only reset for the module-level local preference store. */
export function resetTerminalPresetPreferences(): void {
  snapshot = normalize(null);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const listener of listeners) listener();
}
