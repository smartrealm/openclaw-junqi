// ═══════════════════════════════════════════════════════════
// GatewayActionExecutor — performs side effects for state actions.
// Resolves connection target, starts gateway, establishes WebSocket.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import { startDockerGateway } from '@/api/tauri-commands';
import type { ConnectionTarget } from './types';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';

const DEFAULT_URL = defaultGatewayWsUrl();

/** Resolve the WebSocket URL and token from config + user settings. */
export async function resolveConnectionTarget(): Promise<ConnectionTarget> {
  let wsUrl = DEFAULT_URL;
  let token = '';

  if (window.aegis?.config) {
    try {
      const config = await window.aegis.config.get();
      wsUrl = config.gatewayUrl || config.gatewayWsUrl || DEFAULT_URL;
      token = config.gatewayToken || '';
    } catch {}
  }

  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  return { wsUrl, token, httpUrl };
}

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
  gateway.connect(target.wsUrl, target.token);
}

/** Execute a START action: call gateway.start() via Tauri. */
export async function executeStart(): Promise<{ success: boolean; error?: string; port?: number; token?: string | null }> {
  if (!window.aegis?.gateway?.start) {
    return { success: false, error: 'Gateway start not available' };
  }
  try {
    const result = await window.aegis.gateway.start();
    return result;
  } catch (e: any) {
    return { success: false, error: String(e?.message ?? e) };
  }
}

export async function executeDockerStart(): Promise<{
  success: boolean;
  error?: string;
  port?: number;
  token?: string | null;
}> {
  try {
    const result = await startDockerGateway();
    return { ...result, success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
