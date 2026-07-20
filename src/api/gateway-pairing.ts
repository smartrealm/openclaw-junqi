export interface GatewayPairingRequest {
  code: string;
  deviceId: string;
}

export interface GatewayPairingStatus {
  status: string;
  token?: string;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type GatewayStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface LegacyGatewayCredential {
  token: string;
  endpoint: string | null;
}

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

function parseObject(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseStoredString(raw: string | null): string {
  if (!raw) return '';
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed.trim() : raw.trim();
  } catch {
    return raw.trim();
  }
}

export function canonicalGatewayEndpoint(endpoint: string): string {
  const url = new URL(endpoint.trim());
  if (url.username || url.password) throw new Error('Gateway endpoint must not contain credentials');
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported Gateway protocol: ${url.protocol}`);
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

export function readLegacyGatewayEndpoint(storage: Pick<Storage, 'getItem'>): string | null {
  const config = parseObject(storage.getItem('aegis-config'));
  const configEndpoint = typeof config.gatewayUrl === 'string' ? config.gatewayUrl.trim() : '';
  const standaloneEndpoint = (storage.getItem('aegis-gateway-url') || '').trim();
  const settingsEndpoint = parseStoredString(storage.getItem('aegis-setting:gatewayUrl'));
  return configEndpoint || standaloneEndpoint || settingsEndpoint || null;
}

export function readLegacyGatewayCredential(storage: Pick<Storage, 'getItem'>): LegacyGatewayCredential | null {
  const config = parseObject(storage.getItem('aegis-config'));
  const configToken = typeof config.gatewayToken === 'string' ? config.gatewayToken.trim() : '';
  const standaloneToken = (storage.getItem('aegis-gateway-token') || '').trim();
  const settingsToken = parseStoredString(storage.getItem('aegis-setting:gatewayToken'));
  const token = configToken || standaloneToken || settingsToken;
  if (!token) return null;
  return { token, endpoint: readLegacyGatewayEndpoint(storage) };
}

export function removeLegacyGatewayCredentials(storage: GatewayStorage): void {
  const config = parseObject(storage.getItem('aegis-config'));
  if (Object.prototype.hasOwnProperty.call(config, 'gatewayToken')) {
    delete config.gatewayToken;
    storage.setItem('aegis-config', JSON.stringify(config));
  }
  storage.removeItem('aegis-gateway-token');
  storage.removeItem('aegis-setting:gatewayToken');
}

export function mergeDesktopGatewaySettings(
  update: Record<string, unknown>,
  storage: GatewayStorage,
): Record<string, unknown> {
  const current = parseObject(storage.getItem('aegis-config'));
  const next = { ...current, ...update };
  delete next.gatewayToken;
  storage.setItem('aegis-config', JSON.stringify(next));
  return next;
}
