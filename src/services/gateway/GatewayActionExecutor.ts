// ═══════════════════════════════════════════════════════════
// GatewayActionExecutor — performs side effects for state actions.
// Resolves connection target, starts gateway, establishes WebSocket.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import {
  startDockerGateway,
  startGateway,
} from '@/api/tauri-commands';
import type { GatewayStartResult } from './types';
import { resolveGatewayConnectionTarget as resolveConnectionTarget } from './GatewayConnectionTargetResolver';

export { resolveConnectionTarget };

/** Execute a CONNECT action: resolve target + open WebSocket. */
export async function executeConnect(
  onHttpUrl: (url: string) => void,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const wsStatus = gateway.getStatus();
  if (wsStatus.connected || wsStatus.connecting) return;

  const target = await resolveConnectionTarget();
  if (!isCurrent()) return;
  onHttpUrl(target.httpUrl);
  localStorage.setItem('aegis-gateway-http', target.httpUrl);

  if (!isCurrent()) return;
  gateway.connect(target.wsUrl, target.token, target.deviceToken);
}

/** Execute a START action against the currently selected OpenClaw runtime. */
export async function executeStart(): Promise<GatewayStartResult> {
  try {
    const result = await startGateway();
    return { ...result, success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
export async function executeDockerStart(): Promise<GatewayStartResult> {
  try {
    const result = await startDockerGateway();
    return { ...result, success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
