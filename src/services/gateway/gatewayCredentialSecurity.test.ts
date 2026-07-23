import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { stopPolling, useGatewayDataStore } from '@/stores/gatewayDataStore';
import type { RuntimeIdentity } from '@/types/gatewayRuntime';
import { GatewayConnection, type GatewayConnectionOptions } from './Connection';
import type { GatewayAuthorizationIssue } from './messageRouter';
import {
  createPrivilegedRequester,
  GatewayPrivilegedAuthorizationError,
  subscribePrivilegedAuthorizationIssues,
} from './index';
import {
  buildGatewayHelloObservation,
  getCurrentRuntimeIdentity,
  invalidateGatewayRuntimeIdentity,
  observeGatewayHello,
} from './runtimeIdentity';

const source = (path: string) => readFileSync(path, 'utf8');

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
const originalAegis = window.aegis;
const savedDeviceTokens: Array<{ token: string; url: string }> = [];
(window as any).aegis = {
  ...originalAegis,
  pairing: {
    ...originalAegis?.pairing,
    async saveToken(token: string, url: string) {
      savedDeviceTokens.push({ token, url });
    },
  },
};

after(() => {
  if (originalWebSocket) Object.defineProperty(globalThis, 'WebSocket', originalWebSocket);
  else Reflect.deleteProperty(globalThis, 'WebSocket');
  (window as any).aegis = originalAegis;
});

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

async function waitForSocketCount(count: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (MemoryWebSocket.instances.length === count) return;
    await turn();
  }
  assert.equal(MemoryWebSocket.instances.length, count);
}

function challenge(socket: MemoryWebSocket) {
  socket.open();
  socket.receive({
    type: 'event',
    event: 'connect.challenge',
    payload: { nonce: `nonce-${MemoryWebSocket.instances.indexOf(socket)}` },
  });
}

function acceptHandshake(
  socket: MemoryWebSocket,
  request: WireRequest,
  connectionId: string,
  scopes = ['operator.admin'],
  deviceToken?: string,
) {
  socket.receive({
    type: 'res',
    id: request.id,
    ok: true,
    payload: {
      type: 'hello-ok',
      protocol: 4,
      server: { version: '2026.7.1', connId: connectionId },
      features: { methods: [], events: [] },
      auth: { role: 'operator', scopes, ...(deviceToken ? { deviceToken } : {}) },
    },
  });
}

function sourceConnection() {
  return {
    isConnected: () => true,
    url: 'ws://127.0.0.1:18789',
    token: 'gateway-token',
    deviceToken: '',
  };
}

function requesterWithRealTransientConnections(options: GatewayConnectionOptions[] = []) {
  return createPrivilegedRequester(sourceConnection(), (connectionOptions) => {
    options.push(connectionOptions);
    return new GatewayConnection(connectionOptions);
  });
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
  it('requests only read/write scopes in the daily socket handshake', async () => {
    resetSockets();
    const connection = new GatewayConnection();
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

    const handshake = socket.sent.find((message) => message.method === 'connect');
    assert.deepEqual(handshake?.params.scopes, ['operator.read', 'operator.write']);
    assert.deepEqual(handshake?.params.auth, { token: 'daily-token' });
    assert.deepEqual(savedDeviceTokens, [{
      token: 'daily-device-token',
      url: 'ws://127.0.0.1:18789',
    }]);

    connection.disconnect();
    stopPolling();
    await turn();
  });

  it('sends a stored device credential through the official deviceToken field', async () => {
    resetSockets();
    const connection = new GatewayConnection();
    connection.connect('ws://127.0.0.1:18789', '', 'paired-device-token');
    const socket = MemoryWebSocket.instances[0];
    socket.onSend = (message) => {
      if (message.method === 'connect') {
        acceptHandshake(socket, message, 'paired-connection', ['operator.read', 'operator.write']);
      }
    };
    challenge(socket);

    const handshake = socket.sent.find((message) => message.method === 'connect');
    assert.deepEqual(handshake?.params.auth, {
      token: 'paired-device-token',
      deviceToken: 'paired-device-token',
    });

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

  it('preserves a Windows scope-upgrade request through the privileged handshake', async () => {
    resetSockets();
    const surfacedIssues: GatewayAuthorizationIssue[] = [];
    const unsubscribe = subscribePrivilegedAuthorizationIssues((issue) => {
      surfacedIssues.push(issue);
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

    await assert.rejects(resultPromise, (error: unknown) => {
      assert.ok(error instanceof GatewayPrivilegedAuthorizationError);
      assert.equal(error.issue.kind, 'pairing_required');
      assert.equal(error.issue.requestId, 'windows-admin-request');
      assert.match(error.message, /openclaw devices approve windows-admin-request/);
      return true;
    });
    unsubscribe();
    assert.equal(surfacedIssues.at(-1)?.requestId, 'windows-admin-request');
    assert.equal(socket.readyState, MemoryWebSocket.CLOSED);
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
    const firstRpcs: WireRequest[] = [];
    firstSocket.onSend = (message) => {
      if (message.method === 'connect') acceptHandshake(firstSocket, message, 'privileged-first');
      else firstRpcs.push(message);
    };
    challenge(firstSocket);
    const firstRpc = firstRpcs[0];
    assert.ok(firstRpc);
    assert.equal(firstRpc.method, 'admin.first');
    await turn();
    assert.equal(MemoryWebSocket.instances.length, 1, 'second request must wait for the first');

    firstSocket.receive({ type: 'res', id: firstRpc.id, ok: true, payload: 'first' });
    assert.equal(await firstResult, 'first');
    await waitForSocketCount(2);

    const secondSocket = MemoryWebSocket.instances[1];
    const secondRpcs: WireRequest[] = [];
    secondSocket.onSend = (message) => {
      if (message.method === 'connect') acceptHandshake(secondSocket, message, 'privileged-second');
      else secondRpcs.push(message);
    };
    challenge(secondSocket);
    const secondRpc = secondRpcs[0];
    assert.ok(secondRpc);
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
    const setup = source('src/hooks/useSetupFlow.ts');
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
    const adapter = source('src/api/tauri-adapter.ts');
    const start = adapter.indexOf('const chain = new ConfigResolverChain');
    const end = adapter.indexOf('const result = await chain.resolve()', start);
    const resolvers = adapter.slice(start, end);
    assert.ok(resolvers.indexOf('new FileReadResolver') < resolvers.indexOf('new EventPayloadResolver'));
    assert.ok(resolvers.indexOf('new EventPayloadResolver') < resolvers.indexOf('new CachedTokenResolver'));
  });

  it('migrates the 1.2.33 credential slot before deleting the legacy copy', () => {
    const adapter = source('src/api/tauri-adapter.ts');
    const start = adapter.indexOf('async function migrateNativeLegacyGatewayCredential');
    const end = adapter.indexOf('// Upgrade migration', start);
    const migration = adapter.slice(start, end);
    const storeIndex = migration.indexOf('await storeGatewayDeviceCredential');
    const persistenceIndex = migration.indexOf("credential.persistence === 'system'");
    const deleteIndex = migration.indexOf("delete_legacy_gateway_credential");
    assert.ok(storeIndex >= 0 && storeIndex < persistenceIndex);
    assert.ok(persistenceIndex < deleteIndex);
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
