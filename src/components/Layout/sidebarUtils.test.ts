import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@/stores/chatStore';
import { partitionSessions, sortSessionsByActivity } from './sidebarUtils';

function sx(partial: Partial<Session> & { key: string }): Session {
  return {
    label: partial.key,
    ...partial,
  };
}

test('sortSessionsByActivity puts running sessions first, then newest activity', () => {
  const sorted = sortSessionsByActivity([
    sx({ key: 'agent:main:old', lastTimestamp: '2026-01-01T00:00:00.000Z' }),
    sx({ key: 'agent:main:new', lastTimestamp: '2026-01-03T00:00:00.000Z' }),
    sx({ key: 'agent:main:running', running: true, lastTimestamp: '2026-01-02T00:00:00.000Z' }),
  ]);

  assert.deepEqual(sorted.map((s) => s.key), [
    'agent:main:running',
    'agent:main:new',
    'agent:main:old',
  ]);
});

test('partitionSessions separates pinned, active, and recent without duplication', () => {
  const result = partitionSessions([
    sx({ key: 'agent:main:pinned', pinned: true, totalTokens: 10, lastTimestamp: '2026-01-01T00:00:00.000Z' }),
    sx({ key: 'agent:main:active', running: true, totalTokens: 10, lastTimestamp: '2026-01-02T00:00:00.000Z' }),
    sx({ key: 'agent:main:recent', totalTokens: 10, lastTimestamp: '2026-01-03T00:00:00.000Z' }),
  ], {}, false);

  assert.deepEqual(result.pinned.map((s) => s.key), ['agent:main:pinned']);
  assert.deepEqual(result.active.map((s) => s.key), ['agent:main:active']);
  assert.deepEqual(result.recent.map((s) => s.key), ['agent:main:recent']);
});

