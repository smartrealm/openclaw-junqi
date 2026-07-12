/**
 * Runtime ownership for a terminal tab while it crosses pane boundaries.
 *
 * The Rust PTY registry is already process-global. This registry identifies
 * the renderer instance that owns a given run so only the outgoing renderer
 * suppresses its normal `kill_shell` cleanup. The incoming renderer receives
 * the same run id and a serialized xterm snapshot, then subscribes to the
 * existing PTY instead of opening a replacement shell.
 */

interface PtyOwner {
  instanceId: string;
  runId: string;
}

interface PtyHandoff extends PtyOwner {
  snapshot: string | null;
}

const owners = new Map<string, PtyOwner>();
const handoffs = new Map<string, PtyHandoff>();
let instanceSequence = 0;

function normalizedSshHost(host: string | undefined): string | undefined {
  const value = host?.trim();
  return value || undefined;
}

/** A live PTY may only move between panes with the same remote ownership. */
export function terminalTransferMatchesRemote(
  sourceSshHost: string | undefined,
  targetSshHost: string | undefined,
): boolean {
  return normalizedSshHost(sourceSshHost) === normalizedSshHost(targetSshHost);
}

export function createTerminalRendererInstanceId(): string {
  instanceSequence += 1;
  return `terminal-renderer-${instanceSequence}`;
}

export function registerTerminalPtyOwner(shellId: string, runId: string, instanceId: string): void {
  if (!shellId || !runId || !instanceId) return;
  owners.set(shellId, { runId, instanceId });
}

export function unregisterTerminalPtyOwner(shellId: string, instanceId: string): void {
  if (owners.get(shellId)?.instanceId === instanceId) owners.delete(shellId);
}

/** Mark the current renderer as an outgoing owner before destination state is created. */
export function prepareTerminalPtyHandoff(shellId: string, runId: string): boolean {
  const owner = owners.get(shellId);
  if (!owner || owner.runId !== runId) return false;
  handoffs.set(shellId, { ...owner, snapshot: null });
  return true;
}

/**
 * Called during an outgoing renderer's unmount. Returns true only for the
 * exact renderer that initiated the handoff, preventing the target renderer
 * from accidentally keeping a PTY alive after an ordinary tab close.
 */
export function completeTerminalPtyHandoff(
  shellId: string,
  runId: string,
  instanceId: string,
  snapshot: string,
): boolean {
  const handoff = handoffs.get(shellId);
  if (
    !handoff
    || handoff.runId !== runId
    || handoff.instanceId !== instanceId
  ) return false;
  handoff.snapshot = snapshot;
  unregisterTerminalPtyOwner(shellId, instanceId);
  return true;
}

/** Abort a failed window launch without leaving a future tab close unkillable. */
export function cancelTerminalPtyHandoff(shellId: string, runId: string): void {
  const handoff = handoffs.get(shellId);
  if (handoff?.runId === runId) handoffs.delete(shellId);
}

/** Consume the source renderer's scrollback after the target subscribes. */
export function takeTerminalPtyHandoffSnapshot(shellId: string, runId: string): string | null {
  const handoff = handoffs.get(shellId);
  if (!handoff || handoff.runId !== runId || handoff.snapshot === null) return null;
  handoffs.delete(shellId);
  return handoff.snapshot;
}

/** Test-only reset for deterministic handoff ownership tests. */
export function clearTerminalPtyHandoffs(): void {
  owners.clear();
  handoffs.clear();
  instanceSequence = 0;
}
