import {
  getGatewayProcessStatus,
  openGatewayControlUi,
  probeSelectedGateway,
  type GatewayProcessStatus,
} from '@/api/tauri-commands';

export interface GatewayControlUiResult {
  success: boolean;
  error?: string;
}

export interface GatewayControlUiDependencies {
  getStatus: () => Promise<GatewayProcessStatus>;
  probeReady: (port: number) => Promise<boolean>;
  open: () => Promise<void>;
}

const defaultDependencies: GatewayControlUiDependencies = {
  getStatus: getGatewayProcessStatus,
  probeReady: probeSelectedGateway,
  open: openGatewayControlUi,
};

/** Opens Control UI only after the selected runtime authenticates successfully. */
export async function openSelectedGatewayControlUi(
  dependencies: GatewayControlUiDependencies = defaultDependencies,
): Promise<GatewayControlUiResult> {
  try {
    const status = await dependencies.getStatus();
    if (!status.running || !await dependencies.probeReady(status.port)) {
      return { success: false, error: 'Gateway is not ready yet.' };
    }
    await dependencies.open();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}
