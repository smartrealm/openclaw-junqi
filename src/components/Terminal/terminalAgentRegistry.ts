import type { TerminalAgentActivity } from './shellLifecycle';

export type TerminalAgentPanelMode = 'full' | 'compact' | 'hidden';

export interface TerminalAgentOverviewEntry {
  shellId: string;
  agent: TerminalAgentActivity['agent'];
  state: TerminalAgentActivity['state'];
  title: string;
  projectPath: string;
  updatedAt: number;
  focus: () => void;
}

export type TerminalAgentOverviewInput = Omit<TerminalAgentOverviewEntry, 'updatedAt'> & {
  updatedAt?: number;
};

const entries = new Map<string, TerminalAgentOverviewEntry>();
const listeners = new Set<() => void>();
let snapshot: readonly TerminalAgentOverviewEntry[] = [];

function stateRank(state: TerminalAgentActivity['state']): number {
  return state === 'attention' ? 0 : 1;
}

function rebuildSnapshot(): void {
  snapshot = Object.freeze(
    [...entries.values()].sort((left, right) => (
      stateRank(left.state) - stateRank(right.state)
      || right.updatedAt - left.updatedAt
      || left.title.localeCompare(right.title)
    )),
  );
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Live terminal agents only. Completed shell work never becomes historical monitor noise. */
export function upsertTerminalAgentOverview(input: TerminalAgentOverviewInput): void {
  const shellId = input.shellId.trim();
  if (!shellId) return;

  const title = input.title.trim() || 'Terminal';
  const projectPath = input.projectPath.trim();
  const existing = entries.get(shellId);
  const changed = !existing
    || existing.agent !== input.agent
    || existing.state !== input.state
    || existing.title !== title
    || existing.projectPath !== projectPath;

  entries.set(shellId, {
    shellId,
    agent: input.agent,
    state: input.state,
    title,
    projectPath,
    updatedAt: changed
      ? (input.updatedAt ?? Date.now())
      : (existing?.updatedAt ?? input.updatedAt ?? Date.now()),
    focus: input.focus,
  });
  rebuildSnapshot();
  notify();
}

export function removeTerminalAgentOverview(shellId: string): void {
  if (!entries.delete(shellId)) return;
  rebuildSnapshot();
  notify();
}

export function clearTerminalAgentOverview(): void {
  if (entries.size === 0) return;
  entries.clear();
  rebuildSnapshot();
  notify();
}

export function getTerminalAgentOverviewSnapshot(): readonly TerminalAgentOverviewEntry[] {
  return snapshot;
}

export function subscribeTerminalAgentOverview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function nextTerminalAgentPanelMode(mode: TerminalAgentPanelMode): TerminalAgentPanelMode {
  if (mode === 'full') return 'compact';
  if (mode === 'compact') return 'hidden';
  return 'full';
}

export function isTerminalAgentPanelMode(value: unknown): value is TerminalAgentPanelMode {
  return value === 'full' || value === 'compact' || value === 'hidden';
}
