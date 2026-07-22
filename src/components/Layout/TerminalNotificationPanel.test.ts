import assert from 'node:assert/strict';
import test from 'node:test';

import { terminalInboxRelativeTime } from './TerminalNotificationPanel';

test('terminal inbox uses Kooky-style compact relative times', () => {
  const now = Date.UTC(2026, 6, 22, 12, 0, 0);
  assert.equal(terminalInboxRelativeTime(new Date(now - 20_000).toISOString(), now), 'now');
  assert.equal(terminalInboxRelativeTime(new Date(now - 120_000).toISOString(), now), '2m ago');
  assert.equal(terminalInboxRelativeTime(new Date(now - 7_200_000).toISOString(), now), '2h ago');
  assert.equal(terminalInboxRelativeTime(new Date(now - 172_800_000).toISOString(), now), '2d ago');
});

test('terminal inbox leaves invalid timestamps blank', () => {
  assert.equal(terminalInboxRelativeTime('not-a-date'), '');
});
