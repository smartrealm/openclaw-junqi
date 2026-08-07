import assert from 'node:assert/strict';
import test from 'node:test';
import { OpenClawRuntimeConfigClient } from './OpenClawRuntimeConfigClient';

test('读取和替换配置都遵循官方 Gateway 快照与 hash 契约', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawRuntimeConfigClient({
    async call(method, params) {
      calls.push({ method, params });
      return {
        exists: true,
        valid: true,
        hash: 'config-hash',
        config: { agents: { defaults: { model: { primary: 'openai/gpt-5' } } } },
      };
    },
    async callPrivileged(method, params) {
      calls.push({ method, params });
      return { ok: true, hash: 'next-hash', config: {} };
    },
  });

  const snapshot = await client.read();
  await client.replace({ tools: { profile: 'coding' } }, snapshot);

  assert.deepEqual(calls, [
    { method: 'config.get', params: {} },
    {
      method: 'config.set',
      params: {
        baseHash: 'config-hash',
        raw: JSON.stringify({ tools: { profile: 'coding' } }),
      },
    },
  ]);
});

test('首次写入可省略 hash，既有配置或无效回执不得降级为本地成功', async () => {
  const writes: Record<string, unknown>[] = [];
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return { exists: false, valid: true, config: {} };
    },
    async callPrivileged(_method, params) {
      writes.push(params);
      return { ok: false };
    },
  });

  const snapshot = await client.read();
  await assert.rejects(
    () => client.replace({ models: { providers: {} } }, snapshot),
    /config\.set response is unavailable/,
  );
  assert.equal(writes[0].baseHash, undefined);
});
