import { invoke } from '@tauri-apps/api/core';
import {
  isTerminalAgentId,
  type TerminalAgentId,
} from './terminalAgentCatalog';

export type TerminalAgentAvailabilityStatus = 'idle' | 'loading' | 'ready';

export interface TerminalAgentAvailabilitySnapshot {
  status: TerminalAgentAvailabilityStatus;
  agents: readonly TerminalAgentId[];
}

interface DetectedCliTool {
  id: string;
}

const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
let snapshot: TerminalAgentAvailabilitySnapshot = Object.freeze({
  status: 'idle',
  agents: Object.freeze([]),
});

function publish(next: TerminalAgentAvailabilitySnapshot): void {
  snapshot = Object.freeze(next);
  for (const listener of listeners) listener();
}

/**
 * One app-wide PATH scan shared by every terminal pane and the command
 * palette. A missing binary remains absent from the UI rather than becoming a
 * synthetic launch target.
 */
export function ensureTerminalAgentAvailability(): Promise<void> {
  if (snapshot.status === 'ready') return Promise.resolve();
  if (pending) return pending;

  publish({ status: 'loading', agents: snapshot.agents });
  pending = invoke<DetectedCliTool[]>('detect_cli_tools')
    .then((tools) => {
      const agents = Object.freeze(
        (tools ?? [])
          .map((tool) => tool.id)
          .filter(isTerminalAgentId),
      );
      publish({ status: 'ready', agents });
    })
    .catch(() => {
      // Terminal shells remain usable when CLI discovery is unavailable.
      publish({ status: 'ready', agents: Object.freeze([]) });
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function getTerminalAgentAvailabilitySnapshot(): TerminalAgentAvailabilitySnapshot {
  return snapshot;
}

export function subscribeTerminalAgentAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
