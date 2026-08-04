import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENCLAW_SESSIONS_VIEWERS_SET_METHOD,
  OpenClawSessionViewerPresenceClient,
} from './OpenClawSessionViewerPresenceClient';

test('会话查看声明按连接串行替换、去重并确认空集合', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawSessionViewerPresenceClient({
    captureConnectionId: () => 'connection-1',
    isConnectionCurrent: (connectionId) => connectionId === 'connection-1',
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return { sessionKeys: params.sessionKeys };
    },
  });

  assert.equal(await client.setVisibleSessions([' agent:main:b ', 'agent:main:a', 'agent:main:a']), 'applied');
  assert.equal(await client.setVisibleSessions(['agent:main:a', 'agent:main:b']), 'applied');
  assert.equal(await client.setVisibleSessions([]), 'applied');

  assert.deepEqual(calls, [
    {
      method: OPENCLAW_SESSIONS_VIEWERS_SET_METHOD,
      params: { sessionKeys: ['agent:main:a', 'agent:main:b'] },
      connectionId: 'connection-1',
    },
    {
      method: OPENCLAW_SESSIONS_VIEWERS_SET_METHOD,
      params: { sessionKeys: [] },
      connectionId: 'connection-1',
    },
  ]);
});

test('连接变更和畸形响应不会将旧声明带入新连接', async () => {
  let connectionId: string | null = 'connection-1';
  const calls: string[] = [];
  const client = new OpenClawSessionViewerPresenceClient({
    captureConnectionId: () => connectionId,
    isConnectionCurrent: (candidate) => candidate === connectionId,
    requestFenced: async (_method, _params, candidate) => {
      calls.push(candidate);
      return candidate === 'connection-1' ? { sessionKeys: ['agent:main:one'] } : { sessionKeys: [1] };
    },
  });

  assert.equal(await client.setVisibleSessions(['agent:main:one']), 'applied');
  connectionId = 'connection-2';
  assert.equal(await client.setVisibleSessions(['agent:main:one']), 'unavailable');
  connectionId = null;
  assert.equal(await client.setVisibleSessions([]), 'applied');

  assert.deepEqual(calls, ['connection-1', 'connection-2']);
});

test('会话查看声明在未连接或超出官方上限时失败关闭', async () => {
  const client = new OpenClawSessionViewerPresenceClient({
    captureConnectionId: () => null,
    isConnectionCurrent: () => false,
    requestFenced: async () => ({ sessionKeys: [] }),
  });

  assert.equal(await client.setVisibleSessions(['agent:main:one']), 'unavailable');
  assert.throws(
    () => client.setVisibleSessions(Array.from({ length: 33 }, (_, index) => `agent:main:${index}`)),
    /official limit/,
  );
});

test('传输重置会使尚未返回的旧请求失效', async () => {
  let resolveRequest: ((result: unknown) => void) | undefined;
  let requestCount = 0;
  const client = new OpenClawSessionViewerPresenceClient({
    captureConnectionId: () => 'connection-1',
    isConnectionCurrent: (connectionId) => connectionId === 'connection-1',
    requestFenced: (_method, params) => {
      requestCount += 1;
      if (requestCount > 1) return Promise.resolve({ sessionKeys: params.sessionKeys });
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });

  const pending = client.setVisibleSessions(['agent:main:one']);
  client.resetTransport();
  resolveRequest?.({ sessionKeys: ['agent:main:one'] });

  assert.equal(await pending, 'unavailable');
  assert.equal(await client.setVisibleSessions(['agent:main:two']), 'applied');
});
