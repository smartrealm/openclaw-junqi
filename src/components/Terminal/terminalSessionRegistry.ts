import type { TerminalAgentId } from './terminalAgentCatalog';
import type { ShellRuntimeState } from './shellLifecycle';

/** Live terminal tabs for Kooky-style command-palette navigation. */
export interface TerminalSessionOverviewEntry {
  shellId: string;
  paneId: string;
  workspaceId?: string;
  title: string;
  projectPath: string;
  agent?: TerminalAgentId;
  /** Present only for a PTY actually spawned through the SSH workspace path. */
  remoteHost?: string;
  runtimeState?: ShellRuntimeState;
  updatedAt: number;
  focus: () => void;
}

export type TerminalSessionOverviewInput = Omit<TerminalSessionOverviewEntry, 'updatedAt'> & {
  updatedAt?: number;
};

const entries = new Map<string, TerminalSessionOverviewEntry>();
const listeners = new Set<() => void>();
let snapshot: readonly TerminalSessionOverviewEntry[] = [];

function rebuildSnapshot(): void {
  snapshot = Object.freeze(
    [...entries.values()].sort((left, right) => (
      right.updatedAt - left.updatedAt || left.title.localeCompare(right.title)
    )),
  );
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function upsertTerminalSessionOverview(input: TerminalSessionOverviewInput): void {
  const shellId = input.shellId.trim();
  if (!shellId) return;

  const existing = entries.get(shellId);
  const title = input.title.trim() || 'Terminal';
  const projectPath = input.projectPath.trim();
  const changed = !existing
    || existing.paneId !== input.paneId
    || existing.workspaceId !== input.workspaceId
    || existing.title !== title
    || existing.projectPath !== projectPath
    || existing.agent !== input.agent
    || existing.remoteHost !== input.remoteHost
    || existing.runtimeState !== input.runtimeState;

  entries.set(shellId, {
    shellId,
    paneId: input.paneId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    title,
    projectPath,
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.remoteHost ? { remoteHost: input.remoteHost } : {}),
    ...(input.runtimeState ? { runtimeState: input.runtimeState } : {}),
    updatedAt: changed
      ? (input.updatedAt ?? Date.now())
      : (existing?.updatedAt ?? input.updatedAt ?? Date.now()),
    focus: input.focus,
  });
  rebuildSnapshot();
  notify();
}

export function removeTerminalSessionOverview(shellId: string): void {
  if (!entries.delete(shellId)) return;
  rebuildSnapshot();
  notify();
}

export function clearTerminalSessionOverview(): void {
  if (entries.size === 0) return;
  entries.clear();
  rebuildSnapshot();
  notify();
}

export function getTerminalSessionOverviewSnapshot(): readonly TerminalSessionOverviewEntry[] {
  return snapshot;
}

export function subscribeTerminalSessionOverview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
