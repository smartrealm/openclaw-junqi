import test from 'node:test';
import assert from 'node:assert/strict';
import { formatNotificationTime } from './notificationTime';

const NOW = Date.parse('2026-07-14T12:00:00Z');

test('notification time follows the selected locale', () => {
  const timestamp = '2026-07-14T11:55:00Z';
  assert.equal(formatNotificationTime(timestamp, 'en-US', NOW), '5 minutes ago');
  assert.equal(formatNotificationTime(timestamp, 'zh-CN', NOW), '5分钟前');
});

test('notification time uses localized absolute dates for older entries', () => {
  const result = formatNotificationTime('2026-06-01T08:30:00Z', 'en-US', NOW);
  assert.match(result, /Jun 1, 2026/);
});

test('notification time rejects malformed timestamps', () => {
  assert.equal(formatNotificationTime('not-a-date', 'en-US', NOW), '');
});
