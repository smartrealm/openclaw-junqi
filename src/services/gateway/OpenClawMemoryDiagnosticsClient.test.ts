import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENCLAW_MEMORY_REM_HARNESS_MAX_LIMIT,
  OpenClawMemoryDiagnosticsClient,
  OpenClawMemoryDiagnosticsResponseError,
  parseOpenClawMemoryRemHarness,
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

function remHarness(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    agentId: 'main',
    workspaceDir: '/workspace/main',
    remConfig: {
      enabled: true,
      lookbackDays: 7,
      limit: 25,
      minPatternStrength: 0.5,
    },
    deepConfig: {
      minScore: 0.7,
      minRecallCount: 2,
      minUniqueQueries: 2,
      recencyHalfLifeDays: 14,
      maxAgeDays: null,
    },
    rem: {
      skipped: false,
      sourceEntryCount: 3,
      reflections: ['A reflection'],
      candidateTruths: [{ snippet: 'A truth', confidence: 0.8 }],
      bodyLines: ['line 1', '', 'line 3'],
    },
    grounded: null,
    deep: {
      candidateLimit: 25,
      truncated: false,
      candidates: [{
        key: 'memory/2026-08-03.md:4-8',
        path: 'memory/2026-08-03.md',
        startLine: 4,
        endLine: 8,
        snippet: 'A candidate',
        recallCount: 3,
        uniqueQueries: 2,
        avgScore: 0.8,
        maxScore: 0.9,
        ageDays: 1,
        firstRecalledAt: '2026-08-02T00:00:00.000Z',
        lastRecalledAt: '2026-08-03T00:00:00.000Z',
        promoted: false,
      }],
    },
    ...overrides,
  };
}

test('sends status and REM harness requests without adding probe defaults', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawMemoryDiagnosticsClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return (method === 'doctor.memory.status' ? status() : remHarness()) as T;
  });

  assert.deepEqual(await client.status(), parseOpenClawMemoryStatus(status()));
  assert.deepEqual(await client.status({ agentId: ' writer ', probe: true, deep: true }), parseOpenClawMemoryStatus(status()));
  assert.deepEqual(await client.remHarness({ grounded: true, includePromoted: true, limit: 50 }), parseOpenClawMemoryRemHarness(remHarness()));
  assert.deepEqual(calls, [
    { method: 'doctor.memory.status', params: {} },
    { method: 'doctor.memory.status', params: { agentId: 'writer', probe: true, deep: true } },
    { method: 'doctor.memory.remHarness', params: { grounded: true, includePromoted: true, limit: 50 } },
  ]);
});

test('decodes native status and preserves native content in the REM preview', () => {
  const parsedStatus = parseOpenClawMemoryStatus(status({
    embedding: { ok: false, checked: false, error: 'not probed' },
  }));
  assert.equal(parsedStatus.embedding.ok, false);
  assert.equal(parsedStatus.embedding.error, 'not probed');

  const parsedRem = parseOpenClawMemoryRemHarness(remHarness({
    grounded: {
      scannedFiles: 1,
      files: [{ path: 'memory/2026-08-03.md', renderedMarkdown: '# Heading\n\n  body' }],
    },
  }));
  assert.equal(parsedRem.ok, true);
  if (parsedRem.ok) {
    assert.deepEqual(parsedRem.rem.bodyLines, ['line 1', '', 'line 3']);
    assert.equal(parsedRem.grounded?.files[0]?.renderedMarkdown, '# Heading\n\n  body');
  }
});

test('accepts the official REM harness error payload and rejects malformed known fields', () => {
  assert.deepEqual(parseOpenClawMemoryRemHarness({
    ok: false,
    agentId: 'main',
    workspaceDir: '/workspace/main',
    error: 'memory plugin unavailable',
  }), {
    ok: false,
    agentId: 'main',
    workspaceDir: '/workspace/main',
    error: 'memory plugin unavailable',
  });

  for (const value of [
    status({ embedding: { ok: 'yes' } }),
    status({ embeddingRuntime: { engine: 'other', state: 'ready' } }),
    remHarness({ deep: { candidateLimit: 25, truncated: false, candidates: {} } }),
    remHarness({ deepConfig: { minScore: 0.7, minRecallCount: 2, minUniqueQueries: 2, recencyHalfLifeDays: 14 } }),
    remHarness({ grounded: { scannedFiles: 1, files: [{ path: 'x', renderedMarkdown: 1 }] } }),
    { ok: false, agentId: 'main', workspaceDir: '/workspace/main', error: '' },
  ]) {
    assert.throws(() => (
      value && typeof value === 'object' && 'embedding' in value
        ? parseOpenClawMemoryStatus(value)
        : parseOpenClawMemoryRemHarness(value)
    ), OpenClawMemoryDiagnosticsResponseError);
  }
});

test('enforces the official bounded REM harness limit and boolean inputs', async () => {
  const client = new OpenClawMemoryDiagnosticsClient(async <T>(): Promise<T> => remHarness() as T);
  await assert.rejects(client.remHarness({ limit: 0 }));
  await assert.rejects(client.remHarness({ limit: OPENCLAW_MEMORY_REM_HARNESS_MAX_LIMIT + 1 }));
  await assert.rejects(client.remHarness({ grounded: 'yes' as never }));
  await assert.rejects(client.status({ probe: 'yes' as never }));
});
