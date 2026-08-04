import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayDisconnectedError } from './Connection';
import {
  OpenClawCompactionCheckpointsResponseError,
  OpenClawCompactionCheckpointsUnavailableError,
  OpenClawSessionCompactionCheckpointsClient,
} from './OpenClawSessionCompactionCheckpointsClient';
import { OpenClawSessionTargetError } from './OpenClawSessionTarget';

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

test('在读取连接或 Gateway 请求前拒绝缺失检查点会话目标', async () => {
  let capturedConnection = false;
  let requested = false;
  const client = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => {
      capturedConnection = true;
      return 'gateway-a';
    },
    isConnectionCurrent: () => true,
    requestFenced: async () => {
      requested = true;
      return {};
    },
  });

  await assert.rejects(client.list('   '), OpenClawSessionTargetError);
  assert.equal(capturedConnection, false);
  assert.equal(requested, false);
});

test('preserves an official safe-integer checkpoint timestamp for the UI to validate', async () => {
  const client = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
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
    requestFenced: async () => ({ ok: true, key: 'agent:main:main', checkpoints: [{ ...checkpoint, reason: 'legacy' }] }),
  });

  await assert.rejects(client.list('agent:main:main'), OpenClawCompactionCheckpointsResponseError);
});

test('sends despite discovery omission and fences disconnected responses', async () => {
  let omittedMethodSent = false;
  const unsupported = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => {
      omittedMethodSent = true;
      throw new GatewayDisconnectedError();
    },
  });
  const disconnected = new OpenClawSessionCompactionCheckpointsClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new GatewayDisconnectedError(); },
  });

  await assert.rejects(unsupported.list('agent:main:main'), OpenClawCompactionCheckpointsUnavailableError);
  await assert.rejects(disconnected.list('agent:main:main'), OpenClawCompactionCheckpointsUnavailableError);
  assert.equal(omittedMethodSent, true);
});
