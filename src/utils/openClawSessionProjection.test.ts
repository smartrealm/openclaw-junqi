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
