import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionsCompactionCheckpointParams,
  buildSessionsCompactionListParams,
  buildSessionsPreviewParams,
  buildSessionsResolveParams,
  parseSessionsCompactionBranchResult,
  parseSessionsCompactionListResult,
  parseSessionsCompactionRestoreResult,
  parseSessionsPreviewResult,
  parseSessionsResolveResult,
  requireSessionPreview,
} from './sessionInspection';

test('builds bounded sessions.preview params and removes duplicate blank keys', () => {
  assert.deepEqual(
    buildSessionsPreviewParams([' agent:main:main ', '', 'agent:main:main'], { limit: 4, maxChars: 120 }),
    { keys: ['agent:main:main'], limit: 4, maxChars: 120 },
  );
  assert.throws(() => buildSessionsPreviewParams(['  ']), /at least one session key/);
  assert.throws(() => buildSessionsPreviewParams(['agent:main:main'], { maxChars: 19 }), /at least 20/);
});

test('parses the official sessions.preview projection and requires the requested key', () => {
  const result = parseSessionsPreviewResult({
    ts: 1_735_000_000_000,
    previews: [{
      key: 'agent:main:main',
      status: 'ok',
      items: [
        { role: 'user', text: 'Review the restart path' },
        { role: 'assistant', text: 'I will inspect the service contract.' },
      ],
    }],
  });
  assert.equal(requireSessionPreview(result, 'agent:main:main').items.length, 2);
  assert.throws(() => requireSessionPreview(result, 'agent:main:other'), /no preview/);
  assert.throws(() => parseSessionsPreviewResult({ ts: 1, previews: [{ key: 'x', status: 'ok', items: [{ role: 'user', text: '' }] }] }), /invalid previews/);
});

test('builds and parses sessions.resolve without inventing a missing key', () => {
  assert.deepEqual(
    buildSessionsResolveParams(' agent:main:main ', { agentId: ' main ', allowMissing: true }),
    { key: 'agent:main:main', agentId: 'main', allowMissing: true },
  );
  assert.deepEqual(parseSessionsResolveResult({ ok: false }), { ok: false });
  assert.deepEqual(parseSessionsResolveResult({ ok: true, key: 'agent:main:main' }), { ok: true, key: 'agent:main:main' });
  assert.throws(() => parseSessionsResolveResult({ ok: true }), /invalid key/);
});

test('parses compaction checkpoint metadata and fences the canonical session key', () => {
  const params = buildSessionsCompactionListParams(' agent:main:main ', ' main ');
  assert.deepEqual(params, { key: 'agent:main:main', agentId: 'main' });
  const result = parseSessionsCompactionListResult({
    ok: true,
    key: 'agent:main:main',
    checkpoints: [{
      checkpointId: 'checkpoint-1',
      sessionKey: 'agent:main:main',
      sessionId: 'session-1',
      createdAt: 1_735_000_000_000,
      reason: 'manual',
      tokensBefore: 1000,
      tokensAfter: 400,
      summary: 'Earlier context retained in the compaction summary.',
      preCompaction: { sessionId: 'session-1', entryId: 'entry-before' },
      postCompaction: { sessionId: 'session-1', entryId: 'entry-after' },
    }],
  }, 'agent:main:main');
  assert.equal(result.checkpoints[0]?.reason, 'manual');
  assert.throws(() => parseSessionsCompactionListResult({ ok: true, key: 'agent:main:other', checkpoints: [] }, 'agent:main:main'), /different session key/);
  assert.throws(() => parseSessionsCompactionListResult({ ok: true, key: 'agent:main:main', checkpoints: [{ reason: 'manual' }] }), /invalid checkpoint/);
});

test('builds checkpoint mutation params with the exact OpenClaw shape', () => {
  assert.deepEqual(
    buildSessionsCompactionCheckpointParams(' agent:main:main ', ' checkpoint-1 ', ' main '),
    { key: 'agent:main:main', agentId: 'main', checkpointId: 'checkpoint-1' },
  );
  assert.throws(() => buildSessionsCompactionCheckpointParams('agent:main:main', '  '), /checkpointId/);
});

test('parses checkpoint branch and restore responses and fences identities', () => {
  const checkpoint = {
    checkpointId: 'checkpoint-1',
    sessionKey: 'agent:main:main',
    sessionId: 'session-1',
    createdAt: 1_735_000_000_000,
    reason: 'manual',
    preCompaction: { sessionId: 'session-1', entryId: 'entry-before' },
    postCompaction: { sessionId: 'session-1', entryId: 'entry-after' },
  };
  const branch = parseSessionsCompactionBranchResult({
    ok: true,
    sourceKey: 'agent:main:main',
    key: 'agent:main:branch-1',
    sessionId: 'session-branch',
    checkpoint,
    entry: { sessionId: 'session-branch', updatedAt: 1_735_000_000_100 },
  }, 'agent:main:main');
  assert.equal(branch.key, 'agent:main:branch-1');

  const restore = parseSessionsCompactionRestoreResult({
    ok: true,
    key: 'agent:main:main',
    sessionId: 'session-restored',
    checkpoint,
    entry: { sessionId: 'session-restored', updatedAt: 1_735_000_000_200 },
  }, 'agent:main:main');
  assert.equal(restore.sessionId, 'session-restored');

  assert.throws(
    () => parseSessionsCompactionBranchResult({
      ok: true,
      sourceKey: 'agent:main:other',
      key: 'agent:main:branch-1',
      sessionId: 'session-branch',
      checkpoint,
      entry: { sessionId: 'session-branch', updatedAt: 1 },
    }, 'agent:main:main'),
    /different source session key/,
  );
  assert.throws(
    () => parseSessionsCompactionRestoreResult({
      ok: true,
      key: 'agent:main:main',
      sessionId: 'session-restored',
      checkpoint,
      entry: { sessionId: 'session-other', updatedAt: 1 },
    }, 'agent:main:main'),
    /mismatched session identity/,
  );
});
