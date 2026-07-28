import { invoke } from '@tauri-apps/api/core';
import type { ProviderClaimRequest, ProviderSessionClaim } from '../domain/providerSession';

interface NativeProviderClaim extends Omit<ProviderSessionClaim, 'status'> {
  binaryPath: string;
}

export function claimWorkbenchProvider(request: ProviderClaimRequest): Promise<NativeProviderClaim> {
  return invoke<NativeProviderClaim>('claim_workbench_provider', { request });
}

export function releaseWorkbenchProvider(
  paneId: string,
  claimId: string,
  generation: number,
): Promise<boolean> {
  return invoke<boolean>('release_workbench_provider', { paneId, claimId, generation });
}
