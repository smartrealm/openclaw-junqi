import { invoke } from '@tauri-apps/api/core';
import { isWorkbenchSessionSnapshot, type WorkbenchSessionSnapshot } from './schema';

interface NativeLoadResult {
  found: boolean;
  recovered: boolean;
  generation: number;
  payloadHash: string | null;
  payload: unknown | null;
}

interface NativeSaveResult {
  generation: number;
  payloadHash: string;
  unchanged: boolean;
}

export interface LoadedWorkbenchSession {
  found: boolean;
  recovered: boolean;
  generation: number;
  payloadHash: string | null;
  snapshot: WorkbenchSessionSnapshot | null;
}

export async function loadWorkbenchSession(partitionId: string): Promise<LoadedWorkbenchSession> {
  const result = await invoke<NativeLoadResult>('load_workbench_session', { partitionId });
  if (!result.found) return { ...result, snapshot: null };
  if (!isWorkbenchSessionSnapshot(result.payload)) throw new Error('Workbench session payload failed schema validation');
  return { ...result, snapshot: result.payload };
}

export async function saveWorkbenchSession(
  partitionId: string,
  expectedGeneration: number,
  snapshot: WorkbenchSessionSnapshot,
): Promise<NativeSaveResult> {
  return invoke<NativeSaveResult>('save_workbench_session', {
    partitionId,
    expectedGeneration,
    payload: snapshot,
  });
}
