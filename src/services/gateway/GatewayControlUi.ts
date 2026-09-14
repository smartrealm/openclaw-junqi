import {
  getGatewayProcessStatus,
  openGatewayControlUi,
  probeSelectedGateway,
  type GatewayProcessStatus,
  type OpenClawControlUiRoute,
} from '@/api/tauri-commands';

export interface GatewayControlUiResult {
  success: boolean;
  error?: string;
}

export interface GatewayControlUiDependencies {
  getStatus: () => Promise<GatewayProcessStatus>;
  probeReady: (port: number) => Promise<boolean>;
  open: (route?: OpenClawControlUiRoute) => Promise<void>;
}

const defaultDependencies: GatewayControlUiDependencies = {
  getStatus: getGatewayProcessStatus,
  probeReady: probeSelectedGateway,
  open: openGatewayControlUi,
};

/** Opens Control UI only after the selected runtime authenticates successfully. */
async function openSelectedGatewayControlUiRoute(
  route: OpenClawControlUiRoute | undefined,
  dependencies: GatewayControlUiDependencies,
): Promise<GatewayControlUiResult> {
  try {
    const status = await dependencies.getStatus();
    if (!status.running || !await dependencies.probeReady(status.port)) {
      return { success: false, error: 'Gateway is not ready yet.' };
    }
    await dependencies.open(route);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function openSelectedGatewayControlUi(
  dependencies: GatewayControlUiDependencies = defaultDependencies,
): Promise<GatewayControlUiResult> {
  return openSelectedGatewayControlUiRoute(undefined, dependencies);
}

export function openSelectedGatewayDevicesUi(
  dependencies: GatewayControlUiDependencies = defaultDependencies,
): Promise<GatewayControlUiResult> {
  return openSelectedGatewayControlUiRoute('devices', dependencies);
}
