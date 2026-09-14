import {
  detectGatewayConfig,
  getGatewayToken,
  type GatewayConfigInfo,
} from '@/api/tauri-commands';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import {
  deleteGatewayDeviceCredential,
  getGatewayDeviceCredential,
  gatewayRuntimeKeyFromUrl,
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
  targetScope?: 'selected-runtime';
  preferStoredDeviceCredential?: boolean;
}

export interface GatewayConnectionTargetResolverDependencies {
  detectConfig: () => Promise<GatewayConfigInfo>;
  getToken: () => Promise<string>;
  getDeviceCredential: (runtimeKey: string) => Promise<GatewayCredential>;
  storeDeviceCredential: (runtimeKey: string, token: string) => Promise<GatewayCredential>;
  deleteDeviceCredential: (runtimeKey: string) => Promise<GatewayCredential>;
  getSavedUrl: () => string;
}

const defaultDependencies: GatewayConnectionTargetResolverDependencies = {
  detectConfig: detectGatewayConfig,
  getToken: getGatewayToken,
  getDeviceCredential: getGatewayDeviceCredential,
  storeDeviceCredential: storeGatewayDeviceCredential,
  deleteDeviceCredential: deleteGatewayDeviceCredential,
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
    return localStorage.getItem('aegis-gateway-url')?.trim() ?? '';
  } catch {
    return '';
  }
}

async function deviceCredential(
  gatewayUrl: string,
  configured: GatewayConfigInfo | null,
  dependencies: GatewayConnectionTargetResolverDependencies,
): Promise<string> {
  const runtimeKey = resolveGatewayConnectionCredentialRuntimeKey(gatewayUrl, configured);
  const credential = await dependencies.getDeviceCredential(runtimeKey);
  return credential.token?.trim() ?? '';
}

/** 读取设备凭据，不解析或暴露运行时启动令牌。 */
export async function getStoredGatewayCredentialToken(
  gatewayUrl: string,
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<string> {
  const configured = await dependencies.detectConfig().catch(() => null);
  return deviceCredential(gatewayUrl, configured, dependencies);
}

/** 将轮换或新配对的设备令牌写入当前 Gateway 端点绑定的凭据作用域。 */
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

/** 删除当前端点绑定的失效设备令牌，不触碰其他 Runtime 的凭据。 */
export async function deleteGatewayConnectionDeviceCredential(
  gatewayUrl: string,
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<GatewayCredential> {
  const configured = await dependencies.detectConfig().catch(() => null);
  const runtimeKey = resolveGatewayConnectionCredentialRuntimeKey(gatewayUrl, configured);
  return dependencies.deleteDeviceCredential(runtimeKey);
}

/** 仅为同一已选 Runtime 的设备令牌恢复读取共享认证凭据。 */
export async function resolveGatewayConnectionSharedCredentialRecovery(
  gatewayUrl: string,
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<string> {
  const configured = await dependencies.detectConfig();
  if (!gatewayEndpointsMatch(gatewayUrl, configured.ws_url)) {
    throw new Error('Gateway device credential recovery is not bound to the selected Runtime');
  }
  const token = (await dependencies.getToken()).trim();
  if (!token) throw new Error('Selected OpenClaw Runtime did not provide a recovery credential');
  return token;
}

/**
 * 在不向调用方暴露配置对象的前提下解析端点与凭据。
 * 显式凭据只作用于当前请求，所选运行时令牌不能发送到其他手动端点。
 */
export async function resolveGatewayConnectionTarget(
  request: GatewayConnectionTargetRequest = {},
  dependencies: GatewayConnectionTargetResolverDependencies = defaultDependencies,
): Promise<ConnectionTarget> {
  const configured = request.targetScope === 'selected-runtime'
    ? await dependencies.detectConfig()
    : await dependencies.detectConfig().catch(() => null);
  const configuredUrl = normalizeUrl(configured?.ws_url);
  if (request.targetScope === 'selected-runtime' && !configuredUrl) {
    throw new Error('Selected OpenClaw Runtime did not provide a Gateway WebSocket URL');
  }
  const savedUrl = request.targetScope === 'selected-runtime' || request.useSavedUrl === false
    ? ''
    : normalizeUrl(dependencies.getSavedUrl());
  const explicitUrl = request.targetScope === 'selected-runtime'
    ? ''
    : normalizeUrl(request.preferredUrl);
  const wsUrl = explicitUrl || savedUrl || configuredUrl || defaultGatewayWsUrl();
  const sameSelectedRuntime = Boolean(configuredUrl) && gatewayEndpointsMatch(wsUrl, configuredUrl);
  const shouldReadStoredDeviceCredential = !request.useTokenOverride
    && (
      request.targetScope !== 'selected-runtime'
      || request.preferStoredDeviceCredential === true
    );
  const storedDeviceToken = shouldReadStoredDeviceCredential
    ? await deviceCredential(wsUrl, configured, dependencies)
    : '';
  const token = request.useTokenOverride
    ? (request.tokenOverride?.trim() ?? '')
    : storedDeviceToken
      ? ''
    : sameSelectedRuntime
      ? request.targetScope === 'selected-runtime'
        ? await dependencies.getToken()
        : await dependencies.getToken().catch(() => configured?.token ?? '')
      : '';
  // 首次设置仍以所选运行时凭据建立信任；已完成配对的所选运行时重连则恢复设备权限，
  // 避免进程恢复或插件安装重启后退回共享令牌并再次触发授权。
  const deviceToken = storedDeviceToken;
  const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');

  return { wsUrl, token, deviceToken, httpUrl };
}
