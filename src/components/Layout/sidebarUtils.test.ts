import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@/stores/chatStore';
import {
  bucketSessionsByActivity,
  getSessionBucketKey,
  isSessionBucketKey,
  resolveExpandedSessionBuckets,
  sessionTitle,
  sortSessionsByActivity,
} from './sidebarUtils';

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

test('getSessionBucketKey follows relative time buckets', () => {
  const now = new Date('2026-07-06T12:00:00.000Z').getTime();
  const today = new Date('2026-07-06T01:00:00.000Z').getTime();
  const week = new Date('2026-07-01T01:00:00.000Z').getTime();
  const month = new Date('2026-06-12T01:00:00.000Z').getTime();
  const older = new Date('2026-05-01T01:00:00.000Z').getTime();

  assert.equal(getSessionBucketKey(today, now), 'today');
  assert.equal(getSessionBucketKey(week, now), 'withinWeek');
  assert.equal(getSessionBucketKey(month, now), 'withinMonth');
  assert.equal(getSessionBucketKey(older, now), 'older');
});

test('bucketSessionsByActivity groups sessions and preserves activity ordering', () => {
  const now = new Date('2026-07-06T12:00:00.000Z').getTime();
  const result = bucketSessionsByActivity([
    sx({ key: 'agent:main:older', lastTimestamp: '2026-05-01T00:00:00.000Z' }),
    sx({ key: 'agent:main:today-old', lastTimestamp: '2026-07-06T01:00:00.000Z' }),
    sx({ key: 'agent:main:today-new', lastTimestamp: '2026-07-06T10:00:00.000Z' }),
    sx({ key: 'agent:main:week', lastTimestamp: '2026-07-03T00:00:00.000Z' }),
  ], now);

  assert.deepEqual(result.find((bucket) => bucket.key === 'today')?.sessions.map((s) => s.key), [
    'agent:main:today-new',
    'agent:main:today-old',
  ]);
  assert.deepEqual(result.find((bucket) => bucket.key === 'withinWeek')?.sessions.map((s) => s.key), [
    'agent:main:week',
  ]);
  assert.deepEqual(result.find((bucket) => bucket.key === 'older')?.sessions.map((s) => s.key), [
    'agent:main:older',
  ]);
});

test('session bucket disclosure keeps the preferred bucket and reveals required sessions', () => {
  const now = new Date('2026-07-06T12:00:00.000Z').getTime();
  const buckets = bucketSessionsByActivity([
    sx({ key: 'agent:main:today', lastTimestamp: '2026-07-06T10:00:00.000Z' }),
    sx({ key: 'agent:main:week', lastTimestamp: '2026-07-03T00:00:00.000Z' }),
    sx({ key: 'agent:main:month', lastTimestamp: '2026-06-12T00:00:00.000Z' }),
    sx({ key: 'agent:main:older', lastTimestamp: '2026-05-01T00:00:00.000Z' }),
  ], now);

  assert.deepEqual(
    [...resolveExpandedSessionBuckets(
      buckets,
      'withinWeek',
      new Set(['agent:main:month', 'agent:main:older']),
    )],
    ['withinWeek', 'withinMonth', 'older'],
  );
  assert.equal(isSessionBucketKey('today'), true);
  assert.equal(isSessionBucketKey('yesterday'), false);
});

test('session title preserves the Gateway label in every language', () => {
  for (const label of ['New chat', '新会话', '新會話', 'Main Session']) {
    assert.equal(
      sessionTitle(sx({ key: 'agent:main:desktop-label', label }), 'A different first message'),
      label,
    );
  }
  assert.equal(
    sessionTitle(
      sx({ key: 'agent:main:desktop-created', label: '新会话', initialLabel: '新会话' }),
      '使用这条提示作为会话名称。附加内容',
    ),
    '使用这条提示作为会话名称',
  );
});
