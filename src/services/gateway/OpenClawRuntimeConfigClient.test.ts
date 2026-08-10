import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawRuntimeConfigClient,
  requireOpenClawConfigPatchAcknowledgement,
} from './OpenClawRuntimeConfigClient';

test('共享 config.patch 回执校验拒绝缺失或失败回执', () => {
  requireOpenClawConfigPatchAcknowledgement({ ok: true });
  assert.throws(
    () => requireOpenClawConfigPatchAcknowledgement({ ok: false }),
    /config\.patch response is unavailable/,
  );
  assert.throws(
    () => requireOpenClawConfigPatchAcknowledgement({}),
    /config\.patch response is unavailable/,
  );
});

test('读取和最小补丁写入都遵循官方 Gateway 快照与 hash 契约', async () => {
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
  await client.patch({ tools: { profile: 'coding' } }, snapshot);

  assert.deepEqual(calls, [
    { method: 'config.get', params: {} },
    {
      method: 'config.patch',
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
    () => client.patch({ models: { providers: {} } }, snapshot),
    /config\.patch response is unavailable/,
  );
  assert.equal(writes[0].baseHash, undefined);
});

test('数组替换路径只在调用方明确声明时发送', async () => {
  const writes: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawRuntimeConfigClient({
    async call() {
      return { exists: true, valid: true, hash: 'config-hash', config: {} };
    },
    async callPrivileged(method, params) {
      writes.push({ method, params });
      return { ok: true };
    },
  });

  const snapshot = await client.read();
  await client.patch({ tools: { allow: ['read'] } }, snapshot, ['tools.allow']);

  assert.deepEqual(writes, [{
    method: 'config.patch',
    params: {
      raw: JSON.stringify({ tools: { allow: ['read'] } }),
      baseHash: 'config-hash',
      replacePaths: ['tools.allow'],
    },
  }]);
});
