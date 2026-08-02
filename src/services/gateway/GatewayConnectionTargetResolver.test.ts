import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStoredGatewayCredentialToken,
  resolveGatewayConnectionTarget,
  storeGatewayConnectionDeviceCredential,
  type GatewayConnectionTargetResolverDependencies,
} from './GatewayConnectionTargetResolver';

function dependencies(
  overrides: Partial<GatewayConnectionTargetResolverDependencies> = {},
): GatewayConnectionTargetResolverDependencies {
  return {
    detectConfig: async () => ({
      token: 'configured-token',
      port: 18789,
      ws_url: 'ws://127.0.0.1:18789',
      http_url: 'http://127.0.0.1:18789',
      config_path: '/selected/openclaw.json',
      runtime_mode: 'native',
      credential_scope: 'selected-runtime',
    }),
    getToken: async () => 'selected-runtime-token',
    migrateCredential: async () => ({
      runtimeKey: 'endpoint', token: null, persistence: 'unsupported', migrated: false,
    }),
    getDeviceCredential: async () => ({
      runtimeKey: 'endpoint', token: 'device-token', persistence: 'system', migrated: false,
    }),
    storeDeviceCredential: async (runtimeKey, token) => ({
      runtimeKey, token, persistence: 'system', migrated: false,
    }),
    getLegacyCredential: async () => null,
    deleteLegacyCredential: async () => {},
    getSavedUrl: () => '',
    ...overrides,
  };
}

test('selected runtime target combines its typed token with the device credential', async () => {
  const target = await resolveGatewayConnectionTarget({}, dependencies());

  assert.deepEqual(target, {
    wsUrl: 'ws://127.0.0.1:18789',
    httpUrl: 'http://127.0.0.1:18789',
    token: 'selected-runtime-token',
    deviceToken: 'device-token',
  });
});

test('manual endpoint never inherits the selected runtime bootstrap token', async () => {
  const target = await resolveGatewayConnectionTarget({
    preferredUrl: 'wss://remote.example.test/gateway',
  }, dependencies());

  assert.equal(target.token, '');
  assert.equal(target.deviceToken, 'device-token');
  assert.equal(target.httpUrl, 'https://remote.example.test/gateway');
});

test('an explicit token is request-scoped and bypasses stored device credentials', async () => {
  let credentialLookups = 0;
  const target = await resolveGatewayConnectionTarget({
    preferredUrl: 'wss://remote.example.test/gateway',
    tokenOverride: 'manual-token',
    useTokenOverride: true,
  }, dependencies({
    migrateCredential: async () => {
      credentialLookups += 1;
      throw new Error('must not look up a stored credential');
    },
  }));

  assert.equal(target.token, 'manual-token');
  assert.equal(target.deviceToken, '');
  assert.equal(credentialLookups, 0);
});

test('stored credential lookup never reads the selected runtime bootstrap token', async () => {
  let selectedTokenReads = 0;
  const token = await getStoredGatewayCredentialToken('ws://127.0.0.1:18789', dependencies({
    getToken: async () => {
      selectedTokenReads += 1;
      return 'must-not-read';
    },
  }));

  assert.equal(token, 'device-token');
  assert.equal(selectedTokenReads, 0);
});

test('rotated selected-runtime device tokens keep the selected credential scope', async () => {
  const stored = await storeGatewayConnectionDeviceCredential(
    'ws://localhost:18789/',
    'rotated-device-token',
    dependencies(),
  );

  assert.equal(stored.runtimeKey, 'selected:selected-runtime\0endpoint:ws://localhost:18789/');
  assert.equal(stored.token, 'rotated-device-token');
});

test('legacy system credentials migrate through the shared target resolver', async () => {
  const deleted: Array<{ endpoint: string; scope: string }> = [];
  const target = await resolveGatewayConnectionTarget({}, dependencies({
    getDeviceCredential: async () => ({
      runtimeKey: 'endpoint', token: null, persistence: 'unsupported', migrated: false,
    }),
    getLegacyCredential: async (endpoint, scope) => {
      assert.equal(endpoint, 'ws://127.0.0.1:18789');
      assert.equal(scope, 'selected-runtime');
      return 'legacy-device-token';
    },
    deleteLegacyCredential: async (endpoint, scope) => { deleted.push({ endpoint, scope }); },
  }));

  assert.equal(target.deviceToken, 'legacy-device-token');
  assert.deepEqual(deleted, [{ endpoint: 'ws://127.0.0.1:18789', scope: 'selected-runtime' }]);
});
