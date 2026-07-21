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
    resetRemote: async () => ({ success: true, sessionId: 'session-before' }),
    invalidateChatRun: (key) => invalidated.push(key),
    dispatchReset: (key) => events.push(key),
  });

  assert.equal(await resetSessionEverywhere(KEY), true);
  assert.deepEqual(useChatStore.getState().messagesPerSession[KEY], []);
  assert.deepEqual(useChatStore.getState().messageQueue[KEY], []);
  assert.deepEqual(invalidated, [KEY]);
  assert.deepEqual(events, [KEY]);
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
