import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CollaborationClient, CollaborationClientError } from '@/services/collaboration/client';
import {
  GatewayConnection,
  GatewayConnectionFenceError,
  GatewayMessageQueueFullError,
  GatewayRpcError,
} from './Connection';

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

describe('GatewayConnection offline queue identity', () => {
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

  it('flushes the original idempotency key and session id', async () => {
    const connection = new GatewayConnection() as any;
    const payloads: any[] = [];
    connection.request = async (method: string, payload: any) => {
      payloads.push({ method, payload });
      return { ok: true };
    };

    connection.enqueueMessage('hello', undefined, 'agent:main:main', 'client-message-1', 'session-1');
    await connection.flushQueue();

    assert.deepEqual(payloads, [{
      method: 'chat.send',
      payload: {
        sessionKey: 'agent:main:main',
        message: 'hello',
        idempotencyKey: 'client-message-1',
        sessionId: 'session-1',
      },
    }]);
    assert.equal(connection.getQueueSize(), 0);
  });

  it('keeps the failed item and untouched tail in their original order', async () => {
    const connection = new GatewayConnection() as any;
    connection.enqueueMessage('one', undefined, 'session', 'id-1');
    connection.enqueueMessage('two', undefined, 'session', 'id-2');
    connection.enqueueMessage('three', undefined, 'session', 'id-3');
    connection.request = async () => { throw new Error('offline'); };

    await connection.flushQueue();
    assert.equal(connection.getQueueSize(), 3);

    const ids: string[] = [];
    connection.request = async (_method: string, payload: any) => {
      ids.push(payload.idempotencyKey);
      return { ok: true };
    };
    await connection.flushQueue();

    assert.deepEqual(ids, ['id-1', 'id-2', 'id-3']);
  });

  it('rejects queue overflow without silently evicting an acknowledged queued message', async () => {
    const connection = new GatewayConnection() as any;
    connection.MAX_QUEUE_SIZE = 2;
    connection.enqueueMessage('one', undefined, 'session', 'id-1');
    connection.enqueueMessage('two', undefined, 'session', 'id-2');

    assert.throws(
      () => connection.enqueueMessage('three', undefined, 'session', 'id-3'),
      (error: unknown) => error instanceof GatewayMessageQueueFullError
        && error.code === 'GATEWAY_MESSAGE_QUEUE_FULL'
        && error.limit === 2,
    );
    assert.equal(connection.getQueueSize(), 2);

    const ids: string[] = [];
    connection.request = async (_method: string, payload: any) => {
      ids.push(payload.idempotencyKey);
      return { ok: true };
    };
    await connection.flushQueue();

    assert.deepEqual(ids, ['id-1', 'id-2']);
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
