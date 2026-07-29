import {
  checkDocker,
  checkOpenclaw,
  detectGatewayConfig,
  type DockerStatus,
  type GatewayConfigInfo,
  type OpenclawStatus,
} from '@/api/tauri-commands';

export interface SetupInstallationHealthDependencies {
  detectRuntime: () => Promise<Pick<GatewayConfigInfo, 'runtime_mode'>>;
  checkNativeOpenclaw: () => Promise<OpenclawStatus>;
  checkDockerRuntime: () => Promise<DockerStatus>;
}

const defaultDependencies: SetupInstallationHealthDependencies = {
  detectRuntime: detectGatewayConfig,
  checkNativeOpenclaw: checkOpenclaw,
  checkDockerRuntime: checkDocker,
};

/**
 * Validate the durable installation contract without requiring Gateway to be
 * online. Process readiness belongs to the normal cold-start recovery flow.
 */
export async function validateCachedSetupInstallation(
  dependencies: SetupInstallationHealthDependencies = defaultDependencies,
): Promise<boolean> {
  const runtime = await dependencies.detectRuntime();
  if (runtime.runtime_mode === 'docker') {
    const docker = await dependencies.checkDockerRuntime();
    if (!docker.available || docker.unsupported_reason) return false;

    // A stopped daemon is process readiness and can recover during cold start.
    // When the daemon is available, however, a missing image is a durable setup
    // gap that must return to setup so the image can be pulled again.
    return !docker.daemon_running || docker.image_available;
  }

  const openclaw = await dependencies.checkNativeOpenclaw();
  return openclaw.installed && !openclaw.relocation_required;
}
