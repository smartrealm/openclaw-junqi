import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '@/stores/chatStore';
import {
  resetSessionEverywhere,
  setSessionResetDependenciesForTests,
} from './sessionReset';

const KEY = 'agent:main:reset-test';

beforeEach(() => {
  useChatStore.setState({
    sessions: [{ key: KEY, sessionId: 'session-before', label: 'Reset me' }],
    activeSessionKey: KEY,
    messages: [{ id: 'message-1', role: 'user', content: 'keep until reset', timestamp: '2026-01-01' }],
    messagesPerSession: {
      [KEY]: [{ id: 'message-1', role: 'user', content: 'keep until reset', timestamp: '2026-01-01' }],
    },
    messageQueue: {
      [KEY]: [{ id: 'queued-1', text: 'queued', timestamp: '2026-01-01', sessionId: 'session-before' }],
    },
  });
  setSessionResetDependenciesForTests();
});

test('clears local state only after the coordinated native reset succeeds', async () => {
  const events: string[] = [];
  const invalidated: string[] = [];
  setSessionResetDependenciesForTests({
    resetRemote: async () => ({
      success: true,
      previousSessionId: 'session-before',
      sessionId: 'session-after',
    }),
    invalidateChatRun: (key) => invalidated.push(key),
    dispatchReset: (key) => events.push(key),
  });

  assert.equal(await resetSessionEverywhere(KEY), true);
  assert.equal(useChatStore.getState().messagesPerSession[KEY], undefined);
  assert.equal(useChatStore.getState().messageQueue[KEY], undefined);
  assert.deepEqual(invalidated, [KEY]);
  assert.deepEqual(events, [KEY]);
  assert.equal(
    useChatStore.getState().sessions.find((session) => session.key === KEY)?.sessionId,
    'session-after',
  );
});

test('preserves local state when the mutation is cancelled', async () => {
  setSessionResetDependenciesForTests({
    resetRemote: async () => ({ success: false, sessionId: 'session-before' }),
  });

  assert.equal(await resetSessionEverywhere(KEY), false);
  assert.equal(useChatStore.getState().messagesPerSession[KEY]?.length, 1);
  assert.equal(useChatStore.getState().messageQueue[KEY]?.length, 1);
});

test('preserves local state and reports a core failure', async () => {
  const failures: string[] = [];
  setSessionResetDependenciesForTests({
    resetRemote: async () => { throw new Error('reset rejected'); },
    notifyFailure: (detail) => failures.push(detail),
    warn: () => undefined,
  });

  assert.equal(await resetSessionEverywhere(KEY), false);
  assert.equal(useChatStore.getState().messagesPerSession[KEY]?.length, 1);
  assert.deepEqual(failures, ['reset rejected']);
});

test('resets an unmaterialized local session without calling OpenClaw', async () => {
  let requests = 0;
  useChatStore.setState({ sessions: [], messages: [], messagesPerSession: {} });
  useChatStore.getState().addLocalSession({
    key: KEY,
    label: 'New session',
    agentId: 'main',
    createdAt: Date.now(),
  });
  setSessionResetDependenciesForTests({
    resetRemote: async () => {
      requests += 1;
      return { success: true };
    },
  });

  assert.equal(await resetSessionEverywhere(KEY), true);
  assert.equal(requests, 0);
});
