import {
  checkOpenclaw,
  detectGatewayConfig,
  type GatewayConfigInfo,
  type OpenclawStatus,
} from '@/api/tauri-commands';

export interface SetupInstallationHealthDependencies {
  detectRuntime: () => Promise<Pick<GatewayConfigInfo, 'runtime_mode'>>;
  checkNativeOpenclaw: () => Promise<OpenclawStatus>;
}

const defaultDependencies: SetupInstallationHealthDependencies = {
  detectRuntime: detectGatewayConfig,
  checkNativeOpenclaw: checkOpenclaw,
};

/**
 * Validate the durable installation contract without requiring Gateway to be
 * online. Process readiness belongs to the normal cold-start recovery flow.
 */
export async function validateCachedSetupInstallation(
  dependencies: SetupInstallationHealthDependencies = defaultDependencies,
): Promise<boolean> {
  const runtime = await dependencies.detectRuntime();
  if (runtime.runtime_mode === 'docker') return true;

  const openclaw = await dependencies.checkNativeOpenclaw();
  return openclaw.installed && !openclaw.relocation_required;
}
