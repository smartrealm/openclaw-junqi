import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@/stores/chatStore';
import {
  bucketSessionsByActivity,
  getSessionBucketKey,
  isEmptyTransientSession,
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

test('getSessionBucketKey follows ClawX-style time buckets', () => {
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

test('isEmptyTransientSession only removes untouched local placeholders', () => {
  assert.equal(isEmptyTransientSession(
    sx({ key: 'agent:main:s-empty', label: '新会话', createdAt: 123 }),
    [],
  ), true);
  assert.equal(isEmptyTransientSession(
    sx({ key: 'agent:main:s-content', label: '新会话', createdAt: 123, totalTokens: 1 }),
    [],
  ), false);
  assert.equal(isEmptyTransientSession(
    sx({ key: 'agent:main:main', label: 'Main Session', createdAt: 123 }),
    [],
  ), false);
});
