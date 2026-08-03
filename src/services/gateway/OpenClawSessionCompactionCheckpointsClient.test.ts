import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError } from './Connection';
import {
  OpenClawCompactionCheckpointsResponseError,
  OpenClawCompactionCheckpointsUnavailableError,
  OpenClawSessionCompactionCheckpointsClient,
} from './OpenClawSessionCompactionCheckpointsClient';

const checkpoint = {
  checkpointId: 'checkpoint-1',
  sessionKey: 'agent:main:main',
  sessionId: 'session-1',
  createdAt: 1_700_000_000_000,
  reason: 'manual',
  tokensBefore: 20_000,
  tokensAfter: 2_000,
  summary: 'A Gateway summary.',
  preCompaction: { sessionId: 'session-1', entryId: 'entry-before' },
  postCompaction: { sessionId: 'session-1', entryId: 'entry-after' },
};

test('reads Gateway compaction checkpoint metadata through a fenced official request', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    hasAdvertisedMethod: () => true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return { ok: true, key: 'agent:main:main', checkpoints: [checkpoint] };
    },
  });

  assert.deepEqual(await client.list(' agent:main:main '), [checkpoint]);
  assert.deepEqual(calls, [{
    method: 'sessions.compaction.list',
    params: { key: 'agent:main:main' },
    connectionId: 'gateway-a',
  }]);
});

test('preserves an official safe-integer checkpoint timestamp for the UI to validate', async () => {
  const client = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => ({
      ok: true,
      key: 'agent:main:main',
      checkpoints: [{ ...checkpoint, createdAt: Number.MAX_SAFE_INTEGER }],
    }),
  });

  const [result] = await client.list('agent:main:main');
  assert.equal(result?.createdAt, Number.MAX_SAFE_INTEGER);
});

test('fails closed for invalid checkpoint metadata and does not retain a local replacement', async () => {
  const client = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => ({ ok: true, key: 'agent:main:main', checkpoints: [{ ...checkpoint, reason: 'legacy' }] }),
  });

  await assert.rejects(client.list('agent:main:main'), OpenClawCompactionCheckpointsResponseError);
});

test('does not send unadvertised checkpoint methods and fences disconnected responses', async () => {
  const unsupported = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => false,
    requestFenced: async () => { throw new Error('must not request'); },
  });
  const disconnected = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    hasAdvertisedMethod: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unsupported.list('agent:main:main'), OpenClawCompactionCheckpointsUnavailableError);
  await assert.rejects(disconnected.list('agent:main:main'), OpenClawCompactionCheckpointsUnavailableError);
});
