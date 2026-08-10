import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useChatStore } from '@/stores/chatStore';
import { useGatewayDataStore } from '@/stores/gatewayDataStore';
import {
  executeSessionLifecycleMutation,
  setSessionLifecycleDependenciesForTests,
} from './sessionLifecycle';

const KEY = 'agent:main:lifecycle-test';

beforeEach(() => {
  useChatStore.setState({
    sessions: [{ key: KEY, sessionId: 'session-1', label: 'Lifecycle' }],
    typingBySession: {},
    sendingBySession: {},
  });
  useGatewayDataStore.setState({ sessions: [] });
  setSessionLifecycleDependenciesForTests();
});

test('删除会话始终直接调用原生 Gateway，不依赖协作插件', async () => {
  const calls: unknown[][] = [];
  setSessionLifecycleDependenciesForTests({
    deleteSession: async (...args) => {
      calls.push(args);
      return { success: true, key: KEY, deleted: true };
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'delete');

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'session-1');
  assert.deepEqual(calls, [[KEY, true, 'session-1']]);
});

test('重置会话始终直接调用原生 Gateway，并采用返回的新会话身份', async () => {
  const calls: string[] = [];
  setSessionLifecycleDependenciesForTests({
    resetSession: async (sessionKey) => {
      calls.push(sessionKey);
      return { success: true, key: sessionKey, entry: { sessionId: 'session-2' } };
    },
  });

  const result = await executeSessionLifecycleMutation(KEY, 'reset');

  assert.equal(result.success, true);
  assert.equal(result.previousSessionId, 'session-1');
  assert.equal(result.sessionId, 'session-2');
  assert.deepEqual(calls, [KEY]);
});

test('重置不要求本地预先加载会话身份', async () => {
  useChatStore.setState({ sessions: [{ key: KEY, label: 'No identity' }] });
  let listed = 0;
  setSessionLifecycleDependenciesForTests({
    listSessions: async () => {
      listed += 1;
      return { sessions: [] };
    },
    resetSession: async () => ({ success: true, key: KEY, entry: { sessionId: 'session-2' } }),
  });

  const result = await executeSessionLifecycleMutation(KEY, 'reset');

  assert.equal(result.success, true);
  assert.equal(result.sessionId, 'session-2');
  assert.equal(result.previousSessionId, null);
  assert.equal(listed, 0);
});

test('删除缺少身份时拒绝请求，避免绕过原生并发身份校验', async () => {
  useChatStore.setState({ sessions: [{ key: KEY, label: 'No identity' }] });
  setSessionLifecycleDependenciesForTests({
    listSessions: async () => ({ sessions: [{ key: KEY }] }),
  });

  await assert.rejects(
    executeSessionLifecycleMutation(KEY, 'delete'),
    /native OpenClaw session identity is unavailable/i,
  );
});

test('Gateway 未确认变更时不产生本地成功结果', async () => {
  setSessionLifecycleDependenciesForTests({
    deleteSession: async () => ({ success: false, key: KEY }),
  });

  await assert.rejects(
    executeSessionLifecycleMutation(KEY, 'delete'),
    /unverifiable response for session delete/i,
  );
});
