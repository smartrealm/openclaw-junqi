import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawMemoryDiagnosticsClient,
  OpenClawMemoryDiagnosticsResponseError,
  parseOpenClawMemoryStatus,
} from './OpenClawMemoryDiagnosticsClient';

function status(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'main',
    provider: 'local',
    embedding: {
      ok: true,
      checked: true,
      cached: true,
      checkedAtMs: 1_725_000_000_000,
      cacheExpiresAtMs: 1_725_000_060_000,
    },
    embeddingRuntime: {
      engine: 'llama.cpp',
      state: 'ready',
      backend: 'cpu',
      buildType: 'prebuilt',
      deviceNames: ['CPU'],
      memory: {
        totalBytes: 100,
        usedBytes: 20,
        freeBytes: 80,
        unifiedBytes: 0,
        observedAtMs: 1_725_000_000_000,
      },
      offload: { supported: false },
      context: { requestedSize: 'auto' },
    },
    ...overrides,
  };
}

test('只请求官方保留的记忆状态方法且不补充探测默认值', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawMemoryDiagnosticsClient(async <T>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> => {
    calls.push({ method, params });
    return status() as T;
  });

  assert.deepEqual(await client.status(), parseOpenClawMemoryStatus(status()));
  assert.deepEqual(
    await client.status({ agentId: ' writer ', probe: true, deep: true }),
    parseOpenClawMemoryStatus(status()),
  );
  assert.deepEqual(calls, [
    { method: 'doctor.memory.status', params: {} },
    { method: 'doctor.memory.status', params: { agentId: 'writer', probe: true, deep: true } },
  ]);
});

test('严格解码官方记忆状态响应', () => {
  const parsed = parseOpenClawMemoryStatus(status({
    embedding: { ok: false, checked: false, error: 'not probed' },
  }));
  assert.equal(parsed.embedding.ok, false);
  assert.equal(parsed.embedding.error, 'not probed');

  for (const value of [
    status({ embedding: { ok: 'yes' } }),
    status({ embeddingRuntime: { engine: 'other', state: 'ready' } }),
  ]) {
    assert.throws(() => parseOpenClawMemoryStatus(value), OpenClawMemoryDiagnosticsResponseError);
  }
});

test('拒绝无效的记忆状态请求参数', async () => {
  const client = new OpenClawMemoryDiagnosticsClient(async <T>(): Promise<T> => status() as T);
  await assert.rejects(client.status({ agentId: '   ' }));
  await assert.rejects(client.status({ probe: 'yes' as never }));
  await assert.rejects(client.status({ deep: 'yes' as never }));
});
