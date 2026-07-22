import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import '../../test-setup';
import { useChatStore, type Session } from '../stores/chatStore';
import { useGatewayDataStore } from '../stores/gatewayDataStore';
import { __setSessionDeleteDepsForTest, deleteSessionEverywhere } from './sessionDelete';
import { __resetSessionLifecycleForTest } from './sessionLifecycle';

const MAIN_KEY = 'agent:main:main';
const TEST_KEY = 'agent:worker:desktop-delete-test';

function seed(): Session[] {
  const sessions: Session[] = [
    { key: MAIN_KEY, label: 'Main' },
    { key: TEST_KEY, label: 'Delete me' },
  ];
  useChatStore.setState({
    sessions,
    openTabs: [MAIN_KEY, TEST_KEY],
    activeSessionKey: TEST_KEY,
  });
  useGatewayDataStore.setState({ sessions: sessions.map(({ key, label }) => ({ key, label })) });
  return sessions;
}

describe('deleteSessionEverywhere', () => {
  let requests: string[];
  let failures: string[];
  let warnings: unknown[][];
  let invalidated: string[];

  beforeEach(() => {
    __resetSessionLifecycleForTest();
    requests = [];
    failures = [];
    warnings = [];
    invalidated = [];
    __setSessionDeleteDepsForTest({
      deleteRemote: async (key) => {
        requests.push(key);
        return { success: true };
      },
      notifyFailure: (detail) => failures.push(detail),
      warn: (...args) => warnings.push(args),
      invalidateChatRun: (key) => invalidated.push(key),
    });
  });

  test('removes local state only after the native deletion succeeds', async () => {
    seed();

    const result = await deleteSessionEverywhere(TEST_KEY);

    assert.equal(result, true);
    assert.deepEqual(requests, [TEST_KEY]);
    assert.deepEqual(invalidated, [TEST_KEY]);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
    assert.deepEqual(useChatStore.getState().openTabs, [MAIN_KEY]);
  });

  test('converges local deletion when the core commit is verified but collaboration recovery remains', async () => {
    seed();
    __setSessionDeleteDepsForTest({
      deleteRemote: async (key) => {
        requests.push(key);
        return {
          success: true,
          coordinated: true,
          collaborationRecoveryRequired: true,
        };
      },
      notifyFailure: (detail) => failures.push(detail),
      warn: (...args) => warnings.push(args),
      invalidateChatRun: (key) => invalidated.push(key),
    });

    const result = await deleteSessionEverywhere(TEST_KEY);

    assert.equal(result, true);
    assert.deepEqual(requests, [TEST_KEY]);
    assert.deepEqual(invalidated, [TEST_KEY]);
    assert.deepEqual(failures, []);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
  });

  test('keeps the session visible when the Gateway rejects deletion', async () => {
    seed();
    __setSessionDeleteDepsForTest({
      deleteRemote: async (key) => {
        requests.push(key);
        throw new Error('Gateway offline');
      },
      notifyFailure: (detail) => failures.push(detail),
      warn: (...args) => warnings.push(args),
    });

    const result = await deleteSessionEverywhere(TEST_KEY);

    assert.equal(result, false);
    assert.deepEqual(requests, [TEST_KEY]);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === TEST_KEY), true);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === TEST_KEY), true);
    assert.deepEqual(failures, ['Gateway offline']);
    assert.equal(warnings.length, 1);
  });

  test('keeps the session visible when deletion is not explicitly confirmed', async () => {
    seed();
    __setSessionDeleteDepsForTest({
      deleteRemote: async (key) => {
        requests.push(key);
        return {};
      },
      notifyFailure: (detail) => failures.push(detail),
      warn: (...args) => warnings.push(args),
    });

    const result = await deleteSessionEverywhere(TEST_KEY);

    assert.equal(result, false);
    assert.deepEqual(requests, [TEST_KEY]);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === TEST_KEY), true);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === TEST_KEY), true);
    assert.deepEqual(failures, ['Gateway did not confirm session deletion']);
    assert.equal(warnings.length, 1);
  });

  test('never sends a native delete for an agent main session', async () => {
    seed();

    const result = await deleteSessionEverywhere(MAIN_KEY);

    assert.equal(result, false);
    assert.deepEqual(requests, []);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === MAIN_KEY), true);
  });

  test('removes an unmaterialized local session without calling OpenClaw', async () => {
    useChatStore.setState({
      sessions: [{ key: MAIN_KEY, label: 'Main' }],
      openTabs: [MAIN_KEY],
      activeSessionKey: MAIN_KEY,
      messagesPerSession: {},
    });
    useChatStore.getState().addLocalSession({
      key: TEST_KEY,
      label: 'New session',
      agentId: 'worker',
      createdAt: Date.now(),
    });

    const result = await deleteSessionEverywhere(TEST_KEY);

    assert.equal(result, true);
    assert.deepEqual(requests, []);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
  });
});
