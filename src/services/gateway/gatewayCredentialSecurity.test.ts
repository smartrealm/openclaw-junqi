import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { stopPolling, useGatewayDataStore } from '@/stores/gatewayDataStore';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import type { GatewayDeviceChallengeParams } from '@/api/tauri-commands';
import { GatewayConnection, type GatewayConnectionOptions } from './Connection';
import { GatewayTransportLifecycleError } from './GatewayTransportError';
import type { GatewayAuthorizationIssue } from './messageRouter';
import {
  createApprovalRequester,
  createPrivilegedRequester,
  subscribePrivilegedAuthorizationIssues,
  subscribePrivilegedAuthorizationResolved,
} from './index';
import {
  buildGatewayHelloObservation,
  getCurrentRuntimeIdentity,
  invalidateGatewayRuntimeIdentity,
  observeGatewayHello,
} from './runtimeIdentity';

const source = (path: string) => readFileSync(path, 'utf8');

// useSetupFlow is a directory of hook modules; assert against all of them.
const sourceDirTs = (dir: string) =>
  readdirSync(dir)
    .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
    .sort()
    .map((entry) => readFileSync(`${dir}/${entry}`, 'utf8'))
    .join('\n');

interface WireRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

class MemoryWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MemoryWebSocket[] = [];

  readonly url: string;
  readyState = MemoryWebSocket.CONNECTING;
  bufferedAmount = 0;
  sent: WireRequest[] = [];
  closeCalls: Array<{ code: number; reason: string }> = [];
  onSend: (message: WireRequest) => void = () => {};
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string | URL) {
    this.url = String(url);
    MemoryWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MemoryWebSocket.OPEN;
    this.onopen?.({});
  }

  send(data: string) {
    const message = JSON.parse(data) as WireRequest;
    this.sent.push(message);
    this.onSend(message);
  }

  receive(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(code = 1000, reason = '') {
    if (this.readyState === MemoryWebSocket.CLOSED) return;
    this.readyState = MemoryWebSocket.CLOSED;
    this.closeCalls.push({ code, reason });
    queueMicrotask(() => this.onclose?.({ code, reason }));
  }
}

const originalWebSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
Object.defineProperty(globalThis, 'WebSocket', {
  configurable: true,
  writable: true,
  value: MemoryWebSocket,
});
const savedDeviceTokens: Array<{ token: string; url: string }> = [];

after(() => {
  if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket);
  else Reflect.deleteProperty(globalThis, 'WebSocket');
});

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitForSocketCount(count: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (MemoryWebSocket.instances.length === count) return;
    // Pairing retries use a timer. Yielding only to setImmediate can starve
    // that timer on a loaded CI runner and make this resource-safety test flaky.
    await wait(5);
  }
  assert.equal(MemoryWebSocket.instances.length, count);
}

async function waitForSocketRequest(socket: MemoryWebSocket, method: string): Promise<WireRequest> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const request = socket.sent.find((candidate) => candidate.method === method);
    if (request) return request;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`Expected ${method} request before the handshake deadline`);
}

function challenge(socket: MemoryWebSocket, timestamp = 1_735_000_000_123) {
  socket.open();
  socket.receive({
    type: 'event',
    event: 'connect.challenge',
    payload: {
      nonce: `nonce-${MemoryWebSocket.instances.indexOf(socket)}`,
      ts: timestamp,
    },
  });
}

function acceptHandshake(
  socket: MemoryWebSocket,
  request: WireRequest,
  connectionId: string,
  scopes = ['operator.admin'],
  deviceToken?: string,
  methods: string[] = [],
  protocol = 4,
  tickIntervalMs = 30_000,
  maxPayload = 1_024,
  maxBufferedBytes = 2_048,
) {
  socket.receive({
    type: 'res',
    id: request.id,
    ok: true,
    payload: {
      type: 'hello-ok',
      protocol,
      server: { version: '2026.7.1', connId: connectionId },
      features: { methods, events: [] },
      snapshot: {
        presence: [],
        health: {},
        stateVersion: { presence: 0, health: 0 },
        uptimeMs: 0,
      },
      auth: { role: 'operator', scopes, ...(deviceToken ? { deviceToken } : {}) },
      policy: {
        maxPayload,
        maxBufferedBytes,
        tickIntervalMs,
      },
    },
  });
}

function sourceConnection() {
  return {
    isConnected: () => true,
    getAttestedConnectionId: () => 'daily-connection',
    url: 'ws://127.0.0.1:18789',
    token: 'gateway-token',
    deviceToken: '',
  };
}

function createMemoryGatewayConnection(options: GatewayConnectionOptions = {}) {
  return new GatewayConnection(options, {
    resolvePlatform: async () => 'linux',
    signDeviceChallenge: async (params) => ({
      deviceId: 'memory-device',
      publicKey: 'memory-public-key',
      signature: 'memory-signature',
      signedAt: params.signedAt,
      nonce: params.nonce,
    }),
  });
}

function requesterWithRealTransientConnections(options: GatewayConnectionOptions[] = []) {
  return createPrivilegedRequester(sourceConnection(), (connectionOptions) => {
    options.push(connectionOptions);
    return createMemoryGatewayConnection(connectionOptions);
  }, { pairingRetryMs: 0, pairingTimeoutMs: 1_000 });
}

function resetSockets() {
  assert.ok(
    MemoryWebSocket.instances.every((socket) => socket.readyState === MemoryWebSocket.CLOSED),
    'the previous test must close every socket',
  );
  MemoryWebSocket.instances = [];
  savedDeviceTokens.length = 0;
}

describe('Gateway credential security regression gates', () => {
  it('does not fall back to token-only connect before a Gateway challenge', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection();
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.open();
    await turn();

    assert.deepEqual(socket.sent, []);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('closes an incomplete handshake at its connection deadline', async () => {
    resetSockets();
    const connection = new GatewayConnection({ transient: true }, {
      resolvePlatform: async () => 'linux',
      signDeviceChallenge: async () => ({
        deviceId: 'deadline-device',
        publicKey: 'deadline-public-key',
        signature: 'deadline-signature',
        signedAt: 0,
        nonce: 'deadline-nonce',
      }),
      connectTimeoutMs: 5,
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.open();
    await wait(20);

    assert.deepEqual(socket.sent, []);
    assert.deepEqual(socket.closeCalls, [{ code: 4000, reason: 'Gateway handshake timeout' }]);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('rejects an invalid Gateway challenge before it can send connect', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection();
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.open();
    socket.receive({
      type: 'event',
      event: 'connect.challenge',
      payload: { nonce: 'nonce-without-timestamp' },
    });
    await turn();

    assert.deepEqual(socket.sent, []);
    assert.deepEqual(socket.closeCalls, [{ code: 1008, reason: 'Gateway connect challenge invalid' }]);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('passes Gateway challenge facts into the v3 device signature and connect frame', async () => {
    resetSockets();
    const signedRequests: GatewayDeviceChallengeParams[] = [];
    const connection = new GatewayConnection({}, {
      resolvePlatform: async () => 'windows',
      signDeviceChallenge: async (params) => {
        signedRequests.push(params);
        return {
          deviceId: 'device-id',
          publicKey: 'public-key',
          signature: 'signature',
          signedAt: params.signedAt,
          nonce: params.nonce,
        };
      },
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(socket, message, 'daily-connection', ['operator.read', 'operator.write']);
      }
    };
    challenge(socket, 1_735_000_000_456);

    const handshake = await waitForSocketRequest(socket, 'connect');
    assert.deepEqual(signedRequests, [{
      nonce: 'nonce-0',
      signedAt: 1_735_000_000_456,
      clientId: 'openclaw-control-ui',
      clientMode: 'ui',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      token: 'daily-token',
      platform: 'windows',
      deviceFamily: null,
    }]);
    assert.deepEqual(handshake.params.device, {
      id: 'device-id',
      publicKey: 'public-key',
      signature: 'signature',
      signedAt: 1_735_000_000_456,
      nonce: 'nonce-0',
    });

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('fails closed instead of sending connect when device signing is unavailable', async () => {
    resetSockets();
    const connection = new GatewayConnection({}, {
      resolvePlatform: async () => 'linux',
      signDeviceChallenge: async () => { throw new Error('credential store unavailable'); },
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    challenge(socket);
    await turn();

    assert.deepEqual(socket.sent, []);
    assert.deepEqual(socket.closeCalls, [{ code: 4001, reason: 'Gateway handshake failed' }]);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('uses the server tick policy to close a silent socket without sending a ping RPC', async () => {
    resetSockets();
    const connection = new GatewayConnection({ transient: true }, {
      resolvePlatform: async () => 'linux',
      signDeviceChallenge: async (params) => ({
        deviceId: 'watchdog-device',
        publicKey: 'watchdog-public-key',
        signature: 'watchdog-signature',
        signedAt: params.signedAt,
        nonce: params.nonce,
      }),
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(
          socket,
          message,
          'daily-connection',
          ['operator.read', 'operator.write'],
          undefined,
          [],
          4,
          1,
        );
      }
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');
    await wait(2_100);

    assert.equal(socket.sent.some((message) => message.method === 'ping'), false);
    assert.deepEqual(socket.closeCalls, [{ code: 4000, reason: 'Gateway tick timeout' }]);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('rejects payload and buffer overflow before an RPC reaches the Gateway', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection({ transient: true });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(
          socket,
          message,
          'policy-connection',
          ['operator.read', 'operator.write'],
          undefined,
          [],
          4,
          30_000,
          100,
          10,
        );
      }
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');

    await assert.rejects(
      connection.request('sessions.list', { note: 'x'.repeat(200) }),
      (error: unknown) => error instanceof GatewayTransportLifecycleError
        && error.message === 'Gateway request exceeds the server payload limit',
    );
    socket.bufferedAmount = 11;
    await assert.rejects(
      connection.request('sessions.list', {}),
      (error: unknown) => error instanceof GatewayTransportLifecycleError
        && error.message === 'Gateway send buffer exceeds the server limit',
    );
    assert.deepEqual(socket.sent.map((message) => message.method), ['connect']);

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('does not commit state for an incomplete Gateway hello-ok', async () => {
    resetSockets();
    let helloCount = 0;
    const connection = createMemoryGatewayConnection({
      persistDeviceCredential: async (url, token) => {
        savedDeviceTokens.push({ url, token });
      },
    });
    connection.setCallbacks({
      onMessage: () => {},
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onStatusChange: () => {},
      onHello: () => { helloCount += 1; },
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method !== 'connect') return;
      socket.receive({
        type: 'res',
        id: message.id,
        ok: true,
        payload: {
          type: 'hello-ok',
          protocol: 4,
          server: { version: '2026.7.1', connId: 'incomplete' },
          features: { methods: [], events: [] },
          auth: { role: 'operator', scopes: ['operator.read'], deviceToken: 'must-not-save' },
        },
      });
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');
    await turn();

    assert.equal(connection.isConnected(), false);
    assert.equal(helloCount, 0);
    assert.deepEqual(savedDeviceTokens, []);
    assert.deepEqual(socket.closeCalls, [{ code: 4001, reason: 'Gateway handshake failed' }]);

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('accepts a complete hello-ok method discovery payload', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection();
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(
          socket,
          message,
          'daily-connection',
          ['operator.read', 'operator.write'],
          undefined,
          ['audit.activity.list', 'audit.list'],
        );
      }
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');
    assert.equal(connection.getCapabilityEvidence('audit.list')?.state, 'advertised');
    assert.equal(connection.getCapabilityEvidence('tools.catalog'), null);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('仅在 Gateway hello 状态实际变更时发布方法发现', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection();
    const observations: Array<string | null> = [];
    const unsubscribe = connection.subscribeHello((observation) => {
      observations.push(observation?.connectionId ?? null);
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(socket, message, 'history-connection', ['operator.read', 'operator.write'], undefined, [
          'sessions.branches.list',
          'sessions.fork',
        ]);
      }
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');
    await turn();

    assert.deepEqual(observations, ['history-connection']);
    assert.deepEqual(connection.getHelloObservation()?.methods, ['sessions.branches.list', 'sessions.fork']);
    assert.equal(connection.getCapabilitySnapshot().methodsConservative, true);
    assert.equal(connection.getCapabilityEvidence('sessions.branches.list')?.state, 'advertised');

    connection.disconnect();
    stopPolling();
    await turn();
    assert.deepEqual(observations, ['history-connection', null]);
    assert.equal(connection.getCapabilitySnapshot().connectionId, null);
    unsubscribe();
  });

  it('requests only read/write scopes in the daily socket handshake', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection({
      persistDeviceCredential: async (url, token) => {
        savedDeviceTokens.push({ url, token });
      },
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(
          socket,
          message,
          'daily-connection',
          ['operator.read', 'operator.write'],
          'daily-device-token',
        );
      }
    };
    challenge(socket);

    const handshake = await waitForSocketRequest(socket, 'connect');
    assert.deepEqual(handshake.params.scopes, ['operator.read', 'operator.write']);
    assert.deepEqual(handshake.params.auth, { token: 'daily-token' });
    assert.deepEqual(savedDeviceTokens, []);

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('rejects a node-only protocol hello before credential or identity state commits', async () => {
    resetSockets();
    let helloCount = 0;
    let attestedIdentityCount = 0;
    const connection = createMemoryGatewayConnection({
      persistDeviceCredential: async (url, token) => {
        savedDeviceTokens.push({ url, token });
      },
    });
    connection.setCallbacks({
      onMessage: () => {},
      onStreamChunk: () => {},
      onStreamEnd: () => {},
      onStatusChange: () => {},
      onHello: () => { helloCount += 1; },
      onRuntimeIdentity: (identity) => {
        if (identity) attestedIdentityCount += 1;
      },
    });
    connection.connect('ws://127.0.0.1:18789', 'daily-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(
          socket,
          message,
          'incompatible-connection',
          ['operator.read', 'operator.write'],
          'incompatible-device-token',
          ['sessions.subscribe'],
          3,
        );
      }
    };
    challenge(socket);

    const handshake = await waitForSocketRequest(socket, 'connect');
    assert.equal(handshake.params.minProtocol, 4);
    assert.equal(handshake.params.maxProtocol, 4);
    await turn();

    assert.equal(connection.isConnected(), false);
    assert.equal(helloCount, 0);
    assert.equal(attestedIdentityCount, 0);
    assert.deepEqual(savedDeviceTokens, []);
    assert.deepEqual(socket.sent.map((message) => message.method), ['connect']);
    assert.deepEqual(socket.closeCalls, [{ code: 4001, reason: 'Gateway protocol mismatch' }]);

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('saves a rotated device token into the attested instance slot after alias binding', () => {
    const resolver = readFileSync(new URL('./GatewayConnectionTargetResolver.ts', import.meta.url), 'utf8');
    assert.match(resolver, /storeGatewayConnectionDeviceCredential/);
    assert.match(resolver, /if \(boundKey !== endpointKey\) return boundKey/);
    assert.match(resolver, /selectedGatewayRuntimeKey\(gatewayUrl, configured\.credential_scope\)/);
  });

  it('sends a stored device credential through the official deviceToken field', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection();
    connection.connect('ws://127.0.0.1:18789', '', 'paired-device-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(socket, message, 'paired-connection', ['operator.read', 'operator.write']);
      }
    };
    challenge(socket);

    const handshake = await waitForSocketRequest(socket, 'connect');
    assert.deepEqual(handshake.params.auth, {
      token: 'paired-device-token',
      deviceToken: 'paired-device-token',
    });

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('does not rewrite an unchanged device credential after a normal handshake', async () => {
    resetSockets();
    const connection = createMemoryGatewayConnection({
      persistDeviceCredential: async (url, token) => {
        savedDeviceTokens.push({ url, token });
      },
    });
    connection.connect('ws://127.0.0.1:18789', '', 'paired-device-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(socket, message, 'paired-connection', ['operator.read', 'operator.write'], 'paired-device-token');
      }
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');
    await turn();

    assert.deepEqual(savedDeviceTokens, []);
    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('uses one admin-only transient socket for exactly one privileged RPC', async () => {
    resetSockets();
    assert.equal(useGatewayDataStore.getState().polling, false);
    const connectionOptions: GatewayConnectionOptions[] = [];
    const requestPrivileged = requesterWithRealTransientConnections(connectionOptions);
    const resultPromise = requestPrivileged<{ created: boolean }>('agents.create', { id: 'worker' });
    await waitForSocketCount(1);
    const socket = MemoryWebSocket.instances[0];

    socket.onSend = (message) => {
      if (message.method === 'connect') {
        assert.deepEqual(message.params.scopes, ['operator.admin']);
        acceptHandshake(socket, message, 'privileged-1', ['operator.admin'], 'admin-device-token');
        return;
      }
      assert.equal(message.method, 'agents.create');
      socket.receive({ type: 'res', id: message.id, ok: true, payload: { created: true } });
    };
    challenge(socket);

    assert.deepEqual(await resultPromise, { created: true });
    assert.deepEqual(connectionOptions, [{ scopes: ['operator.admin'], transient: true }]);
    assert.deepEqual(savedDeviceTokens, [], 'transient credentials must not be persisted');
    assert.deepEqual(socket.sent.map((message) => message.method), ['connect', 'agents.create']);
    assert.equal(socket.closeCalls.length, 1);
    assert.equal(socket.readyState, MemoryWebSocket.CLOSED);
    await turn();
    assert.equal(MemoryWebSocket.instances.length, 1);
    assert.equal(useGatewayDataStore.getState().polling, false);
  });

  it('uses an approvals-only transient socket for OpenClaw approval RPCs', async () => {
    resetSockets();
    const connectionOptions: GatewayConnectionOptions[] = [];
    const requestApproval = createApprovalRequester(
      sourceConnection(),
      (options) => {
        connectionOptions.push(options);
        return createMemoryGatewayConnection(options);
      },
      { pairingRetryMs: 0, pairingTimeoutMs: 1_000 },
    );
    const resultPromise = requestApproval<{ items: unknown[] }>('approval.history', { limit: 25 });
    await waitForSocketCount(1);
    const socket = MemoryWebSocket.instances[0];

    socket.onSend = (message) => {
      if (message.method === 'connect') {
        assert.deepEqual(message.params.scopes, ['operator.approvals']);
        acceptHandshake(socket, message, 'approval-1', ['operator.approvals'], 'approval-device-token');
        return;
      }
      assert.equal(message.method, 'approval.history');
      socket.receive({ type: 'res', id: message.id, ok: true, payload: { items: [] } });
    };
    challenge(socket);

    assert.deepEqual(await resultPromise, { items: [] });
    assert.deepEqual(connectionOptions, [{ scopes: ['operator.approvals'], transient: true }]);
    assert.deepEqual(savedDeviceTokens, [], 'transient credentials must not be persisted');
    assert.equal(socket.closeCalls.length, 1);
    assert.equal(socket.readyState, MemoryWebSocket.CLOSED);
  });

  it('preserves a Windows scope-upgrade request through the privileged handshake', async () => {
    resetSockets();
    const surfacedIssues: GatewayAuthorizationIssue[] = [];
    const unsubscribe = subscribePrivilegedAuthorizationIssues((issue) => {
      surfacedIssues.push(issue);
    });
    let resolved = 0;
    const unsubscribeResolved = subscribePrivilegedAuthorizationResolved(() => {
      resolved += 1;
    });
    const requestPrivileged = requesterWithRealTransientConnections();
    const resultPromise = requestPrivileged('wizard.start', { mode: 'local' });
    await waitForSocketCount(1);
    const socket = MemoryWebSocket.instances[0];

    socket.onSend = (message) => {
      if (message.method !== 'connect') return;
      socket.receive({
        type: 'res',
        id: message.id,
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'pairing required',
          details: {
            code: 'PAIRING_REQUIRED',
            reason: 'scope-upgrade',
            requestId: 'windows-admin-request',
            recommendedNextStep: 'approve_pairing',
          },
        },
      });
    };
    challenge(socket);

    await waitForSocketCount(2);
    const approvedSocket = MemoryWebSocket.instances[1];
    approvedSocket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(approvedSocket, message, 'privileged-approved', ['operator.admin']);
        return;
      }
      assert.equal(message.method, 'wizard.start');
      approvedSocket.receive({ type: 'res', id: message.id, ok: true, payload: { sessionId: 'wizard-1' } });
    };
    challenge(approvedSocket);

    assert.deepEqual(await resultPromise, { sessionId: 'wizard-1' });
    unsubscribe();
    unsubscribeResolved();
    assert.equal(surfacedIssues.at(-1)?.requestId, 'windows-admin-request');
    assert.equal(socket.readyState, MemoryWebSocket.CLOSED);
    assert.equal(resolved, 1);
    assert.deepEqual(socket.sent.map((message) => message.method), ['connect']);
    assert.deepEqual(approvedSocket.sent.map((message) => message.method), ['connect', 'wizard.start']);
  });

  it('can retry privileged authorization immediately after JunQi confirms local approval', async () => {
    resetSockets();
    const requestPrivileged = createPrivilegedRequester(
      sourceConnection(),
      (connectionOptions) => createMemoryGatewayConnection(connectionOptions),
      { pairingRetryMs: 60_000, pairingTimeoutMs: 120_000 },
    );
    let pairingSurfaced = false;
    const unsubscribe = subscribePrivilegedAuthorizationIssues(() => {
      pairingSurfaced = true;
    });
    const resultPromise = requestPrivileged('wizard.start', { mode: 'local' });
    await waitForSocketCount(1);
    const pairingSocket = MemoryWebSocket.instances[0];
    pairingSocket.onSend = (message) => {
      if (message.method !== 'connect') return;
      pairingSocket.receive({
        type: 'res',
        id: message.id,
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'pairing required',
          details: { code: 'PAIRING_REQUIRED', requestId: 'local-approval' },
        },
      });
    };
    challenge(pairingSocket);
    const issueDeadline = Date.now() + 2_000;
    while (!pairingSurfaced && Date.now() < issueDeadline) await wait(5);
    assert.equal(pairingSurfaced, true);

    requestPrivileged.retryPairingNow();
    await waitForSocketCount(2);
    const approvedSocket = MemoryWebSocket.instances[1];
    approvedSocket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(approvedSocket, message, 'approved-immediately', ['operator.admin']);
        return;
      }
      approvedSocket.receive({ type: 'res', id: message.id, ok: true, payload: { sessionId: 'wizard-1' } });
    };
    challenge(approvedSocket);

    assert.deepEqual(await resultPromise, { sessionId: 'wizard-1' });
    unsubscribe();
    assert.deepEqual(approvedSocket.sent.map((message) => message.method), ['connect', 'wizard.start']);
  });

  it('fails closed when the daily Gateway identity changes during privileged pairing', async () => {
    resetSockets();
    let connectionId = 'daily-connection';
    const source = {
      ...sourceConnection(),
      getAttestedConnectionId: () => connectionId,
    };
    const requestPrivileged = createPrivilegedRequester(
      source,
      (connectionOptions) => createMemoryGatewayConnection(connectionOptions),
      { pairingRetryMs: 0, pairingTimeoutMs: 1_000 },
    );
    const resultPromise = requestPrivileged('wizard.start', { mode: 'local' });
    await waitForSocketCount(1);
    const pairingSocket = MemoryWebSocket.instances[0];
    pairingSocket.onSend = (message) => {
      if (message.method !== 'connect') return;
      connectionId = 'replacement-connection';
      pairingSocket.receive({
        type: 'res',
        id: message.id,
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'pairing required',
          details: { code: 'PAIRING_REQUIRED', requestId: 'stale-request' },
        },
      });
    };
    challenge(pairingSocket);

    await assert.rejects(resultPromise, /verified Gateway connection changed/);
    assert.equal(MemoryWebSocket.instances.length, 1, 'a stale source must not open a retry socket');
    assert.deepEqual(pairingSocket.sent.map((message) => message.method), ['connect']);
  });

  it('cancels an active privileged pairing retry without dispatching the RPC', async () => {
    resetSockets();
    const requestPrivileged = createPrivilegedRequester(
      sourceConnection(),
      (connectionOptions) => createMemoryGatewayConnection(connectionOptions),
      { pairingRetryMs: 60_000, pairingTimeoutMs: 120_000 },
    );
    const resultPromise = requestPrivileged('wizard.next', { sessionId: 'wizard-1' }, null);
    await waitForSocketCount(1);
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method !== 'connect') return;
      socket.receive({
        type: 'res',
        id: message.id,
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'pairing required',
          details: { code: 'PAIRING_REQUIRED', requestId: 'cancel-request' },
        },
      });
    };
    challenge(socket);
    await waitForSocketRequest(socket, 'connect');
    await turn();
    requestPrivileged.cancelPairingRetry();

    await assert.rejects(resultPromise, /authorization was cancelled/);
    assert.deepEqual(socket.sent.map((message) => message.method), ['connect']);
    assert.equal(MemoryWebSocket.instances.length, 1);
  });

  it('serializes admin requests without polling, reconnecting, or changing runtime identity', async () => {
    resetSockets();
    const preservedIdentity = { connectionId: 'daily-connection' } as RuntimeIdentity;
    const observation = buildGatewayHelloObservation('ws://127.0.0.1:18789', {
      type: 'hello-ok',
      protocol: 4,
      server: { version: '2026.7.1', connId: preservedIdentity.connectionId },
      auth: { role: 'operator', scopes: ['operator.read', 'operator.write'] },
    });
    await observeGatewayHello(observation, async () => preservedIdentity);

    const requestPrivileged = requesterWithRealTransientConnections();
    const firstResult = requestPrivileged<string>('admin.first', {});
    const secondResult = requestPrivileged<string>('admin.second', {});
    await waitForSocketCount(1);

    const firstSocket = MemoryWebSocket.instances[0];
    firstSocket.onSend = (message) => {
      if (message.method === 'connect') acceptHandshake(firstSocket, message, 'privileged-first');
    };
    challenge(firstSocket);
    const firstRpc = await waitForSocketRequest(firstSocket, 'admin.first');
    assert.equal(firstRpc.method, 'admin.first');
    await turn();
    assert.equal(MemoryWebSocket.instances.length, 1, 'second request must wait for the first');

    firstSocket.receive({ type: 'res', id: firstRpc.id, ok: true, payload: 'first' });
    assert.equal(await firstResult, 'first');
    await waitForSocketCount(2);

    const secondSocket = MemoryWebSocket.instances[1];
    secondSocket.onSend = (message) => {
      if (message.method === 'connect') acceptHandshake(secondSocket, message, 'privileged-second');
    };
    challenge(secondSocket);
    const secondRpc = await waitForSocketRequest(secondSocket, 'admin.second');
    assert.equal(secondRpc.method, 'admin.second');
    secondSocket.receive({ type: 'res', id: secondRpc.id, ok: true, payload: 'second' });
    assert.equal(await secondResult, 'second');

    assert.deepEqual(
      MemoryWebSocket.instances.map((socket) => socket.sent.map((message) => message.method)),
      [['connect', 'admin.first'], ['connect', 'admin.second']],
    );
    assert.ok(MemoryWebSocket.instances.every((socket) => socket.closeCalls.length === 1));
    assert.equal(getCurrentRuntimeIdentity(), preservedIdentity);
    await turn();
    assert.equal(MemoryWebSocket.instances.length, 2, 'transient close must not reconnect');
    await invalidateGatewayRuntimeIdentity(preservedIdentity.connectionId, async () => true);
  });

  it('expires a queued admin request from enqueue time and never dispatches it later', async () => {
    resetSockets();
    const requestPrivileged = requesterWithRealTransientConnections();
    const firstResult = requestPrivileged('wizard.next', { sessionId: 'stale' }, null);
    await waitForSocketCount(1);

    const firstSocket = MemoryWebSocket.instances[0];
    firstSocket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(firstSocket, message, 'privileged-stale');
      }
      // Keep the Wizard RPC pending to reproduce a stale serialized lane.
    };
    challenge(firstSocket);
    await waitForSocketRequest(firstSocket, 'wizard.next');
    assert.deepEqual(firstSocket.sent.map((message) => message.method), ['connect', 'wizard.next']);

    const queuedResult = requestPrivileged('wizard.status', { sessionId: 'replacement' }, 1_000);
    await assert.rejects(queuedResult, /Request timeout \(1000ms\)/);
    assert.equal(MemoryWebSocket.instances.length, 1, 'expired queued request must not dispatch');

    requestPrivileged.cancelActiveRequest();
    await assert.rejects(firstResult, /authorization was cancelled/);
    await turn();
    assert.equal(MemoryWebSocket.instances.length, 1, 'expired queued request must not dispatch after lane release');
  });

  it('disconnects the transient socket when the privileged RPC fails', async () => {
    resetSockets();
    const requestPrivileged = requesterWithRealTransientConnections();
    const resultPromise = requestPrivileged('agents.delete', { agentId: 'worker' });
    await waitForSocketCount(1);
    const socket = MemoryWebSocket.instances[0];

    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(socket, message, 'privileged-failure');
        return;
      }
      socket.receive({
        type: 'res',
        id: message.id,
        ok: false,
        error: { code: 'MUTATION_FAILED', message: 'mutation failed' },
      });
    };
    challenge(socket);

    await assert.rejects(resultPromise, /mutation failed/);
    assert.deepEqual(socket.sent.map((message) => message.method), ['connect', 'agents.delete']);
    assert.equal(socket.closeCalls.length, 1);
    assert.equal(socket.readyState, MemoryWebSocket.CLOSED);
    await turn();
    assert.equal(MemoryWebSocket.instances.length, 1);
  });

  it('does not persist a Gateway token from settings or setup', () => {
    const settings = source('src/stores/settingsStore.ts');
    const setup = sourceDirTs('src/hooks/useSetupFlow');
    assert.doesNotMatch(settings, /localStorage\.setItem\(['"]aegis-gateway-token/);
    assert.doesNotMatch(setup, /gatewayToken:\s*token/);
  });

  it('keeps the native Gateway credential path free of file fallbacks', () => {
    const rust = source('src-tauri/src/commands/gateway_credentials.rs');
    assert.doesNotMatch(rust, /std::fs::(write|read_to_string)|secrets_file_path/);
    assert.match(rust, /GatewayCredentialPersistence::SessionOnly/);
    assert.match(rust, /GatewayCredentialPersistence::Unsupported/);
  });

  it('never edits OpenClaw device approval files to elevate scopes', () => {
    const gateway = source('src-tauri/src/commands/gateway.rs');
    assert.doesNotMatch(gateway, /devices["']?\)\.join\(["']paired\.json/);
    assert.doesNotMatch(gateway, /approvedScopes|ensure_paired_devices_full_scopes/);
  });

  it('resolves the active OpenClaw config before cached Gateway credentials', () => {
    const resolver = source('src/services/gateway/GatewayConnectionTargetResolver.ts');
    const start = resolver.indexOf('export async function resolveGatewayConnectionTarget');
    const body = resolver.slice(start);
    assert.ok(body.indexOf('await dependencies.detectConfig()') < body.indexOf('await deviceCredential('));
    assert.doesNotMatch(resolver, /ConfigResolverChain|EventPayloadResolver|CachedTokenResolver/);
  });

  it('does not retain a legacy credential migration path', () => {
    const resolver = source('src/services/gateway/GatewayConnectionTargetResolver.ts');
    const provider = source('src/services/gateway/credentialProvider.ts');
    assert.doesNotMatch(resolver, /legacy credential|migrateCredential|getLegacyCredential|deleteLegacyCredential/i);
    assert.doesNotMatch(provider, /migrateLegacyGatewayCredential|LEGACY_GATEWAY_/);
  });

  it('never falls back to the local shared token for an arbitrary pairing endpoint', () => {
    const adapter = source('src/api/tauri-adapter.ts');
    const start = adapter.indexOf('getToken: async (gatewayUrl?: string)');
    const end = adapter.indexOf('saveToken: async', start);
    const getToken = adapter.slice(start, end);
    assert.doesNotMatch(getToken, /get_gateway_token/);

    const manager = source('src/services/gateway/GatewayConnectionManager.ts');
    assert.match(manager, /gateway\.connect\(url, token, deviceToken\)/);
  });
});
