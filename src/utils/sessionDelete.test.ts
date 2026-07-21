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

  beforeEach(() => {
    __resetSessionLifecycleForTest();
    requests = [];
    failures = [];
    warnings = [];
    __setSessionDeleteDepsForTest({
      deleteRemote: async (key) => {
        requests.push(key);
        return { success: true };
      },
      notifyFailure: (detail) => failures.push(detail),
      warn: (...args) => warnings.push(args),
    });
  });

  test('removes local state only after the native deletion succeeds', async () => {
    seed();

    const result = await deleteSessionEverywhere(TEST_KEY);

    assert.equal(result, true);
    assert.deepEqual(requests, [TEST_KEY]);
    assert.equal(useChatStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
    assert.equal(useGatewayDataStore.getState().sessions.some((session) => session.key === TEST_KEY), false);
    assert.deepEqual(useChatStore.getState().openTabs, [MAIN_KEY]);
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
});
