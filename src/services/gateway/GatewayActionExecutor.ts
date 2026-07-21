// ═══════════════════════════════════════════════════════════
// GatewayActionExecutor — performs side effects for state actions.
// Resolves connection target, starts gateway, establishes WebSocket.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import { startDockerGateway } from '@/api/tauri-commands';
import type { ConnectionTarget } from './types';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import {
  getGatewayDeviceCredentialForUrl,
  migrateLegacyGatewayCredential,
  resolveGatewayCredentialRuntimeKey,
} from './credentialProvider';

const DEFAULT_URL = defaultGatewayWsUrl();

/** Resolve the WebSocket URL and token from config + user settings. */
export async function resolveConnectionTarget(): Promise<ConnectionTarget> {
  const userUrl = getGatewayUrlSetting();

  let wsUrl = userUrl || DEFAULT_URL;
  let bootstrapToken = '';
  let configuredDeviceToken = '';

  if (window.aegis?.config) {
    try {
      const config = await window.aegis.config.get();
      const configUrl = config.gatewayUrl || config.gatewayWsUrl || DEFAULT_URL;
      wsUrl = userUrl || configUrl;
      // New desktop adapters expose the shared config token separately. The
      // gatewayToken fallback keeps older preload/test adapters compatible.
      bootstrapToken = typeof config.gatewayBootstrapToken === 'string'
        ? config.gatewayBootstrapToken
        : (config.gatewayToken || '');
      configuredDeviceToken = config.gatewayDeviceToken || '';
    } catch {}
  }

  const runtimeKey = resolveGatewayCredentialRuntimeKey(wsUrl);
  let credential = await migrateLegacyGatewayCredential(runtimeKey);
  if (!credential.token) {
    credential = await getGatewayDeviceCredentialForUrl(wsUrl);
  }
  const deviceToken = credential.token || configuredDeviceToken;

  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  return { wsUrl, token: bootstrapToken, deviceToken, httpUrl };
}

function getGatewayUrlSetting(): string {
  try {
    const direct = localStorage.getItem('aegis-gateway-url')?.trim();
    if (direct) return direct;
    const config = JSON.parse(localStorage.getItem('aegis-config') || '{}');
    return typeof config.gatewayUrl === 'string'
      ? config.gatewayUrl.trim()
      : (typeof config.gatewayWsUrl === 'string' ? config.gatewayWsUrl.trim() : '');
  } catch {
    return '';
  }
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
  gateway.connect(target.wsUrl, target.token, target.deviceToken);
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
