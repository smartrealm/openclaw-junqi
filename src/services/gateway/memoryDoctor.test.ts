import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMemoryRemHarnessParams,
  buildMemoryStatusParams,
  parseMemoryRemHarnessResult,
  parseMemoryStatusResult,
} from './memoryDoctor';

test('memory status params use the official optional probe flags', () => {
  assert.deepEqual(buildMemoryStatusParams(), {});
  assert.deepEqual(buildMemoryStatusParams(' main ', true), {
    agentId: 'main',
    probe: true,
    deep: true,
  });
});

test('memory status parser accepts the official degraded embedding response', () => {
  assert.deepEqual(parseMemoryStatusResult({
    agentId: 'main',
    embedding: { ok: false, error: 'memory search unavailable' },
  }), {
    agentId: 'main',
    embedding: { ok: false, error: 'memory search unavailable' },
  });
});

test('memory status parser preserves dreaming counts and phase health', () => {
  const result = parseMemoryStatusResult({
    agentId: 'main',
    provider: 'local',
    embedding: { ok: true, checked: true },
    dreaming: {
      enabled: true,
      timezone: 'Asia/Shanghai',
      verboseLogging: false,
      storageMode: 'workspace',
      separateReports: false,
      shortTermCount: 2,
      recallSignalCount: 3,
      dailySignalCount: 4,
      groundedSignalCount: 5,
      totalSignalCount: 6,
      phaseSignalCount: 7,
      lightPhaseHitCount: 8,
      remPhaseHitCount: 9,
      promotedTotal: 10,
      promotedToday: 1,
      phases: {
        light: { enabled: true, cron: '0 3 * * *', managedCronPresent: true, lookbackDays: 2, limit: 100 },
        deep: { enabled: true, cron: '0 4 * * *', managedCronPresent: false, minScore: 0.7, maxAgeDays: 30 },
        rem: { enabled: false, cron: '0 5 * * *', managedCronPresent: false, minPatternStrength: 0.8 },
      },
    },
  });
  assert.equal(result.provider, 'local');
  assert.equal(result.dreaming?.phases.deep.maxAgeDays, 30);
  assert.equal(result.dreaming?.promotedToday, 1);
});

test('rem harness parser preserves bounded read-only previews and failures', () => {
  assert.deepEqual(buildMemoryRemHarnessParams({ grounded: true, includePromoted: true, limit: 25 }), {
    grounded: true,
    includePromoted: true,
    limit: 25,
  });
  const result = parseMemoryRemHarnessResult({
    ok: true,
    agentId: 'main',
    workspaceDir: '/workspace',
    remConfig: { enabled: true, lookbackDays: 7, limit: 10, minPatternStrength: 0.8 },
    deepConfig: {
      minScore: 0.7,
      minRecallCount: 3,
      minUniqueQueries: 2,
      recencyHalfLifeDays: 14,
      maxAgeDays: null,
    },
    rem: {
      skipped: false,
      sourceEntryCount: 1,
      reflections: ['reflection'],
      candidateTruths: [{ snippet: 'truth', confidence: 0.9 }],
      bodyLines: ['line'],
    },
    grounded: { scannedFiles: 1, files: [{ path: 'memory/2026-08-03.md', renderedMarkdown: '# day' }] },
    deep: {
      candidateLimit: 25,
      truncated: false,
      candidates: [{
        key: 'memory:1',
        path: 'memory/2026-08-03.md',
        startLine: 1,
        endLine: 2,
        snippet: 'snippet',
        recallCount: 2,
        uniqueQueries: 1,
        avgScore: 0.8,
        maxScore: 0.9,
        ageDays: 1,
        promoted: true,
        promotedAt: '2026-08-03T00:00:00.000Z',
      }],
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.deep.candidates[0]?.promoted, true);
    assert.equal(result.grounded?.files[0]?.path, 'memory/2026-08-03.md');
  }
  assert.deepEqual(parseMemoryRemHarnessResult({
    ok: false,
    agentId: 'main',
    workspaceDir: '/workspace',
    error: 'gateway rem-harness probe failed',
  }), {
    ok: false,
    agentId: 'main',
    workspaceDir: '/workspace',
    error: 'gateway rem-harness probe failed',
  });
});

test('rem harness parser rejects unsupported or incomplete payloads', () => {
  assert.throws(() => buildMemoryRemHarnessParams({ limit: 101 }), /limit/);
  assert.throws(() => parseMemoryStatusResult({ agentId: 'main', embedding: { ok: 'yes' } }), /embedding\.ok/);
  assert.throws(() => parseMemoryRemHarnessResult({ ok: true, agentId: 'main', workspaceDir: '/workspace' }), /incomplete/);
});
