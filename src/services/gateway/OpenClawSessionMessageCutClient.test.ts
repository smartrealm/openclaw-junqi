import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionMessageCutClient,
  OpenClawSessionMessageCutResponseError,
} from './OpenClawSessionMessageCutClient';

const SESSION_KEY = 'agent:main:desk';

test('消息重绕使用管理员授权并保留官方编辑器恢复结果', async () => {
  const calls: Array<{ lane: string; method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionMessageCutClient({
    request: async (method, params) => {
      calls.push({ lane: 'write', method, params });
      throw new Error('重绕不应使用日常写入连接');
    },
    requestPrivileged: async (method, params) => {
      calls.push({ lane: 'admin', method, params });
      return {
        editorText: '',
        editorAttachments: [{ mimeType: 'image/png', data: 'aW1hZ2U=' }],
      };
    },
    runMutation: async (_sessionKey, operation) => operation(),
  });

  const result = await client.rewind(` ${SESSION_KEY} `, ' user-entry ', ' main ');

  assert.deepEqual(result, {
    editorText: '',
    editorAttachments: [{ mimeType: 'image/png', data: 'aW1hZ2U=' }],
  });
  assert.deepEqual(calls, [{
    lane: 'admin',
    method: 'sessions.rewind',
    params: { sessionKey: SESSION_KEY, entryId: 'user-entry', agentId: 'main' },
  }]);
});

test('消息分叉使用日常写入连接并在原会话 mutation lane 内执行', async () => {
  const calls: Array<{ lane: string; method: string; params: Record<string, unknown> }> = [];
  const mutations: string[] = [];
  const client = new OpenClawSessionMessageCutClient({
    request: async (method, params) => {
      calls.push({ lane: 'write', method, params });
      return { sessionKey: 'agent:main:forked', editorText: '继续处理' };
    },
    requestPrivileged: async (method, params) => {
      calls.push({ lane: 'admin', method, params });
      throw new Error('分叉不应请求管理员权限');
    },
    runMutation: async (sessionKey, operation) => {
      mutations.push(sessionKey);
      return operation();
    },
  });

  const result = await client.fork(SESSION_KEY, 'user-entry');

  assert.deepEqual(result, {
    sessionKey: 'agent:main:forked',
    editorText: '继续处理',
    editorAttachments: [],
  });
  assert.deepEqual(mutations, [SESSION_KEY]);
  assert.deepEqual(calls, [{
    lane: 'write',
    method: 'sessions.fork',
    params: { sessionKey: SESSION_KEY, entryId: 'user-entry' },
  }]);
});

test('消息截断拒绝不完整目标和畸形官方响应', async () => {
  const client = new OpenClawSessionMessageCutClient({
    request: async () => ({ editorText: 1 }),
    requestPrivileged: async () => ({ editorAttachments: [{ mimeType: 'image/png' }] }),
    runMutation: async (_sessionKey, operation) => operation(),
  });

  await assert.rejects(client.rewind(SESSION_KEY, 'user-entry'), OpenClawSessionMessageCutResponseError);
  await assert.rejects(client.fork(SESSION_KEY, 'user-entry'), OpenClawSessionMessageCutResponseError);
  await assert.rejects(client.fork(SESSION_KEY, '   '), OpenClawSessionMessageCutResponseError);
});
