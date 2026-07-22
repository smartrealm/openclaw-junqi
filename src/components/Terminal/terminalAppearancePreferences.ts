export type TerminalCursorStyle = 'block' | 'bar' | 'underline';

export interface TerminalAppearancePreferencesSnapshot {
  cursorStyle: TerminalCursorStyle;
}

interface StoredTerminalAppearancePreferences {
  cursorStyle?: unknown;
}

const STORAGE_KEY = 'junqi:terminal-appearance-preferences';
const listeners = new Set<() => void>();

function normalize(value: StoredTerminalAppearancePreferences | null | undefined): TerminalAppearancePreferencesSnapshot {
  const cursorStyle = value?.cursorStyle === 'bar' || value?.cursorStyle === 'underline'
    ? value.cursorStyle
    : 'block';
  return Object.freeze({ cursorStyle });
}

function read(): TerminalAppearancePreferencesSnapshot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalize(raw ? JSON.parse(raw) as StoredTerminalAppearancePreferences : null);
  } catch {
    return normalize(null);
  }
}

let snapshot = read();

function publish(next: TerminalAppearancePreferencesSnapshot): void {
  snapshot = next;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  for (const listener of listeners) listener();
}

export function getTerminalAppearancePreferencesSnapshot(): TerminalAppearancePreferencesSnapshot {
  return snapshot;
}

export function subscribeTerminalAppearancePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setTerminalCursorStyle(cursorStyle: TerminalCursorStyle): void {
  publish(normalize({ cursorStyle }));
}

export function resetTerminalAppearancePreferences(): void {
  snapshot = normalize(null);
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  for (const listener of listeners) listener();
}
