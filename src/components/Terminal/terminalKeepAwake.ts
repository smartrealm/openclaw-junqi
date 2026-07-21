import { invoke } from '@tauri-apps/api/core';

export type TerminalKeepAwakeMode = 'off' | 'auto' | 'always';

export interface TerminalKeepAwakeSnapshot {
  mode: TerminalKeepAwakeMode;
  hasActiveWork: boolean;
  /** Confirmed by the native backend, never inferred from the selected mode. */
  keepingAwake: boolean;
  pending: boolean;
  error: string | null;
}

interface TerminalKeepAwakeBackendStatus {
  active: boolean;
}

const STORAGE_KEY = 'junqi:terminal-keep-awake-mode';
const listeners = new Set<() => void>();

function ownerId(): string {
  if (typeof window === 'undefined') return 'terminal:main';
  const label = (window as Window & { __JUNQI_TERMINAL_WINDOW_LABEL__?: unknown })
    .__JUNQI_TERMINAL_WINDOW_LABEL__;
  return typeof label === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(label)
    ? `terminal:${label}`
    : 'terminal:main';
}

const OWNER_ID = ownerId();

function readMode(): TerminalKeepAwakeMode {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isTerminalKeepAwakeMode(value) ? value : 'auto';
  } catch {
    return 'auto';
  }
}

let snapshot: Readonly<TerminalKeepAwakeSnapshot> = Object.freeze({
  mode: readMode(),
  hasActiveWork: false,
  keepingAwake: false,
  pending: false,
  error: null,
});
let appliedOwnerState: boolean | null = null;
let inFlight = false;
let failedTarget: boolean | null = null;
let ownerReleased = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function update(patch: Partial<TerminalKeepAwakeSnapshot>): void {
  snapshot = Object.freeze({ ...snapshot, ...patch });
  notify();
}

export function isTerminalKeepAwakeMode(value: unknown): value is TerminalKeepAwakeMode {
  return value === 'off' || value === 'auto' || value === 'always';
}

export function nextTerminalKeepAwakeMode(mode: TerminalKeepAwakeMode): TerminalKeepAwakeMode {
  if (mode === 'off') return 'auto';
  if (mode === 'auto') return 'always';
  return 'off';
}

/** Kooky rule: only a running agent or a live SSH PTY wakes the auto dial. */
export function shouldKeepTerminalAwake(mode: TerminalKeepAwakeMode, hasActiveWork: boolean): boolean {
  return mode === 'always' || (mode === 'auto' && hasActiveWork);
}

function desired(): boolean {
  return !ownerReleased && shouldKeepTerminalAwake(snapshot.mode, snapshot.hasActiveWork);
}

/**
 * Serialize backend requests. A quick off -> auto -> always cycle cannot let
 * an older async request win and leave a stale OS assertion behind.
 */
function reconcileNativeKeepAwake(): void {
  const target = desired();
  if (inFlight || target === appliedOwnerState || target === failedTarget) return;

  inFlight = true;
  update({ pending: true, error: null });
  void invoke<TerminalKeepAwakeBackendStatus>('set_terminal_keep_awake', {
    active: target,
    ownerId: OWNER_ID,
  })
    .then((result) => {
      // `active` is the aggregate across every terminal window. Keep the
      // owner's acknowledged state separately so another live window cannot
      // make this renderer re-send a release forever.
      appliedOwnerState = target;
      failedTarget = null;
      update({ keepingAwake: result.active, pending: false, error: null });
    })
    .catch((error: unknown) => {
      failedTarget = target;
      // Preserve the last native-confirmed value. A failed release must not
      // pretend that an assertion has been removed.
      update({ pending: false, error: String(error) });
    })
    .finally(() => {
      inFlight = false;
      if (desired() !== target) reconcileNativeKeepAwake();
    });
}

export function setTerminalKeepAwakeWorkActive(hasActiveWork: boolean): void {
  ownerReleased = false;
  if (snapshot.hasActiveWork !== hasActiveWork) update({ hasActiveWork });
  if (desired() !== failedTarget) failedTarget = null;
  reconcileNativeKeepAwake();
}

export function cycleTerminalKeepAwakeMode(): void {
  const mode = nextTerminalKeepAwakeMode(snapshot.mode);
  try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
  failedTarget = null;
  ownerReleased = false;
  update({ mode, error: null });
  reconcileNativeKeepAwake();
}

/** Release only this Tauri window's lease while preserving the saved dial. */
export function releaseTerminalKeepAwakeOwner(): void {
  ownerReleased = true;
  failedTarget = null;
  reconcileNativeKeepAwake();
}

export function getTerminalKeepAwakeSnapshot(): Readonly<TerminalKeepAwakeSnapshot> {
  return snapshot;
}

export function subscribeTerminalKeepAwake(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
