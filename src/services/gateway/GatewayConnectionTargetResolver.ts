import {
  deleteLegacyGatewayCredential,
  detectGatewayConfig,
  getGatewayToken,
  getLegacyGatewayCredential,
  type GatewayConfigInfo,
} from '@/api/tauri-commands';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import {
  getGatewayDeviceCredentialForUrl,
  gatewayRuntimeKeyFromUrl,
  migrateLegacyGatewayCredential,
  resolveGatewayCredentialRuntimeKey,
  selectedGatewayRuntimeKey,
  storeGatewayDeviceCredential,
  type GatewayCredential,
} from './credentialProvider';
import type { ConnectionTarget } from './types';

export interface GatewayConnectionTargetRequest {
  preferredUrl?: string;
  tokenOverride?: string;
  useTokenOverride?: boolean;
  useSavedUrl?: boolean;
}

export interface GatewayConnectionTargetResolverDependencies {
  detectConfig: () => Promise<GatewayConfigInfo>;
  getToken: () => Promise<string>;
  migrateCredential: (runtimeKey: string) => Promise<GatewayCredential>;
  getDeviceCredential: (gatewayUrl: string) => Promise<GatewayCredential>;
  storeDeviceCredential: (runtimeKey: string, token: string) => Promise<GatewayCredential>;
  getLegacyCredential: (endpoint: string, scope: string) => Promise<string | null>;
  deleteLegacyCredential: (endpoint: string, scope: string) => Promise<void>;
  getSavedUrl: () => string;
}

const defaultDependencies: GatewayConnectionTargetResolverDependencies = {
  detectConfig: detectGatewayConfig,
  getToken: getGatewayToken,
  migrateCredential: migrateLegacyGatewayCredential,
  getDeviceCredential: getGatewayDeviceCredentialForUrl,
  storeDeviceCredential: storeGatewayDeviceCredential,
  getLegacyCredential: getLegacyGatewayCredential,
  deleteLegacyCredential: deleteLegacyGatewayCredential,
  getSavedUrl: readSavedGatewayUrl,
};

function normalizeUrl(value: string | undefined): string {
  return value?.trim() ?? '';
}

function endpointIdentity(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
    const host = ['localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase())
      ? '127.0.0.1'
      : url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'wss:' ? '443' : '80');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${host}:${port}${path}`;
  } catch {
    return null;
  }
}

export function gatewayEndpointsMatch(left: string, right: string): boolean {
  const normalizedLeft = endpointIdentity(left);
  return normalizedLeft !== null && normalizedLeft === endpointIdentity(right);
}

export function resolveGatewayConnectionCredentialRuntimeKey(
  gatewayUrl: string,
  configured: GatewayConfigInfo | null,
): string {
  const endpointKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
  const boundKey = resolveGatewayCredentialRuntimeKey(gatewayUrl);
  if (boundKey !== endpointKey) return boundKey;
  const sameSelectedRuntime = gatewayEndpointsMatch(gatewayUrl, configured?.ws_url ?? '');
  return sameSelectedRuntime && configured?.credential_scope
    ? selectedGatewayRuntimeKey(gatewayUrl, configured.credential_scope)
    : endpointKey;
}

function readSavedGatewayUrl(): string {
  try {
    const direct = localStorage.getItem('aegis-gateway-url')?.trim();
    if (direct) return direct;
    const legacy = JSON.parse(localStorage.getItem('aegis-config') || '{}');
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return '';
    const config = legacy as Record<string, unknown>;
    return typeof config.gatewayUrl === 'string'
      ? config.gatewayUrl.trim()
      : (typeof config.gatewayWsUrl === 'string' ? config.gatewayWsUrl.trim() : '');
  } catch {
    return '';
  }
}

async function deviceCredential(
  gatewayUrl: string,
  dependencies: GatewayConnectionTargetResolverDependencies,
  configured: GatewayConfigInfo | null,
): Promise<string> {
  const runtimeKey = resolveGatewayConnectionCredentialRuntimeKey(gatewayUrl, configured);
  let credential = await dependencies.migrateCredential(runtimeKey);
  if (!credential.token) credential = await dependencies.getDeviceCredential(gatewayUrl);
  if (!credential.token) {
    const scope = gatewayEndpointsMatch(gatewayUrl, configured?.ws_url ?? '')
      ? configured?.credential_scope || 'selected-runtime'
      : 'external-endpoint';
    const token = await dependencies.getLegacyCredential(gatewayUrl, scope).catch(() => null);
    if (token?.trim()) {
      credential = await dependencies.storeDeviceCredential(
        resolveGatewayCredentialRuntimeKey(gatewayUrl),
        token,
      );
      if (credential.persistence === 'system') {
        await dependencies.deleteLegacyCredential(gatewayUrl, scope).catch(() => {});
      }
    }
  }
  return credential.token ?? '';
}

/** Reads a migrated device credential without resolving or exposing a runtime bootstrap token. */
export async function getStoredGatewayCredentialToken(
  gatewayUrl: string,
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<string> {
  const configured = await dependencies.detectConfig().catch(() => null);
  return deviceCredential(gatewayUrl, dependencies, configured);
}

/**
 * Persists a rotated or newly paired device token in the credential scope
 * associated with its currently selected Gateway endpoint.
 */
export async function storeGatewayConnectionDeviceCredential(
  gatewayUrl: string,
  token: string,
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<GatewayCredential> {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('Gateway device credential must not be empty');
  const configured = await dependencies.detectConfig().catch(() => null);
  const runtimeKey = resolveGatewayConnectionCredentialRuntimeKey(gatewayUrl, configured);
  return dependencies.storeDeviceCredential(runtimeKey, normalizedToken);
}

/**
 * Resolves an endpoint and credentials without exposing compatibility config
 * objects to callers. Explicit credentials are scoped to the request; the
 * selected runtime token is never sent to a different manual endpoint.
 */
export async function resolveGatewayConnectionTarget(
  request: GatewayConnectionTargetRequest = {},
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<ConnectionTarget> {
  const configured = await dependencies.detectConfig().catch(() => null);
  const configuredUrl = normalizeUrl(configured?.ws_url);
  const savedUrl = request.useSavedUrl === false ? '' : normalizeUrl(dependencies.getSavedUrl());
  const explicitUrl = normalizeUrl(request.preferredUrl);
  const wsUrl = explicitUrl || savedUrl || configuredUrl || defaultGatewayWsUrl();
  const sameSelectedRuntime = Boolean(configuredUrl) && wsUrl === configuredUrl;
  const token = request.useTokenOverride
    ? (request.tokenOverride?.trim() ?? '')
    : sameSelectedRuntime
      ? await dependencies.getToken().catch(() => configured?.token ?? '')
      : '';
  const deviceToken = request.useTokenOverride
    ? ''
    : await deviceCredential(wsUrl, dependencies, configured);
  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');

  return { wsUrl, token, deviceToken, httpUrl };
}
