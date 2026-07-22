import assert from 'node:assert/strict';
import test from 'node:test';

import { projectQuickChatResponseGroups } from './quickChatProjection';
import type { ResponseGroup } from '@/types/ResponseGroup';

function group(id: string, role: ResponseGroup['role']): ResponseGroup {
  return {
    id,
    sessionKey: 'quickchat:test',
    role,
    timestamp: '2026-07-23T00:00:00.000Z',
    status: 'final',
    startedAt: 0,
    completedAt: 0,
    sourceMessageIds: [],
    blocks: [],
  };
}

test('projects every structured group after the latest QuickChat user turn', () => {
  const groups = [
    group('old-user', 'user'),
    group('old-response', 'assistant'),
    group('current-user', 'user'),
    group('current-response', 'assistant'),
    group('current-system-event', 'system'),
  ];

  assert.deepEqual(
    projectQuickChatResponseGroups(groups).map((item) => item.id),
    ['current-response', 'current-system-event'],
  );
});

test('does not replay an earlier response while the latest user turn is waiting', () => {
  const groups = [
    group('old-user', 'user'),
    group('old-response', 'assistant'),
    group('current-user', 'user'),
  ];

  assert.deepEqual(projectQuickChatResponseGroups(groups), []);
});
