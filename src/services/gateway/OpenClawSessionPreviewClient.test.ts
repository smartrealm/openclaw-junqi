import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS,
  OpenClawSessionPreviewClient,
  OpenClawSessionPreviewResponseError,
  parseOpenClawSessionPreviewResult,
} from './OpenClawSessionPreviewClient';

test('sends the official sessions.preview request and decodes every result status', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionPreviewClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return {
      ts: 123,
      previews: [
        { key: 'agent:main:main', status: 'ok', items: [{ role: 'user', text: 'Hello' }, { role: 'tool', text: 'Done' }] },
        { key: 'agent:main:empty', status: 'empty', items: [] },
        { key: 'agent:main:missing', status: 'missing', items: [] },
        { key: 'agent:main:error', status: 'error', items: [] },
      ],
    } as T;
  });

  assert.deepEqual(await client.preview({
    keys: [' agent:main:main ', 'agent:main:empty', 'agent:main:missing', 'agent:main:error'],
    limit: 3,
    maxChars: 160,
  }), {
    ts: 123,
    previews: [
      { key: 'agent:main:main', status: 'ok', items: [{ role: 'user', text: 'Hello' }, { role: 'tool', text: 'Done' }] },
      { key: 'agent:main:empty', status: 'empty', items: [] },
      { key: 'agent:main:missing', status: 'missing', items: [] },
      { key: 'agent:main:error', status: 'error', items: [] },
    ],
  });
  assert.deepEqual(calls, [{
    method: 'sessions.preview',
    params: {
      keys: ['agent:main:main', 'agent:main:empty', 'agent:main:missing', 'agent:main:error'],
      limit: 3,
      maxChars: 160,
    },
  }]);
});

test('deduplicates keys and ignores additive response fields', async () => {
  const client = new OpenClawSessionPreviewClient(async <T>(): Promise<T> => ({
    ts: 456,
    previews: [{
      key: 'agent:main:main',
      status: 'ok',
      items: [{ role: 'assistant', text: 'Ready', extra: true }],
      extra: 'future field',
    }],
    extra: true,
  } as T));

  assert.deepEqual(await client.preview({ keys: ['agent:main:main', ' agent:main:main '] }), {
    ts: 456,
    previews: [{ key: 'agent:main:main', status: 'ok', items: [{ role: 'assistant', text: 'Ready' }] }],
  });
});

test('rejects invalid request bounds and malformed or incomplete responses', async () => {
  const client = new OpenClawSessionPreviewClient(async <T>(): Promise<T> => ({
    ts: 1,
    previews: [],
  } as T));

  await assert.rejects(client.preview({ keys: [] }));
  await assert.rejects(client.preview({ keys: ['key', 42 as never] }));
  await assert.rejects(client.preview({ keys: Array.from({ length: OPENCLAW_SESSIONS_PREVIEW_MAX_KEYS + 1 }, (_, i) => `key:${i}`) }));
  await assert.rejects(client.preview({ keys: ['key'], limit: 0 }));
  await assert.rejects(client.preview({ keys: ['key'], maxChars: 19 }));
  await assert.rejects(client.preview({ keys: ['key'] }), OpenClawSessionPreviewResponseError);

  assert.throws(() => parseOpenClawSessionPreviewResult({
    ts: 1,
    previews: [{ key: 'key', status: 'missing', items: [{ role: 'user', text: 'fabricated' }] }],
  }), OpenClawSessionPreviewResponseError);
  assert.throws(() => parseOpenClawSessionPreviewResult({
    ts: 1,
    previews: [{ key: 'key', status: 'ok', items: [{ role: 'unknown', text: 'nope' }] }],
  }), OpenClawSessionPreviewResponseError);
});

test('rejects duplicate response keys and non-finite timestamps', () => {
  assert.throws(() => parseOpenClawSessionPreviewResult({
    ts: 1,
    previews: [
      { key: 'key', status: 'empty', items: [] },
      { key: 'key', status: 'empty', items: [] },
    ],
  }), OpenClawSessionPreviewResponseError);
  assert.throws(() => parseOpenClawSessionPreviewResult({
    ts: Number.NaN,
    previews: [],
  }), OpenClawSessionPreviewResponseError);
});
