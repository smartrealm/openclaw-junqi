import type { InstallMode } from '@/stores/setup-navigation';
import type { InstallTargetTier } from './types';

export interface SetupUpdateCheckResult {
  state: 'pending' | 'ready' | 'error';
  available: boolean | null;
  managedChannelPolicy: 'eligible' | 'unsupported' | 'unknown' | null;
}

export function shouldVisitOpenClawUpdateStep(
  installMode: InstallMode,
  installTargetTier: InstallTargetTier | null,
): boolean {
  return installMode === 'native' && installTargetTier === 'existing';
}

export function gatewayReadyPrimaryActionKind(
  installMode: InstallMode,
  installTargetTier: InstallTargetTier | null,
): 'next' | 'verify-configuration' {
  return shouldVisitOpenClawUpdateStep(installMode, installTargetTier)
    ? 'next'
    : 'verify-configuration';
}

interface OpenClawUpdateContinuationGate {
  checkResult: SetupUpdateCheckResult;
}

export function isOpenClawUpdateContinuationDisabled({
  checkResult,
}: OpenClawUpdateContinuationGate): boolean {
  return checkResult.state !== 'ready'
    || checkResult.managedChannelPolicy !== 'eligible';
}

export function wizardFailureDestination(
  surfaceFailureOnConfigurationPage: boolean,
): 'configure-openclaw' | null {
  return surfaceFailureOnConfigurationPage ? 'configure-openclaw' : null;
}
