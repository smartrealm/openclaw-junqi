// Gateway auth accessor — single place that resolves the HTTP base URL and
// pairing token for the local OpenClaw gateway. The HTTP history endpoint
// (`/sessions/:sessionKey/history`) shares the same shared-secret token as
// the WebSocket transport, so the same connection provides both.
//
// Returns null when the gateway is not yet configured (pre-pairing). Callers
// should treat that as "history pagination unavailable" and bail gracefully.
import { gateway } from '@/services/gateway';

export interface GatewayAuth {
  /** HTTP base URL derived from the WebSocket URL — e.g. `http://127.0.0.1:18789`. */
  baseUrl: string;
  /** Pairing/shared-secret token. Empty before pairing completes. */
  token: string;
}

/** Resolve current gateway HTTP base URL + token. Null if gateway isn't set up. */
export function getGatewayAuth(): GatewayAuth | null {
  const baseUrl = gateway.getHttpBaseUrl();
  const token = gateway.getToken();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
}
