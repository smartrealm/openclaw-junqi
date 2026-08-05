import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bindGatewayCredentialToCurrentInstance,
  type GatewayCredentialBindingDependencies,
} from './GatewayCredentialBinding';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';

const gatewayUrl = 'ws://127.0.0.1:18789';
const instanceId = 'collaboration-instance';
const connectionId = 'connection-1';

function identity(): RuntimeIdentity {
  return {
    runtimeId: instanceId,
    targetFingerprint: 'target-fingerprint',
    connectionId,
    endpoint: gatewayUrl,
    gatewayVersion: '2026.8.0',
    protocol: 4,
    stateDir: '/selected/state',
    configPath: '/selected/openclaw.json',
    localStateDir: '/selected/state',
    localConfigPath: '/selected/openclaw.json',
    deploymentKind: 'managed_child',
    ownership: 'junqi_managed',
    persistence: 'desktop_bound',
    installTarget: 'native_cli',
    endpointAttestation: 'matched',
    pathAttestation: 'matched',
    desktopMutationAllowed: true,
    desktopExitContinuity: false,
    verified: true,
    issues: [],
    authMode: 'token',
    methods: [],
    events: [],
    negotiatedRole: 'operator',
    negotiatedScopes: [],
    supervisorLifecycle: 'running',
    supervisorPort: 18789,
    observedAtMs: 1,
  };
}

function binding() {
  return {
    endpointRuntimeKey: 'endpoint:ws://127.0.0.1:18789/',
    previousRuntimeKey: 'endpoint:ws://127.0.0.1:18789/',
    instanceRuntimeKey: 'instance:collaboration-instance',
    credential: {
      runtimeKey: 'instance:collaboration-instance',
      token: 'device-token',
      persistence: 'system' as const,
      migrated: false,
    },
    cleanedRuntimeKeys: [],
    cleanupComplete: true,
  };
}

function dependencies(
  overrides: Partial<GatewayCredentialBindingDependencies> = {},
): GatewayCredentialBindingDependencies {
  return {
    detectConfig: async () => ({
      token: null,
      port: 18789,
      ws_url: gatewayUrl,
      http_url: 'http://127.0.0.1:18789',
      config_path: '/selected/openclaw.json',
      runtime_mode: 'native',
      credential_scope: 'selected-runtime',
    }),
    currentIdentity: identity,
    bindCredential: async () => binding(),
    ...overrides,
  };
}

test('credential binding uses the selected runtime source slot behind an identity fence', async () => {
  const received: Array<{ sourceRuntimeKeys: string[]; isCurrent: () => boolean }> = [];
  const result = await bindGatewayCredentialToCurrentInstance(
    gatewayUrl,
    instanceId,
    connectionId,
    dependencies({
      bindCredential: async (_url, _instance, options) => {
        received.push(options);
        return binding();
      },
    }),
  );

  assert.equal(result.cleanupComplete, true);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].sourceRuntimeKeys, [
    'selected:selected-runtime\u0000endpoint:ws://127.0.0.1:18789/',
  ]);
  assert.equal(received[0].isCurrent(), true);
});

test('credential binding refuses a stale Gateway identity before any mutation', async () => {
  let called = false;
  await assert.rejects(
    bindGatewayCredentialToCurrentInstance(gatewayUrl, instanceId, connectionId, dependencies({
      currentIdentity: () => null,
      bindCredential: async () => {
        called = true;
        return binding();
      },
    })),
    /Gateway identity changed before credential binding completed/,
  );
  assert.equal(called, false);
});

test('credential binding fails closed when selected-runtime config cannot be read', async () => {
  let called = false;
  await assert.rejects(
    bindGatewayCredentialToCurrentInstance(gatewayUrl, instanceId, connectionId, dependencies({
      detectConfig: async () => { throw new Error('selected runtime config unavailable'); },
      bindCredential: async () => {
        called = true;
        return binding();
      },
    })),
    /selected runtime config unavailable/,
  );
  assert.equal(called, false);
});
