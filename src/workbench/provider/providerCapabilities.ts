import { invoke } from '@tauri-apps/api/core';

export interface WorkbenchProviderCapability {
  providerId: string;
  label: string;
  available: boolean;
  binaryPath: string | null;
}

export function probeWorkbenchProviders(): Promise<WorkbenchProviderCapability[]> {
  return invoke<WorkbenchProviderCapability[]>('probe_workbench_providers');
}
