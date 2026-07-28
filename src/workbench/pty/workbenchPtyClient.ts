import { invoke } from '@tauri-apps/api/core';
import { subscribeTauriEvent } from '@/utils/tauriEvents';

export interface WorkbenchPtyIdentity {
  ptyId: string;
  runId: string;
}

export interface WorkbenchPtyOutput extends WorkbenchPtyIdentity {
  sequence: number;
  data: string;
}

export interface WorkbenchPtySnapshot extends WorkbenchPtyIdentity {
  sequence: number;
  data: string;
  truncated: boolean;
}

export interface WorkbenchPtyCreateResult extends WorkbenchPtyIdentity {
  cwd: string;
  created: boolean;
}

export interface WorkbenchPtySubscription {
  synchronize(sequence: number): void;
  dispose(): void;
}

export async function createWorkbenchPty(
  identity: WorkbenchPtyIdentity,
  cwd: string,
  cols = 120,
  rows = 24,
): Promise<WorkbenchPtyCreateResult> {
  return invoke('create_workbench_pty', { ...identity, cwd, cols, rows });
}

export function inputWorkbenchPty(identity: WorkbenchPtyIdentity, data: string): Promise<void> {
  return invoke('input_workbench_pty', { ...identity, data });
}

export function resizeWorkbenchPty(identity: WorkbenchPtyIdentity, cols: number, rows: number): Promise<void> {
  return invoke('resize_workbench_pty', { ...identity, cols, rows });
}

export function snapshotWorkbenchPty(identity: WorkbenchPtyIdentity): Promise<WorkbenchPtySnapshot> {
  return invoke('snapshot_workbench_pty', { ptyId: identity.ptyId, runId: identity.runId });
}

export function stopWorkbenchPty(identity: WorkbenchPtyIdentity): Promise<void> {
  return invoke('stop_workbench_pty', { ptyId: identity.ptyId, runId: identity.runId });
}

export async function subscribeWorkbenchPty(
  identity: WorkbenchPtyIdentity,
  onOutput: (output: WorkbenchPtyOutput) => void,
  onGap: (expected: number, received: number) => void,
  onExit: () => void,
  initialSequence = 0,
): Promise<WorkbenchPtySubscription> {
  let sequence = initialSequence;
  let disposed = false;
  const outputUnlisten = subscribeTauriEvent<WorkbenchPtyOutput>('workbench-pty-output', (event) => {
    const output = event.payload;
    if (disposed || output.ptyId !== identity.ptyId || output.runId !== identity.runId) return;
    if (output.sequence <= sequence) return;
    if (output.sequence !== sequence + 1) onGap(sequence + 1, output.sequence);
    sequence = output.sequence;
    onOutput(output);
  });
  const exitUnlisten = subscribeTauriEvent<WorkbenchPtyIdentity>('workbench-pty-exit', (event) => {
    if (disposed || event.payload.ptyId !== identity.ptyId || event.payload.runId !== identity.runId) return;
    onExit();
  });
  return {
    synchronize(nextSequence) {
      if (!disposed && nextSequence > sequence) sequence = nextSequence;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      outputUnlisten();
      exitUnlisten();
    },
  };
}
