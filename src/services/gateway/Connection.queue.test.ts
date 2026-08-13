import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollaborationClient, CollaborationClientError } from '@/services/collaboration/client';
import {
  GatewayConnection,
  GatewayConnectionFenceError,
  GatewayRequestAbortedError,
  GatewayRpcError,
  platformFromNativeOs,
  platformFromWebView,
  resolveGatewayClientPlatform,
} from './Connection';
import { GatewayTransportLifecycleError } from './GatewayTransportError';

function failedGatewayCall(
  connection: GatewayConnection,
  error: Record<string, unknown>,
): Promise<unknown> {
  const transport = connection as any;
  return new Promise((resolve, reject) => {
    transport.registerCallback('rpc-error', { resolve, reject });
    transport.handleMessage({ type: 'res', id: 'rpc-error', ok: false, error });
  });
}

describe('GatewayConnection request identity', () => {
  it('replays an exhausted retry state to a late convergence subscriber', () => {
    const connection = new GatewayConnection();
    const transport = connection as unknown as {
      emitRetryState: (phase: 'exhausted', extra: { error: string }) => void;
    };
    transport.emitRetryState('exhausted', { error: 'selected runtime credential unavailable' });

    let diagnostic = '';
    const unsubscribe = connection.subscribeRetryState((state) => {
      if (state.phase === 'exhausted') diagnostic = state.error ?? '';
    });

    assert.equal(diagnostic, 'selected runtime credential unavailable');
    assert.equal(connection.getRetryState().phase, 'exhausted');
    unsubscribe();
  });

  it('prefers the native desktop platform and never guesses an unknown host is Windows', async () => {
    assert.equal(platformFromNativeOs('darwin'), 'macos');
    assert.equal(platformFromNativeOs('windows'), 'windows');
    assert.equal(platformFromNativeOs('linux'), 'linux');
    assert.equal(platformFromNativeOs('freebsd'), 'unknown');
    assert.equal(platformFromWebView({ userAgent: 'unrecognized host', platform: 'unknown' }), 'unknown');
    assert.equal(
      await resolveGatewayClientPlatform(
        async () => ({ os: 'linux', arch: 'x86_64' }),
        { userAgent: 'Windows WebView', platform: 'Win32' },
      ),
      'linux',
    );
    assert.equal(
      await resolveGatewayClientPlatform(
        async () => { throw new Error('Tauri unavailable'); },
        { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', platform: 'Linux x86_64' },
      ),
      'linux',
    );
  });

  it('does not send an old handshake after its socket is replaced during platform lookup', async () => {
    let resolvePlatform!: (platform: 'linux') => void;
    const platform = new Promise<'linux'>((resolve) => { resolvePlatform = resolve; });
    const connection = new GatewayConnection({}, { resolvePlatform: () => platform }) as any;
    const sent: unknown[] = [];
    const originalSocket = { send: (value: string) => sent.push(JSON.parse(value)), close: () => undefined };
    const replacementSocket = { send: (value: string) => sent.push(JSON.parse(value)), close: () => undefined };
    connection.ws = originalSocket;
    connection.connecting = true;
    connection.challengeNonce = null;
    connection.target = {
      url: 'ws://old-target',
      token: 'old-target-token',
      deviceToken: '',
    };

    const pending = connection.sendHandshake();
    await Promise.resolve();
    connection.ws = replacementSocket;
    connection.handshakeRequestId = 'replacement-handshake';
    resolvePlatform('linux');
    await pending;

    assert.deepEqual(sent, []);
    connection.disconnect();
  });

  it('uses the recoverable transport contract before connect and for pending disconnects', async () => {
    const connection = new GatewayConnection();
    await assert.rejects(
      connection.request('sessions.list', {}),
      (error: unknown) => error instanceof GatewayTransportLifecycleError
        && error.message === 'Gateway is not connected',
    );

    const pending = new Promise((resolve, reject) => {
      connection.registerCallback('pending-disconnect', { resolve, reject });
    });
    connection.disconnect();
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof GatewayTransportLifecycleError
        && error.message === 'Gateway connection closed',
    );
  });

  it('rejects an identity-fenced request before sending on a different connection', async () => {
    const connection = new GatewayConnection() as any;
    let sends = 0;
    connection.ws = {
      readyState: WebSocket.OPEN,
      send: () => { sends += 1; },
      close: () => undefined,
    };
    connection.connected = true;
    connection.runtimeIdentityConnectionId = 'connection-new';

    await assert.rejects(
      connection.requestFenced('sessions.reset', { key: 'session' }, 'connection-old'),
      (error: unknown) => error instanceof GatewayConnectionFenceError
        && error.expectedConnectionId === 'connection-old'
        && error.actualConnectionId === 'connection-new',
    );
    assert.equal(sends, 0);
    connection.disconnect();
  });

  it('does not treat a hello-ok method omission as a transport denial', async () => {
    const connection = new GatewayConnection() as any;
    const sent: unknown[] = [];
    connection.ws = {
      readyState: WebSocket.OPEN,
      send: (value: string) => { sent.push(JSON.parse(value)); },
      close: () => undefined,
    };
    connection.connected = true;
    connection.runtimeIdentityConnectionId = 'connection-1';
    const regular = connection.request('sessions.delete', { key: 'session' });
    assert.equal(sent.length, 1);
    connection.handleMessage({ type: 'res', id: (sent[0] as { id: string }).id, ok: true, payload: {} });
    await regular;

    const fenced = connection.requestFenced('sessions.delete', { key: 'session' }, 'connection-1');
    assert.equal(sent.length, 2);
    connection.handleMessage({ type: 'res', id: (sent[1] as { id: string }).id, ok: true, payload: {} });
    await fenced;

    assert.equal(connection.pendingRequests.size, 0);
    assert.equal(connection.msgCounter, 2);
    connection.disconnect();
  });

  it('uses AbortSignal to stop waiting locally without claiming remote cancellation', async () => {
    const connection = new GatewayConnection() as any;
    const sent: any[] = [];
    connection.ws = {
      readyState: WebSocket.OPEN,
      send: (value: string) => { sent.push(JSON.parse(value)); },
      close: () => undefined,
    };
    connection.connected = true;
    const controller = new AbortController();
    const request = connection.request('sessions.steer', { key: 'session', message: 'continue' }, {
      signal: controller.signal,
    });
    assert.equal(sent.length, 1);
    controller.abort();
    await assert.rejects(request, (error: unknown) => error instanceof GatewayRequestAbortedError);
    connection.handleMessage({ type: 'res', id: sent[0].id, ok: true, payload: { runId: 'run-1', status: 'started' } });
    connection.disconnect();
  });

  it('rejects a fenced response if the attested connection changes after send', async () => {
    const connection = new GatewayConnection() as any;
    const sent: any[] = [];
    const socket = {
      readyState: WebSocket.OPEN,
      send: (value: string) => { sent.push(JSON.parse(value)); },
      close: () => undefined,
    };
    connection.ws = socket;
    connection.connected = true;
    connection.runtimeIdentityConnectionId = 'connection-1';

    const request = connection.requestFenced(
      'sessions.delete',
      { key: 'session', expectedSessionId: 'session-1' },
      'connection-1',
    );
    assert.equal(sent.length, 1);
    connection.runtimeIdentityConnectionId = 'connection-2';
    connection.handleMessage({ type: 'res', id: sent[0].id, ok: true, payload: { success: true } });

    await assert.rejects(
      request,
      (error: unknown) => error instanceof GatewayConnectionFenceError
        && error.actualConnectionId === 'connection-2',
    );
    connection.disconnect();
  });

  it('rejects a fenced error response if the attested connection changes after send', async () => {
    const connection = new GatewayConnection() as any;
    const sent: any[] = [];
    const socket = {
      readyState: WebSocket.OPEN,
      send: (value: string) => { sent.push(JSON.parse(value)); },
      close: () => undefined,
    };
    connection.ws = socket;
    connection.connected = true;
    connection.runtimeIdentityConnectionId = 'connection-1';

    const request = connection.requestFenced(
      'sessions.delete',
      { key: 'session', expectedSessionId: 'session-1' },
      'connection-1',
    );
    assert.equal(sent.length, 1);
    connection.runtimeIdentityConnectionId = 'connection-2';
    connection.handleMessage({
      type: 'res',
      id: sent[0].id,
      ok: false,
      error: { code: 'INVALID_REQUEST', message: 'stale request' },
    });

    await assert.rejects(
      request,
      (error: unknown) => error instanceof GatewayConnectionFenceError
        && error.actualConnectionId === 'connection-2',
    );
    connection.disconnect();
  });

  it('preserves the stable Gateway RPC error contract without exposing envelope fields', async () => {
    const connection = new GatewayConnection();

    await assert.rejects(
      failedGatewayCall(connection, {
        code: 'REVISION_CONFLICT',
        message: 'stale run',
        details: { currentRevision: 8 },
        internal: { gatewayToken: 'must-not-propagate' },
      }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayRpcError);
        assert.ok(error instanceof Error);
        assert.equal(error.code, 'REVISION_CONFLICT');
        assert.equal(error.message, 'stale run');
        assert.equal(String(error), 'stale run');
        assert.deepEqual(error.details, { currentRevision: 8 });
        assert.equal('internal' in error, false);
        return true;
      },
    );
  });

  it('delivers structured Gateway errors to CollaborationClient normalization', async () => {
    const connection = new GatewayConnection();
    const client = new CollaborationClient(() => failedGatewayCall(connection, {
      code: 'ACTIVE_RUN_EXISTS',
      message: 'session already has an active run',
      details: { existingRunId: 'run-active' },
    }));

    await assert.rejects(
      client.listRunsBySession({ sessionKey: 'agent:main:desktop', sessionId: 'session-1' }),
      (error: unknown) => {
        assert.ok(error instanceof CollaborationClientError);
        assert.equal(error.code, 'ACTIVE_RUN_EXISTS');
        assert.equal(error.message, 'session already has an active run');
        assert.deepEqual(error.details, { existingRunId: 'run-active' });
        assert.ok(error.originalError instanceof GatewayRpcError);
        return true;
      },
    );
  });
});
