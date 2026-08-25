import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOpenClawSessionForChat } from './openClawSessionProjection';

test('sessions.list 缺少 agentId 时从官方 session key 投影会话智能体', () => {
  const session = projectOpenClawSessionForChat({
    key: 'agent:architect:created-session',
    sessionId: 'created-session-id',
    activeLeafEntryId: null,
  });

  assert.equal(session.agentId, 'architect');
  assert.equal(session.activeLeafEntryId, null);
});

test('sessions.list 只投影官方队列模式并保留未知语义', () => {
  const projected = projectOpenClawSessionForChat({
    key: 'agent:main:queue-mode',
    queueMode: 'followup',
    effectiveQueueMode: 'steer',
  });
  const unknown = projectOpenClawSessionForChat({
    key: 'agent:main:unknown-queue-mode',
    queueMode: 'future-mode',
    effectiveQueueMode: 1,
  });

  assert.equal(projected.queueMode, 'followup');
  assert.equal(projected.effectiveQueueMode, 'steer');
  assert.equal(unknown.queueMode, undefined);
  assert.equal(unknown.effectiveQueueMode, undefined);
});
