import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type {
  GatewayCredentialResult,
  GatewayCredentialPersistence,
} from '@/api/tauri-commands';
import {
  GATEWAY_CREDENTIAL_MIGRATION_MARKER,
  GATEWAY_RUNTIME_ALIAS_KEY,
  LEGACY_GATEWAY_CONFIG_KEY,
  LEGACY_GATEWAY_SETTING_KEY,
  LEGACY_GATEWAY_TOKEN_KEY,
  bindGatewayCredentialToInstance,
  clearLegacyGatewayCredentialStorage,
  collaborationInstanceRuntimeKey,
  gatewayRuntimeKeyFromUrl,
  getGatewayDeviceCredentialForUrl,
  getGatewayDeviceCredential,
  migrateLegacyGatewayCredential,
  resetGatewayCredentialProviderForTests,
  resolveGatewayCredentialRuntimeKey,
  selectedGatewayRuntimeKey,
  storeGatewayDeviceCredential,
  type GatewayCredentialBackend,
} from './credentialProvider';

const deviceId = async () => 'device-1';

function response(
  runtimeKey: string,
  persistence: GatewayCredentialPersistence,
  token: string | null = null,
  migrated = false,
): GatewayCredentialResult {
  return { runtimeKey, persistence, token, migrated };
}

function backend(overrides: Partial<GatewayCredentialBackend> = {}): GatewayCredentialBackend {
  return {
    get: async ({ runtimeKey }) => response(runtimeKey, 'unsupported'),
    store: async ({ runtimeKey }) => response(runtimeKey, 'session_only'),
    delete: async ({ runtimeKey }) => response(runtimeKey, 'unsupported'),
    migrate: async ({ runtimeKey, legacyToken }) => response(runtimeKey, 'session_only', legacyToken, true),
    ...overrides,
  };
}

function credentialBackend(
  initial: Array<[string, { token: string; persistence: GatewayCredentialPersistence }]>,
  events: string[] = [],
  storePersistence: GatewayCredentialPersistence = 'system',
): { backend: GatewayCredentialBackend; credentials: Map<string, { token: string; persistence: GatewayCredentialPersistence }> } {
  const credentials = new Map(initial);
  return {
    credentials,
    backend: {
      get: async ({ runtimeKey }) => {
        const value = credentials.get(runtimeKey);
        return response(runtimeKey, value?.persistence ?? 'system', value?.token ?? null);
      },
      store: async ({ runtimeKey, token }) => {
        events.push(`store:${runtimeKey}`);
        if (storePersistence === 'system') credentials.set(runtimeKey, { token, persistence: 'system' });
        return response(runtimeKey, storePersistence);
      },
      delete: async ({ runtimeKey }) => {
        events.push(`delete:${runtimeKey}`);
        const previous = credentials.get(runtimeKey);
        credentials.delete(runtimeKey);
        return response(runtimeKey, previous?.persistence ?? 'system');
      },
      migrate: async ({ runtimeKey, legacyToken }) => {
        credentials.set(runtimeKey, { token: legacyToken, persistence: 'system' });
        return response(runtimeKey, 'system', legacyToken, true);
      },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetGatewayCredentialProviderForTests();
});

describe('gatewayRuntimeKeyFromUrl', () => {
  it('canonicalizes equivalent endpoint URLs', () => {
    assert.equal(
      gatewayRuntimeKeyFromUrl('WS://LOCALHOST:18789'),
      gatewayRuntimeKeyFromUrl('ws://localhost:18789/'),
    );
  });

  it('keeps malformed manual endpoints isolated', () => {
    assert.equal(gatewayRuntimeKeyFromUrl('manual-target'), 'endpoint:manual-target');
  });

  it('never includes URL credentials in the runtime key', () => {
    const key = gatewayRuntimeKeyFromUrl('wss://user:secret@example.com/gateway');
    assert.equal(key, 'endpoint:wss://example.com/gateway');
    assert.doesNotMatch(key, /user|secret/);
  });
});

describe('Gateway credential provider', () => {
  it('retains an unsupported-store token in memory only', async () => {
    const writes: unknown[] = [];
    const result = await storeGatewayDeviceCredential('runtime-a', 'paired-token', {
      resolveDeviceId: deviceId,
      backend: backend({
        store: async (params) => {
          writes.push(params);
          return response(params.runtimeKey, 'session_only');
        },
      }),
    });

    assert.equal(result.persistence, 'session_only');
    assert.equal(result.token, 'paired-token');
    assert.equal(localStorage.length, 0);
    assert.equal(writes.length, 1);

    const restored = await getGatewayDeviceCredential('runtime-a', {
      resolveDeviceId: deviceId,
      backend: backend({ get: async () => { throw new Error('must use session cache'); } }),
    });
    assert.equal(restored.token, 'paired-token');
  });

  it('migrates once and removes every legacy plaintext location', async () => {
    localStorage.setItem(LEGACY_GATEWAY_TOKEN_KEY, 'legacy-direct');
    localStorage.setItem(LEGACY_GATEWAY_CONFIG_KEY, JSON.stringify({
      gatewayUrl: 'ws://localhost:18789',
      gatewayToken: 'legacy-config',
      theme: 'dark',
    }));
    localStorage.setItem(LEGACY_GATEWAY_SETTING_KEY, JSON.stringify('legacy-setting'));
    let migratedToken = '';

    const result = await migrateLegacyGatewayCredential('runtime-a', {
      resolveDeviceId: deviceId,
      backend: backend({
        migrate: async (params) => {
          migratedToken = params.legacyToken;
          return response(params.runtimeKey, 'system', params.legacyToken, true);
        },
      }),
    });

    assert.equal(migratedToken, 'legacy-direct');
    assert.equal(result.token, 'legacy-direct');
    assert.equal(localStorage.getItem(LEGACY_GATEWAY_TOKEN_KEY), null);
    assert.equal(localStorage.getItem(LEGACY_GATEWAY_SETTING_KEY), null);
    assert.deepEqual(JSON.parse(localStorage.getItem(LEGACY_GATEWAY_CONFIG_KEY) || '{}'), {
      gatewayUrl: 'ws://localhost:18789',
      theme: 'dark',
    });
    assert.equal(localStorage.getItem(GATEWAY_CREDENTIAL_MIGRATION_MARKER), '1');
  });

  it('uses an existing secure token instead of overwriting it with legacy state', async () => {
    localStorage.setItem(LEGACY_GATEWAY_TOKEN_KEY, 'stale-legacy');
    const result = await migrateLegacyGatewayCredential('runtime-a', {
      resolveDeviceId: deviceId,
      backend: backend({
        migrate: async ({ runtimeKey }) => response(runtimeKey, 'system', 'current-secure', false),
      }),
    });

    assert.equal(result.token, 'current-secure');
    assert.equal(result.migrated, false);
    assert.equal(localStorage.getItem(LEGACY_GATEWAY_TOKEN_KEY), null);
  });

  it('clears plaintext and falls back to session memory when migration fails', async () => {
    localStorage.setItem(LEGACY_GATEWAY_CONFIG_KEY, JSON.stringify({ gatewayToken: 'legacy' }));
    const failing = backend({ migrate: async () => { throw new Error('keychain locked'); } });

    const result = await migrateLegacyGatewayCredential('runtime-a', {
      resolveDeviceId: deviceId,
      backend: failing,
    });

    assert.equal(result.persistence, 'session_only');
    assert.equal(result.token, 'legacy');
    assert.deepEqual(JSON.parse(localStorage.getItem(LEGACY_GATEWAY_CONFIG_KEY) || '{}'), {});
    const cached = await getGatewayDeviceCredential('runtime-a', {
      resolveDeviceId: deviceId,
      backend: failing,
    });
    assert.equal(cached.token, 'legacy');
  });

  it('still clears plaintext when device identity is unavailable', async () => {
    localStorage.setItem(LEGACY_GATEWAY_TOKEN_KEY, 'legacy');
    const result = await migrateLegacyGatewayCredential('runtime-a', {
      resolveDeviceId: async () => { throw new Error('identity unavailable'); },
      backend: backend(),
    });

    assert.equal(result.persistence, 'session_only');
    assert.equal(result.token, 'legacy');
    assert.equal(localStorage.getItem(LEGACY_GATEWAY_TOKEN_KEY), null);
    const cached = await getGatewayDeviceCredential('runtime-a', {
      resolveDeviceId: async () => { throw new Error('identity unavailable'); },
      backend: backend(),
    });
    assert.equal(cached.token, 'legacy');
  });

  it('preserves unrelated config when clearing malformed or stale secrets', () => {
    localStorage.setItem(LEGACY_GATEWAY_CONFIG_KEY, JSON.stringify({ gatewayToken: 'x', gatewayUrl: 'ws://x' }));
    clearLegacyGatewayCredentialStorage();
    assert.deepEqual(JSON.parse(localStorage.getItem(LEGACY_GATEWAY_CONFIG_KEY) || '{}'), { gatewayUrl: 'ws://x' });
  });
});

it('keeps selected Native and Docker credentials isolated on one loopback endpoint', () => {
  const endpoint = 'ws://127.0.0.1:18789';
  const native = selectedGatewayRuntimeKey(endpoint, 'native:/state/openclaw.json');
  const docker = selectedGatewayRuntimeKey(endpoint, 'docker:/state/docker/openclaw.json');

  assert.notEqual(native, docker);
  assert.match(native, /^selected:native:/);
  assert.match(docker, /^selected:docker:/);
});

describe('Gateway runtime credential binding', () => {
  const gatewayUrl = 'ws://localhost:18789';

  it('writes the instance token, then the alias, then deletes the endpoint token', async () => {
    const endpointKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
    const instanceKey = collaborationInstanceRuntimeKey('instance-1');
    const events: string[] = [];
    const state = credentialBackend([
      [endpointKey, { token: 'paired-token', persistence: 'system' }],
    ], events);
    const storage = {
      getItem: localStorage.getItem.bind(localStorage),
      setItem: (key: string, value: string) => {
        if (key === GATEWAY_RUNTIME_ALIAS_KEY) events.push('persist:alias');
        localStorage.setItem(key, value);
      },
    };

    const result = await bindGatewayCredentialToInstance(gatewayUrl, 'instance-1', {
      backend: state.backend,
      resolveDeviceId: deviceId,
      storage,
      now: () => 123,
    });

    assert.deepEqual(events, [
      `store:${instanceKey}`,
      'persist:alias',
      `delete:${endpointKey}`,
    ]);
    assert.equal(result.credential.token, 'paired-token');
    assert.equal(state.credentials.get(instanceKey)?.token, 'paired-token');
    assert.equal(state.credentials.has(endpointKey), false);
    assert.equal(resolveGatewayCredentialRuntimeKey(gatewayUrl), instanceKey);
    const aliasStore = JSON.parse(localStorage.getItem(GATEWAY_RUNTIME_ALIAS_KEY) || '{}');
    assert.equal(aliasStore.aliases[0].boundAtMs, 123);
    assert.doesNotMatch(JSON.stringify(aliasStore), /paired-token/);
  });

  it('does not persist the alias or delete a durable source when target persistence fails', async () => {
    const endpointKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
    const events: string[] = [];
    const state = credentialBackend([
      [endpointKey, { token: 'durable-token', persistence: 'system' }],
    ], events, 'session_only');

    await assert.rejects(
      bindGatewayCredentialToInstance(gatewayUrl, 'instance-1', {
        backend: state.backend,
        resolveDeviceId: deviceId,
      }),
      /endpoint credential preserved/,
    );

    assert.deepEqual(events, [`store:${collaborationInstanceRuntimeKey('instance-1')}`]);
    assert.equal(localStorage.getItem(GATEWAY_RUNTIME_ALIAS_KEY), null);
    assert.equal(state.credentials.get(endpointKey)?.token, 'durable-token');
  });

  it('rebinds an old instance without deleting it before the new instance is durable', async () => {
    const endpointKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
    const oldKey = collaborationInstanceRuntimeKey('instance-old');
    const newKey = collaborationInstanceRuntimeKey('instance-new');
    localStorage.setItem(GATEWAY_RUNTIME_ALIAS_KEY, JSON.stringify({
      version: 1,
      aliases: [{ endpointRuntimeKey: endpointKey, collaborationInstanceId: 'instance-old', boundAtMs: 1 }],
    }));
    const events: string[] = [];
    const state = credentialBackend([
      [oldKey, { token: 'old-instance-token', persistence: 'system' }],
    ], events);

    await bindGatewayCredentialToInstance(gatewayUrl, 'instance-new', {
      backend: state.backend,
      resolveDeviceId: deviceId,
      now: () => 2,
    });

    assert.equal(state.credentials.get(newKey)?.token, 'old-instance-token');
    assert.equal(state.credentials.has(oldKey), false);
    assert.equal(resolveGatewayCredentialRuntimeKey(gatewayUrl), newKey);
    assert.ok(events.indexOf(`store:${newKey}`) < events.indexOf(`delete:${oldKey}`));
  });

  it('keeps both credential copies when alias persistence throws', async () => {
    const endpointKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
    const instanceKey = collaborationInstanceRuntimeKey('instance-1');
    const events: string[] = [];
    const state = credentialBackend([
      [endpointKey, { token: 'paired-token', persistence: 'system' }],
    ], events);

    await assert.rejects(bindGatewayCredentialToInstance(gatewayUrl, 'instance-1', {
      backend: state.backend,
      resolveDeviceId: deviceId,
      storage: {
        getItem: localStorage.getItem.bind(localStorage),
        setItem: () => { throw new Error('storage unavailable'); },
      },
    }), /storage unavailable/);

    assert.equal(state.credentials.get(instanceKey)?.token, 'paired-token');
    assert.equal(state.credentials.get(endpointKey)?.token, 'paired-token');
    assert.doesNotMatch(events.join(','), /delete:/);
  });

  it('migrates a selected-runtime token to the attested instance', async () => {
    const selectedKey = selectedGatewayRuntimeKey(gatewayUrl, 'docker:/state/docker/openclaw.json');
    const instanceKey = collaborationInstanceRuntimeKey('instance-1');
    const state = credentialBackend([
      [selectedKey, { token: 'selected-token', persistence: 'system' }],
    ]);

    const result = await bindGatewayCredentialToInstance(gatewayUrl, 'instance-1', {
      backend: state.backend,
      resolveDeviceId: deviceId,
      sourceRuntimeKeys: [selectedKey],
      isCurrent: () => true,
    });

    assert.equal(result.credential.token, 'selected-token');
    assert.equal(state.credentials.get(instanceKey)?.token, 'selected-token');
    assert.equal(state.credentials.has(selectedKey), false);
  });

  it('keeps source credentials when Gateway identity drifts during binding', async () => {
    const selectedKey = selectedGatewayRuntimeKey(gatewayUrl, 'native:/state/openclaw.json');
    const instanceKey = collaborationInstanceRuntimeKey('instance-1');
    const events: string[] = [];
    const state = credentialBackend([
      [selectedKey, { token: 'selected-token', persistence: 'system' }],
    ], events);
    let checks = 0;

    await assert.rejects(bindGatewayCredentialToInstance(gatewayUrl, 'instance-1', {
      backend: state.backend,
      resolveDeviceId: deviceId,
      sourceRuntimeKeys: [selectedKey],
      isCurrent: () => ++checks < 2,
    }), /identity changed during credential binding/);

    assert.equal(state.credentials.get(instanceKey)?.token, 'selected-token');
    assert.equal(state.credentials.get(selectedKey)?.token, 'selected-token');
    assert.doesNotMatch(events.join(','), /delete:/);
    assert.equal(localStorage.getItem(GATEWAY_RUNTIME_ALIAS_KEY), null);
  });

  it('falls back to the endpoint token after an interrupted alias migration', async () => {
    const endpointKey = gatewayRuntimeKeyFromUrl(gatewayUrl);
    localStorage.setItem(GATEWAY_RUNTIME_ALIAS_KEY, JSON.stringify({
      version: 1,
      aliases: [{ endpointRuntimeKey: endpointKey, collaborationInstanceId: 'instance-1', boundAtMs: 1 }],
    }));
    const state = credentialBackend([
      [endpointKey, { token: 'endpoint-fallback', persistence: 'system' }],
    ]);

    const credential = await getGatewayDeviceCredentialForUrl(gatewayUrl, {
      backend: state.backend,
      resolveDeviceId: deviceId,
    });

    assert.equal(credential.runtimeKey, endpointKey);
    assert.equal(credential.token, 'endpoint-fallback');
  });
});
