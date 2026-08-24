import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePendingApprovals } from './ChatPendingApprovalsStrip';

test('待处理审批按当前会话与其他会话分组，不改变 Gateway 原始审批状态', () => {
  const summary = summarizePendingApprovals([
    { request: { sessionKey: 'agent:main:one' } },
    { request: { sessionKey: 'agent:main:two' } },
    { request: { sessionKey: 'agent:main:one' } },
    { request: {} },
  ], 'agent:main:one');

  assert.deepEqual(summary, { activeSessionCount: 2, otherSessionCount: 2 });
});
