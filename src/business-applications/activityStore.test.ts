import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectBusinessAttemptsForSession,
  useBusinessActivityStore,
} from './activityStore';

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

test('本窗口投影只属于创建它的精确 Session，清理不跨越其他 Session', () => {
  useBusinessActivityStore.getState().clear();
  const first = {
    id: 'attempt-session-a',
    sessionKey: 'agent:main:session-a',
    sessionId: 'session-a',
    agentId: 'main',
    runtimeFingerprint: 'runtime-a',
    runtimeConnectionId: 'connection-a',
    toolName: 'junqi_dingtalk_contact_me',
    toolLabel: '当前用户',
    profileRef: 'corp:user-a',
    effect: 'read' as const,
    risk: 'low' as const,
    state: 'succeeded' as const,
    startedAt: 1,
  };
  const second = {
    ...first,
    id: 'attempt-session-b',
    sessionKey: 'agent:main:session-b',
    sessionId: 'session-b',
    profileRef: 'corp:user-b',
  };
  useBusinessActivityStore.getState().begin(first);
  useBusinessActivityStore.getState().begin(second);

  assert.deepEqual(
    selectBusinessAttemptsForSession(
      useBusinessActivityStore.getState().attempts,
      'agent:main:session-a',
    ).map((attempt) => attempt.id),
    ['attempt-session-a'],
  );
  assert.deepEqual(
    selectBusinessAttemptsForSession(useBusinessActivityStore.getState().attempts, ''),
    [],
  );

  useBusinessActivityStore.getState().clearSession('agent:main:session-a');
  assert.deepEqual(
    useBusinessActivityStore.getState().attempts.map((attempt) => attempt.id),
    ['attempt-session-b'],
  );
});
