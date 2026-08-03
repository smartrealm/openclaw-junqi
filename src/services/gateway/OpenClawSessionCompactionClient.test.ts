import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionCompactionClient,
  OpenClawSessionCompactionResponseError,
} from './OpenClawSessionCompactionClient';

test('sends the official sessions.compact request and decodes a completed result', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionCompactionClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return { ok: true, key: 'agent:main:main', compacted: true } as T;
  });

  assert.deepEqual(await client.compact({
    key: ' agent:main:main ',
    agentId: 'main',
    maxLines: 200,
  }), {
    ok: true,
    key: 'agent:main:main',
    compacted: true,
  });
  assert.deepEqual(calls, [{
    method: 'sessions.compact',
    params: {
      key: 'agent:main:main',
      agentId: 'main',
      maxLines: 200,
    },
  }]);
});

test('preserves an official no-op reason without claiming compaction', async () => {
  const client = new OpenClawSessionCompactionClient(async <T>(): Promise<T> => ({
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    reason: 'no transcript',
  } as T));

  assert.deepEqual(await client.compact({ key: 'agent:main:main' }), {
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    reason: 'no transcript',
  });
});

test('preserves the official asynchronous pending signal without claiming completion', async () => {
  const client = new OpenClawSessionCompactionClient(async <T>(): Promise<T> => ({
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    result: { details: { pending: true, ignored: 'opaque' } },
  } as T));

  assert.deepEqual(await client.compact({ key: 'agent:main:main' }), {
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    pending: true,
  });
});

test('preserves an official inner failure separately from a no-op result', async () => {
  const client = new OpenClawSessionCompactionClient(async <T>(): Promise<T> => ({
    ok: false,
    key: 'agent:main:main',
    compacted: false,
    reason: 'provider rejected summary',
  } as T));

  assert.deepEqual(await client.compact({ key: 'agent:main:main' }), {
    ok: false,
    key: 'agent:main:main',
    compacted: false,
    reason: 'provider rejected summary',
  });
});

test('rejects an unverifiable compaction response and invalid request values', async () => {
  const client = new OpenClawSessionCompactionClient(async <T>(): Promise<T> => ({
    ok: true,
    key: 'agent:main:main',
  } as T));

  await assert.rejects(
    client.compact({ key: 'agent:main:main' }),
    OpenClawSessionCompactionResponseError,
  );
  await assert.rejects(client.compact({ key: 'agent:main:main', maxLines: 0 }));
  await assert.rejects(client.compact({ key: '   ' }));
});
