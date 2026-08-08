import assert from 'node:assert/strict';
import test from 'node:test';
import { useBusinessActivityStore } from './activityStore';

test('business activity keeps metadata but no arguments or raw outputs', () => {
  useBusinessActivityStore.getState().clear();
  useBusinessActivityStore.getState().begin({
    id: 'attempt-a',
    sessionKey: 'agent:main:main',
    sessionId: 'session-a',
    agentId: 'main',
    runtimeFingerprint: 'runtime-a',
    runtimeConnectionId: 'connection-a',
    toolName: 'junqi_dingtalk_contact_me',
    toolLabel: '当前用户',
    profileRef: 'corp:user',
    effect: 'read',
    risk: 'low',
    state: 'pending',
    startedAt: 1,
  });
  useBusinessActivityStore.getState().settle('attempt-a', { state: 'succeeded', finishedAt: 2 });
  const attempt = useBusinessActivityStore.getState().attempts[0];
  assert.equal(attempt?.state, 'succeeded');
  assert.equal(attempt?.agentId, 'main');
  assert.equal(attempt?.runtimeConnectionId, 'connection-a');
  assert.equal(Object.prototype.hasOwnProperty.call(attempt ?? {}, 'arguments'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(attempt ?? {}, 'output'), false);
});
