import test from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayHelloObservation, RuntimeIdentity } from '@/types/gatewayRuntime';
import {
  bindCollaborationRuntimeIdentity,
  buildGatewayHelloObservation,
  getCurrentRuntimeIdentityFailure,
  getCurrentRuntimeIdentity,
  invalidateGatewayRuntimeIdentity,
  observeGatewayHello,
  subscribeRuntimeIdentityFailure,
} from './runtimeIdentity';

function identity(connectionId: string): RuntimeIdentity {
  return {
    runtimeId: null,
    targetFingerprint: `target-${connectionId}`,
    connectionId,
    endpoint: 'ws://127.0.0.1:18789/',
    gatewayVersion: '2026.7.1',
    protocol: 4,
    stateDir: '/tmp/openclaw',
    configPath: '/tmp/openclaw/openclaw.json',
    localStateDir: '/tmp/openclaw',
    localConfigPath: '/tmp/openclaw/openclaw.json',
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
    methods: ['sessions.list'],
    events: ['sessions.changed'],
    negotiatedRole: 'operator',
    negotiatedScopes: ['operator.read'],
    supervisorLifecycle: 'running',
    supervisorPort: 18789,
    observedAtMs: 100,
  };
}

function observation(connectionId: string): GatewayHelloObservation {
  return buildGatewayHelloObservation('ws://127.0.0.1:18789', {
    type: 'hello-ok',
    protocol: 4,
    server: { version: '2026.7.1', connId: connectionId },
    features: { methods: ['sessions.list'], events: ['sessions.changed'] },
    snapshot: {
      stateDir: '/tmp/openclaw',
      configPath: '/tmp/openclaw/openclaw.json',
      authMode: 'token',
    },
    auth: { role: 'operator', scopes: ['operator.read'] },
  }, 100);
}

test('hello-ok projection keeps runtime paths, features, and negotiated scopes', () => {
  const result = observation('conn-1');
  assert.deepEqual(result, {
    endpoint: 'ws://127.0.0.1:18789',
    protocol: 4,
    serverVersion: '2026.7.1',
    connectionId: 'conn-1',
    stateDir: '/tmp/openclaw',
    configPath: '/tmp/openclaw/openclaw.json',
    authMode: 'token',
    methods: ['sessions.list'],
    events: ['sessions.changed'],
    negotiatedRole: 'operator',
    negotiatedScopes: ['operator.read'],
    observedAtMs: 100,
  });
});

test('a late identity response cannot replace a newer gateway connection', async () => {
  let resolveOld!: (value: RuntimeIdentity) => void;
  const oldPromise = new Promise<RuntimeIdentity>((resolve) => { resolveOld = resolve; });
  const oldObservation = observation('conn-old');
  const newObservation = observation('conn-new');

  const pendingOld = observeGatewayHello(oldObservation, async () => oldPromise);
  const resolvedNew = await observeGatewayHello(newObservation, async () => identity('conn-new'));
  assert.equal(resolvedNew?.connectionId, 'conn-new');

  resolveOld(identity('conn-old'));
  assert.equal(await pendingOld, null);
  assert.equal(getCurrentRuntimeIdentity()?.connectionId, 'conn-new');

  await invalidateGatewayRuntimeIdentity('conn-old', async () => false);
  assert.equal(getCurrentRuntimeIdentity()?.connectionId, 'conn-new');

  await invalidateGatewayRuntimeIdentity('conn-new', async () => true);
  assert.equal(getCurrentRuntimeIdentity(), null);
});

test('durable collaboration identity binds only to the active hello connection', async () => {
  await observeGatewayHello(observation('conn-bound'), async () => identity('conn-bound'));
  assert.equal(bindCollaborationRuntimeIdentity('instance-1', 'conn-old'), null);
  assert.equal(getCurrentRuntimeIdentity()?.runtimeId, null);

  const bound = bindCollaborationRuntimeIdentity('instance-1', 'conn-bound');
  assert.equal(bound?.runtimeId, 'instance-1');
  assert.equal(getCurrentRuntimeIdentity()?.runtimeId, 'instance-1');
  await invalidateGatewayRuntimeIdentity('conn-bound', async () => true);
});

test('current connection attestation failure is published with its connection fence', async () => {
  const failures: Array<string | null> = [];
  const unsubscribe = subscribeRuntimeIdentityFailure((failure) => {
    failures.push(failure ? `${failure.connectionId}:${failure.diagnostic}` : null);
  });

  await assert.rejects(
    observeGatewayHello(observation('conn-failed'), async () => {
      throw new Error('selected runtime path mismatch');
    }),
    /selected runtime path mismatch/,
  );

  assert.deepEqual(getCurrentRuntimeIdentityFailure(), {
    connectionId: 'conn-failed',
    diagnostic: 'selected runtime path mismatch',
  });
  assert.equal(failures.at(-1), 'conn-failed:selected runtime path mismatch');
  unsubscribe();
  await invalidateGatewayRuntimeIdentity('conn-failed', async () => true);
});

test('a stale attestation failure cannot replace a newer verified connection', async () => {
  let rejectOld!: (reason?: unknown) => void;
  const oldPromise = new Promise<RuntimeIdentity>((_resolve, reject) => { rejectOld = reject; });
  const pendingOld = observeGatewayHello(observation('conn-stale'), async () => oldPromise);

  await observeGatewayHello(observation('conn-current'), async () => identity('conn-current'));
  rejectOld(new Error('stale failure'));
  await assert.rejects(pendingOld, /stale failure/);

  assert.equal(getCurrentRuntimeIdentityFailure(), null);
  assert.equal(getCurrentRuntimeIdentity()?.connectionId, 'conn-current');
  await invalidateGatewayRuntimeIdentity('conn-current', async () => true);
});
