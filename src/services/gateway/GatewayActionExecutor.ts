// ═══════════════════════════════════════════════════════════
// GatewayActionExecutor — performs side effects for state actions.
// Resolves connection target, starts gateway, establishes WebSocket.
// ═══════════════════════════════════════════════════════════

import { gateway } from './index';
import type { ConnectionTarget } from './types';

const DEFAULT_URL = 'ws://127.0.0.1:18789';

/** Resolve the WebSocket URL and token from config + user settings. */
export async function resolveConnectionTarget(): Promise<ConnectionTarget> {
  const userUrl = (getSettings().gatewayUrl || '').trim();
  const userToken = (getSettings().gatewayToken || '').trim();

  let wsUrl = userUrl || DEFAULT_URL;
  let token = userToken;

  if (window.aegis?.config) {
    try {
      const config = await window.aegis.config.get();
      const configUrl = config.gatewayUrl || config.gatewayWsUrl || DEFAULT_URL;
      wsUrl = userUrl || configUrl;
      token = userToken || config.gatewayToken || '';
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
export async function executeStart(): Promise<{ success: boolean; error?: string }> {
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

// ── Helpers ──
function getSettings(): { gatewayUrl?: string; gatewayToken?: string } {
  try {
    const raw = localStorage.getItem('aegis-config');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
