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
    getDeviceCredential: async () => ({
      runtimeKey: 'endpoint', token: 'device-token', persistence: 'system', migrated: false,
    }),
    storeDeviceCredential: async (runtimeKey, token) => ({
      runtimeKey, token, persistence: 'system', migrated: false,
    }),
    getSavedUrl: () => '',
    ...overrides,
  };
}

test('selected runtime token skips an unnecessary device credential lookup', async () => {
  let credentialLookups = 0;
  const target = await resolveGatewayConnectionTarget({}, dependencies({
    getDeviceCredential: async () => {
      credentialLookups += 1;
      return { runtimeKey: 'endpoint', token: 'device-token', persistence: 'system', migrated: false };
    },
  }));

  assert.deepEqual(target, {
    wsUrl: 'ws://127.0.0.1:18789',
    httpUrl: 'http://127.0.0.1:18789',
    token: 'selected-runtime-token',
    deviceToken: '',
  });
  assert.equal(credentialLookups, 0);
});

test('loopback aliases keep the selected runtime token after desktop restart', async () => {
  let credentialLookups = 0;
  const target = await resolveGatewayConnectionTarget({}, dependencies({
    getSavedUrl: () => 'ws://localhost:18789/',
    getDeviceCredential: async () => {
      credentialLookups += 1;
      return { runtimeKey: 'endpoint', token: 'device-token', persistence: 'system', migrated: false };
    },
  }));

  assert.equal(target.wsUrl, 'ws://localhost:18789/');
  assert.equal(target.token, 'selected-runtime-token');
  assert.equal(target.deviceToken, '');
  assert.equal(credentialLookups, 0);
});

test('manual endpoint never inherits the selected runtime bootstrap token', async () => {
  const target = await resolveGatewayConnectionTarget({
    preferredUrl: 'wss://remote.example.test/gateway',
  }, dependencies());

  assert.equal(target.token, '');
  assert.equal(target.deviceToken, 'device-token');
  assert.equal(target.httpUrl, 'https://remote.example.test/gateway');
});

test('首次设置无法读取所选 Runtime 配置时拒绝猜测连接目标', async () => {
  await assert.rejects(
    resolveGatewayConnectionTarget({
      targetScope: 'selected-runtime',
    }, dependencies({
      detectConfig: async () => { throw new Error('selected runtime config unavailable'); },
      getSavedUrl: () => 'wss://saved.example.test/gateway',
    })),
    /selected runtime config unavailable/,
  );
});

test('首次设置目标范围忽略同一请求携带的手工地址', async () => {
  const target = await resolveGatewayConnectionTarget({
    targetScope: 'selected-runtime',
    preferredUrl: 'wss://manual.example.test/gateway',
  }, dependencies());

  assert.equal(target.wsUrl, 'ws://127.0.0.1:18789');
  assert.equal(target.token, 'selected-runtime-token');
});

test('首次设置无法重读所选 Runtime 凭据时拒绝复用旧值或设备凭据', async () => {
  let deviceCredentialReads = 0;
  await assert.rejects(
    resolveGatewayConnectionTarget({
      targetScope: 'selected-runtime',
    }, dependencies({
      getToken: async () => { throw new Error('selected runtime credential unavailable'); },
      getDeviceCredential: async () => {
        deviceCredentialReads += 1;
        return { runtimeKey: 'endpoint', token: 'device-token', persistence: 'system', migrated: false };
      },
    })),
    /selected runtime credential unavailable/,
  );
  assert.equal(deviceCredentialReads, 0);
});

test('an explicit token is request-scoped and bypasses stored device credentials', async () => {
  let credentialLookups = 0;
  const target = await resolveGatewayConnectionTarget({
    preferredUrl: 'wss://remote.example.test/gateway',
    tokenOverride: 'manual-token',
    useTokenOverride: true,
  }, dependencies({
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
