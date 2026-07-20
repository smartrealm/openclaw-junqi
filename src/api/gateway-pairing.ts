export interface GatewayPairingRequest {
  code: string;
  deviceId: string;
}

export interface GatewayPairingStatus {
  status: string;
  token?: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PAIRING_TIMEOUT_MS = 15_000;

function gatewayEndpoint(httpBaseUrl: string, path: string): string {
  const base = new URL(httpBaseUrl);
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error(`Unsupported Gateway protocol: ${base.protocol}`);
  }
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  base.pathname = `${basePath}${path.replace(/^\//, '')}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIRING_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Gateway pairing request failed: HTTP ${response.status} ${response.statusText}`.trim());
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function requestGatewayPairing(
  httpBaseUrl: string,
  platform: string,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayPairingRequest> {
  const payload = await fetchJson(fetchImpl, gatewayEndpoint(httpBaseUrl, '/v1/pair'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientId: 'openclaw-control-ui',
      clientName: 'JunQi Desktop',
      platform,
      scopes: ['operator.read', 'operator.write', 'operator.admin'],
    }),
  });
  const value = payload as Partial<GatewayPairingRequest> | null;
  if (!value || typeof value.code !== 'string' || !value.code.trim()
    || typeof value.deviceId !== 'string' || !value.deviceId.trim()) {
    throw new Error('Gateway returned an invalid pairing response');
  }
  return { code: value.code.trim(), deviceId: value.deviceId.trim() };
}

export async function pollGatewayPairing(
  httpBaseUrl: string,
  deviceId: string,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayPairingStatus> {
  if (!deviceId.trim()) throw new Error('Pairing device ID is required');
  const payload = await fetchJson(
    fetchImpl,
    gatewayEndpoint(httpBaseUrl, `/v1/pair/${encodeURIComponent(deviceId)}/status`),
  );
  const value = payload as Partial<GatewayPairingStatus> | null;
  if (!value || typeof value.status !== 'string' || !value.status.trim()) {
    throw new Error('Gateway returned an invalid pairing status');
  }
  return {
    status: value.status.trim(),
    ...(typeof value.token === 'string' && value.token.trim() ? { token: value.token.trim() } : {}),
  };
}

export function persistGatewayToken(token: string, storage: Pick<Storage, 'getItem' | 'setItem'>): void {
  const normalized = token.trim();
  if (!normalized) throw new Error('Gateway token cannot be empty');
  let current: Record<string, unknown> = {};
  const raw = storage.getItem('aegis-config');
  if (raw) {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed as Record<string, unknown>;
    }
  }
  storage.setItem('aegis-config', JSON.stringify({ ...current, gatewayToken: normalized }));
}
