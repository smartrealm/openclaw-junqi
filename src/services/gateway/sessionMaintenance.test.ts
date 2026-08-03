import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSessionsCompactParams, parseSessionsCompactResult } from './sessionMaintenance';

test('builds the official sessions.compact envelope and omits empty optional fields', () => {
  assert.deepEqual(buildSessionsCompactParams(' agent:main:main ', { agentId: ' ', maxLines: 120.9 }), {
    key: 'agent:main:main',
    maxLines: 120,
  });
});

test('rejects an empty key, invalid maxLines, and a response for another session', () => {
  assert.throws(() => buildSessionsCompactParams('  '));
  assert.throws(() => buildSessionsCompactParams('agent:main:main', { maxLines: 0 }));
  assert.throws(() => parseSessionsCompactResult({ ok: true, key: 'other', compacted: true }, 'agent:main:main'));
});

test('decodes compacted and no-transcript outcomes without treating either as an exception', () => {
  assert.deepEqual(parseSessionsCompactResult({
    ok: true,
    key: 'agent:main:main',
    compacted: true,
    archived: true,
    kept: 40,
  }, 'agent:main:main'), {
    ok: true,
    key: 'agent:main:main',
    compacted: true,
    archived: true,
    kept: 40,
  });
  assert.deepEqual(parseSessionsCompactResult({
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    reason: 'no transcript',
  }), {
    ok: true,
    key: 'agent:main:main',
    compacted: false,
    reason: 'no transcript',
  });
});
