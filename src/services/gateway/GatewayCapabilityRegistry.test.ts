import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GatewayCapabilityRegistry,
  classifyGatewayCapabilityFailure,
} from './GatewayCapabilityRegistry';
import {
  GatewayRequestTimeoutError,
  GatewayTransportLifecycleError,
} from './GatewayTransportError';

const hello = {
  endpoint: 'ws://127.0.0.1:18789',
  protocol: 4,
  serverVersion: '2026.7.1',
  connectionId: 'gateway-a',
  stateDir: null,
  configPath: null,
  authMode: 'token',
  methods: ['sessions.list', 'commands.list'],
  events: ['chat'],
  negotiatedRole: 'operator',
  negotiatedScopes: ['operator.read'],
  observedAtMs: 100,
};

const rpcError = (message: string, code: string, details?: Record<string, unknown>) => ({
  name: 'GatewayRpcError',
  message,
  code,
  ...(details ? { details } : {}),
});

test('hello methods are advertised evidence, not proof that omitted methods are unsupported', () => {
  const registry = new GatewayCapabilityRegistry(() => 200);
  registry.observeHello(hello);

  assert.equal(registry.get('sessions.list')?.state, 'advertised');
  assert.equal(registry.get('tools.catalog'), null);
  assert.equal(registry.snapshot().methodsConservative, true);
});

test('RPC success upgrades advertised evidence to available', () => {
  const registry = new GatewayCapabilityRegistry(() => 200);
  registry.observeHello(hello);
  registry.recordSuccess('sessions.list');

  assert.deepEqual(registry.get('sessions.list'), {
    method: 'sessions.list',
    state: 'available',
    source: 'rpc',
    connectionId: 'gateway-a',
    observedAtMs: 200,
  });
});

test('failure evidence distinguishes unsupported, authorization, unavailable, and pending verification', () => {
  assert.deepEqual(classifyGatewayCapabilityFailure(rpcError('missing', 'METHOD_NOT_FOUND'), 'cron.runs'), {
    state: 'error',
    code: 'METHOD_NOT_FOUND',
  });
  assert.deepEqual(classifyGatewayCapabilityFailure(
    rpcError('unknown method: cron.runs', 'INVALID_REQUEST'),
    'cron.runs',
  ), {
    state: 'unsupported',
    code: 'INVALID_REQUEST',
  });
  assert.deepEqual(classifyGatewayCapabilityFailure(
    rpcError('unknown method: another.method', 'INVALID_REQUEST'),
    'cron.runs',
  ), {
    state: 'error',
    code: 'INVALID_REQUEST',
  });
  assert.deepEqual(classifyGatewayCapabilityFailure(rpcError(
    'scope denied',
    'MISSING_SCOPE',
    { missingScope: 'operator.admin' },
  )), {
    state: 'unauthorized',
    code: 'MISSING_SCOPE',
    missingScope: 'operator.admin',
  });
  assert.deepEqual(classifyGatewayCapabilityFailure(new GatewayTransportLifecycleError()), {
    state: 'unavailable',
    code: 'GATEWAY_TRANSPORT_LIFECYCLE',
  });
  assert.deepEqual(classifyGatewayCapabilityFailure(new GatewayRequestTimeoutError(1_000)), {
    state: 'pending_verification',
    code: 'GATEWAY_REQUEST_TIMEOUT',
  });
  assert.deepEqual(classifyGatewayCapabilityFailure({ code: 'GATEWAY_REQUEST_ABORTED' }), {
    state: 'pending_verification',
    code: 'GATEWAY_REQUEST_ABORTED',
  });
});

test('snapshot is sanitized and resets with the authenticated socket', () => {
  const registry = new GatewayCapabilityRegistry(() => 300);
  registry.observeHello(hello);
  registry.recordFailure('sessions.list', rpcError('forbidden', 'FORBIDDEN', {
    code: 'MISSING_SCOPE',
    missingScope: 'operator.admin',
    message: 'do not retain this detail',
  }));

  const snapshot = registry.snapshot();
  assert.equal(snapshot.methodEvidence['sessions.list']?.state, 'unauthorized');
  assert.equal(snapshot.methodEvidence['sessions.list']?.missingScope, 'operator.admin');
  assert.equal('details' in snapshot.methodEvidence['sessions.list']!, false);
  assert.notEqual(snapshot.methods, registry.snapshot().methods);

  registry.observeHello(null);
  assert.deepEqual(registry.snapshot(), {
    connectionId: null,
    protocol: null,
    serverVersion: null,
    methods: [],
    events: [],
    negotiatedRole: null,
    negotiatedScopes: [],
    methodsConservative: true,
    methodEvidence: {},
    observedAtMs: null,
  });
});
