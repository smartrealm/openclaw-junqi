import {
  deleteGatewayCredential as deleteGatewayCredentialCommand,
  getGatewayCredential as getGatewayCredentialCommand,
  storeGatewayCredential as storeGatewayCredentialCommand,
  type GatewayCredentialKeyParams,
  type GatewayCredentialPersistence,
  type GatewayCredentialResult,
  type StoreGatewayCredentialParams,
} from '@/api/tauri-commands';
import { defaultGatewayWsUrl } from '@/config/runtimeDefaults';
import { getGatewayDeviceIdentityReference } from './deviceAuthentication';

export const GATEWAY_RUNTIME_ALIAS_KEY = 'aegis-gateway-runtime-aliases-v1';

const DEFAULT_GATEWAY_URL = defaultGatewayWsUrl();
const MAX_RUNTIME_ALIASES = 64;

export interface GatewayCredential {
  runtimeKey: string;
  token: string | null;
  persistence: GatewayCredentialPersistence;
  migrated: boolean;
}

export interface GatewayCredentialBackend {
  get(params: GatewayCredentialKeyParams): Promise<GatewayCredentialResult>;
  store(params: StoreGatewayCredentialParams): Promise<GatewayCredentialResult>;
  delete(params: GatewayCredentialKeyParams): Promise<GatewayCredentialResult>;
}

interface ProviderOptions {
  backend?: GatewayCredentialBackend;
  resolveDeviceId?: () => Promise<string>;
}

interface RuntimeBindingOptions extends ProviderOptions {
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: () => number;
  /** Additional pre-attestation slots, such as selected runtime/config scope. */
  sourceRuntimeKeys?: string[];
  /** Connection identity fence checked before every irreversible transition. */
  isCurrent?: () => boolean;
}

interface RuntimeAliasRecord {
  endpointRuntimeKey: string;
  collaborationInstanceId: string;
  boundAtMs: number;
}

interface RuntimeAliasStore {
  version: 1;
  aliases: RuntimeAliasRecord[];
}

export interface GatewayCredentialRuntimeBinding {
  endpointRuntimeKey: string;
  previousRuntimeKey: string;
  instanceRuntimeKey: string;
  credential: GatewayCredential;
  cleanedRuntimeKeys: string[];
  cleanupComplete: boolean;
}

const defaultBackend: GatewayCredentialBackend = {
  get: getGatewayCredentialCommand,
  store: storeGatewayCredentialCommand,
  delete: deleteGatewayCredentialCommand,
};

const sessionCredentials = new Map<string, GatewayCredential>();
const runtimeSessionCredentials = new Map<string, GatewayCredential>();
const credentialLookupsInFlight = new Map<string, Promise<GatewayCredential>>();
function normalizeRuntimeKey(runtimeKey: string): string {
  const value = runtimeKey.trim();
  if (!value) throw new Error('runtimeKey must not be empty');
  return value;
}

function normalizeCollaborationInstanceId(collaborationInstanceId: string): string {
  const value = collaborationInstanceId.trim();
  if (!value) throw new Error('collaborationInstanceId must not be empty');
  if (value.length > 512 || [...value].some((character) => /[\u0000-\u001f\u007f]/.test(character))) {
    throw new Error('collaborationInstanceId is invalid');
  }
  return value;
}

function credentialMapKey(runtimeKey: string, deviceId: string): string {
  return `${runtimeKey}\0${deviceId}`;
}

async function deviceId(options: ProviderOptions): Promise<string> {
  const value = options.resolveDeviceId
    ? await options.resolveDeviceId()
    : (await getGatewayDeviceIdentityReference()).deviceId;
  if (!value.trim()) throw new Error('deviceId must not be empty');
  return value.trim();
}

function asCredential(result: GatewayCredentialResult): GatewayCredential {
  return {
    runtimeKey: result.runtimeKey,
    token: result.token,
    persistence: result.persistence,
    migrated: result.migrated,
  };
}

/**
 * Stable pre-attestation runtime key. Once a collaborationInstanceId is known,
 * callers can pass that durable id directly to the same provider APIs.
 */
export function gatewayRuntimeKeyFromUrl(rawUrl: string): string {
  const input = rawUrl.trim() || DEFAULT_GATEWAY_URL;
  try {
    const url = new URL(input);
    if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname) {
      throw new Error('invalid gateway URL');
    }
    // Authentication belongs in the credential provider, never in its key.
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    if (!url.pathname) url.pathname = '/';
    return `endpoint:${url.toString()}`;
  } catch {
    // Keep malformed/manual endpoints isolated without trying to repair them.
    return `endpoint:${input.replace(/\/\/[^/@]+@/, '//')}`;
  }
}

export function collaborationInstanceRuntimeKey(collaborationInstanceId: string): string {
  return `instance:${normalizeCollaborationInstanceId(collaborationInstanceId)}`;
}

/**
 * Pre-attestation key for JunQi's selected runtime. Native and Docker commonly
 * publish the same loopback URL, so URL alone is not a credential boundary.
 */
export function selectedGatewayRuntimeKey(gatewayUrl: string, credentialScope: string): string {
  const scope = normalizeRuntimeKey(credentialScope);
  return `selected:${scope}\0${gatewayRuntimeKeyFromUrl(gatewayUrl)}`;
}

function isRuntimeAliasRecord(value: unknown): value is RuntimeAliasRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.endpointRuntimeKey === 'string'
    && record.endpointRuntimeKey.startsWith('endpoint:')
    && typeof record.collaborationInstanceId === 'string'
    && record.collaborationInstanceId.trim().length > 0
    && record.collaborationInstanceId.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(record.collaborationInstanceId)
    && typeof record.boundAtMs === 'number'
    && Number.isFinite(record.boundAtMs);
}

function readRuntimeAliases(storage: Pick<Storage, 'getItem'>): RuntimeAliasStore {
  try {
    const parsed = JSON.parse(storage.getItem(GATEWAY_RUNTIME_ALIAS_KEY) || 'null');
    if (parsed?.version !== 1 || !Array.isArray(parsed.aliases)) {
      return { version: 1, aliases: [] };
    }
    return {
      version: 1,
      aliases: parsed.aliases.filter(isRuntimeAliasRecord).slice(-MAX_RUNTIME_ALIASES),
    };
  } catch {
    return { version: 1, aliases: [] };
  }
}

function aliasForEndpoint(
  endpointRuntimeKey: string,
  storage: Pick<Storage, 'getItem'>,
): RuntimeAliasRecord | null {
  const aliases = readRuntimeAliases(storage).aliases;
  for (let index = aliases.length - 1; index >= 0; index -= 1) {
    if (aliases[index].endpointRuntimeKey === endpointRuntimeKey) return aliases[index];
  }
  return null;
}

/** Resolve the durable instance key before opening a Gateway connection. */
export function resolveGatewayCredentialRuntimeKey(
  gatewayUrl: string,
  storage: Pick<Storage, 'getItem'> = localStorage,
): string {
  const endpointRuntimeKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
  const alias = aliasForEndpoint(endpointRuntimeKey, storage);
  return alias
    ? collaborationInstanceRuntimeKey(alias.collaborationInstanceId)
    : endpointRuntimeKey;
}

function persistRuntimeAlias(
  endpointRuntimeKey: string,
  collaborationInstanceId: string,
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now: () => number,
): void {
  const current = readRuntimeAliases(storage).aliases
    .filter((alias) => alias.endpointRuntimeKey !== endpointRuntimeKey);
  const next: RuntimeAliasStore = {
    version: 1,
    aliases: [...current, {
      endpointRuntimeKey,
      collaborationInstanceId,
      boundAtMs: now(),
    }].slice(-MAX_RUNTIME_ALIASES),
  };
  storage.setItem(GATEWAY_RUNTIME_ALIAS_KEY, JSON.stringify(next));
  const persisted = aliasForEndpoint(endpointRuntimeKey, storage);
  if (persisted?.collaborationInstanceId !== collaborationInstanceId) {
    throw new Error('Gateway runtime alias could not be verified');
  }
}

/**
 * Promote an endpoint-scoped paired token to the durable collaboration
 * instance. The operation is intentionally ordered so every failure leaves at
 * least one usable credential: write target, persist alias, then delete source.
 */
export async function bindGatewayCredentialToInstance(
  gatewayUrl: string,
  collaborationInstanceId: string,
  options: RuntimeBindingOptions = {},
): Promise<GatewayCredentialRuntimeBinding> {
  const storage = options.storage ?? localStorage;
  const instanceId = normalizeCollaborationInstanceId(collaborationInstanceId);
  const endpointRuntimeKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
  const existingAlias = aliasForEndpoint(endpointRuntimeKey, storage);
  const previousRuntimeKey = existingAlias
    ? collaborationInstanceRuntimeKey(existingAlias.collaborationInstanceId)
    : endpointRuntimeKey;
  const instanceRuntimeKey = collaborationInstanceRuntimeKey(instanceId);

  // An existing durable target credential is authoritative. This makes retries
  // and a stale endpoint copy unable to overwrite a newer instance token.
  let credential = await getGatewayDeviceCredential(instanceRuntimeKey, options);
  const sourceKeys = [...new Set([
    previousRuntimeKey,
    endpointRuntimeKey,
    ...(options.sourceRuntimeKeys ?? []).map(normalizeRuntimeKey),
  ])].filter((runtimeKey) => runtimeKey !== instanceRuntimeKey);
  if (options.isCurrent && !options.isCurrent()) {
    throw new Error('Gateway identity changed before credential binding');
  }
  const sourceLookups: Array<{ runtimeKey: string; credential: GatewayCredential }> = [];
  for (const sourceRuntimeKey of sourceKeys) {
    const source = await getGatewayDeviceCredential(sourceRuntimeKey, options);
    sourceLookups.push({ runtimeKey: sourceRuntimeKey, credential: source });
  }
  const sources = sourceLookups.filter((source) => Boolean(source.credential.token));
  const durableSource = sources.find((source) => source.credential.persistence === 'system');

  if (!credential.token) {
    const source = durableSource ?? sources[0];
    if (source?.credential.token) {
      credential = await storeGatewayDeviceCredential(
        instanceRuntimeKey,
        source.credential.token,
        options,
      );
      if (source.credential.persistence === 'system' && credential.persistence !== 'system') {
        throw new Error('Instance credential could not be persisted; endpoint credential preserved');
      }
    }
  } else if (credential.persistence !== 'system' && durableSource) {
    // A transient target must be promoted before an existing durable source can
    // be retired. Persist the newer target value, not the stale source value.
    const promoted = await storeGatewayDeviceCredential(
      instanceRuntimeKey,
      credential.token,
      options,
    );
    if (promoted.persistence !== 'system') {
      throw new Error('Instance credential could not be persisted; endpoint credential preserved');
    }
    credential = promoted;
  }

  // A drift after the target write intentionally leaves a harmless duplicate:
  // it must not publish an alias or delete any source credential.
  if (options.isCurrent && !options.isCurrent()) {
    throw new Error('Gateway identity changed during credential binding');
  }

  // Never move this before the target write above. A storage exception leaves
  // both the old credential and the newly written instance copy intact.
  persistRuntimeAlias(
    endpointRuntimeKey,
    instanceId,
    storage,
    options.now ?? Date.now,
  );

  if (options.isCurrent && !options.isCurrent()) {
    throw new Error('Gateway identity changed before credential cleanup');
  }

  const cleanedRuntimeKeys: string[] = [];
  let cleanupComplete = !sourceLookups.some(
    (source) => !source.credential.token && source.credential.persistence === 'unsupported',
  );
  for (const sourceRuntimeKey of sources.map((source) => source.runtimeKey)) {
    const deleted = await deleteGatewayDeviceCredential(sourceRuntimeKey, options);
    const cleaned = deleted.persistence === 'system' || credential.persistence !== 'system';
    if (cleaned) {
      cleanedRuntimeKeys.push(sourceRuntimeKey);
    }
    // On a secure-store error the provider returns unsupported. The target and
    // alias are already safe, but report that an old duplicate may remain.
    if (!cleaned) {
      cleanupComplete = false;
    }
  }

  return {
    endpointRuntimeKey,
    previousRuntimeKey,
    instanceRuntimeKey,
    credential,
    cleanedRuntimeKeys,
    cleanupComplete,
  };
}

export async function getGatewayDeviceCredential(
  runtimeKey: string,
  options: ProviderOptions = {},
): Promise<GatewayCredential> {
  const normalized = normalizeRuntimeKey(runtimeKey);
  const runtimeSession = runtimeSessionCredentials.get(normalized);
  if (runtimeSession?.token) return { ...runtimeSession };

  const existingLookup = credentialLookupsInFlight.get(normalized);
  if (existingLookup) return existingLookup;

  const lookup = (async (): Promise<GatewayCredential> => {
  let resolvedDeviceId: string;
  try {
    resolvedDeviceId = await deviceId(options);
  } catch {
    return {
      runtimeKey: normalized,
      token: null,
      persistence: 'unsupported',
      migrated: false,
    };
  }
  const key = credentialMapKey(normalized, resolvedDeviceId);
  const session = sessionCredentials.get(key);
  if (session?.token) return { ...session };

  try {
    const response = asCredential(await (options.backend ?? defaultBackend).get({
      runtimeKey: normalized,
      deviceId: resolvedDeviceId,
    }));
    if (response.token) sessionCredentials.set(key, response);
    return response;
  } catch {
    return {
      runtimeKey: normalized,
      token: null,
      persistence: 'unsupported',
      migrated: false,
    };
  }
  })();
  credentialLookupsInFlight.set(normalized, lookup);
  try {
    return await lookup;
  } finally {
    if (credentialLookupsInFlight.get(normalized) === lookup) {
      credentialLookupsInFlight.delete(normalized);
    }
  }
}

/** 按已解析的唯一运行时身份读取设备凭据。 */
export async function getGatewayDeviceCredentialForUrl(
  gatewayUrl: string,
  options: RuntimeBindingOptions = {},
): Promise<GatewayCredential> {
  const activeRuntimeKey = resolveGatewayCredentialRuntimeKey(
    gatewayUrl,
    options.storage ?? localStorage,
  );
  return getGatewayDeviceCredential(activeRuntimeKey, options);
}

export async function storeGatewayDeviceCredential(
  runtimeKey: string,
  token: string,
  options: ProviderOptions = {},
): Promise<GatewayCredential> {
  const normalized = normalizeRuntimeKey(runtimeKey);
  const normalizedToken = token.trim();
  if (!normalizedToken) return deleteGatewayDeviceCredential(normalized, options);

  let resolvedDeviceId: string;
  try {
    resolvedDeviceId = await deviceId(options);
  } catch {
    const credential: GatewayCredential = {
      runtimeKey: normalized,
      token: normalizedToken,
      persistence: 'session_only',
      migrated: false,
    };
    runtimeSessionCredentials.set(normalized, credential);
    return credential;
  }
  const key = credentialMapKey(normalized, resolvedDeviceId);
  try {
    const response = asCredential(await (options.backend ?? defaultBackend).store({
      runtimeKey: normalized,
      deviceId: resolvedDeviceId,
      token: normalizedToken,
    }));
    const credential = { ...response, token: normalizedToken };
    sessionCredentials.set(key, credential);
    return credential;
  } catch {
    const credential: GatewayCredential = {
      runtimeKey: normalized,
      token: normalizedToken,
      persistence: 'session_only',
      migrated: false,
    };
    sessionCredentials.set(key, credential);
    return credential;
  }
}

export async function deleteGatewayDeviceCredential(
  runtimeKey: string,
  options: ProviderOptions = {},
): Promise<GatewayCredential> {
  const normalized = normalizeRuntimeKey(runtimeKey);
  runtimeSessionCredentials.delete(normalized);
  let resolvedDeviceId: string;
  try {
    resolvedDeviceId = await deviceId(options);
  } catch {
    return {
      runtimeKey: normalized,
      token: null,
      persistence: 'unsupported',
      migrated: false,
    };
  }
  sessionCredentials.delete(credentialMapKey(normalized, resolvedDeviceId));
  try {
    return asCredential(await (options.backend ?? defaultBackend).delete({
      runtimeKey: normalized,
      deviceId: resolvedDeviceId,
    }));
  } catch {
    return {
      runtimeKey: normalized,
      token: null,
      persistence: 'unsupported',
      migrated: false,
    };
  }
}

/** 测试专用：清空进程内凭据状态。 */
export function resetGatewayCredentialProviderForTests(): void {
  sessionCredentials.clear();
  runtimeSessionCredentials.clear();
  credentialLookupsInFlight.clear();
}
