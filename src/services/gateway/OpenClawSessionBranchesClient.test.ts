import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionBranchesClient,
  OpenClawSessionBranchesResponseError,
  parseOpenClawSessionBranches,
} from './OpenClawSessionBranchesClient';

test('OpenClawSessionBranchesClient 只投影官方分支目录并保留会话边界', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionBranchesClient({
    request: async (method, params) => {
      calls.push({ method, params });
      return {
        branches: [{
          leafEntryId: 'leaf-1',
          headline: 'Review the alternative',
          messageCount: 4,
          updatedAt: '2026-08-04T12:00:00.000Z',
          active: true,
          ignored: 'additive',
        }],
      };
    },
    requestPrivileged: async () => { throw new Error('列表不应请求管理员权限'); },
    runMutation: async (_sessionKey, operation) => operation(),
  });

  const branches = await client.list(' agent:main:desk ', ' main ');

  assert.deepEqual(branches, [{
    leafEntryId: 'leaf-1',
    headline: 'Review the alternative',
    messageCount: 4,
    updatedAt: '2026-08-04T12:00:00.000Z',
    active: true,
  }]);
  assert.deepEqual(calls, [{
    method: 'sessions.branches.list',
    params: { sessionKey: 'agent:main:desk', agentId: 'main' },
  }]);
});

test('OpenClawSessionBranchesClient 将分支切换放入同一会话的串行 mutation', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const mutations: string[] = [];
  const client = new OpenClawSessionBranchesClient({
    request: async (method, params) => {
      calls.push({ method, params });
      throw new Error(`普通连接不应写入：${method}`);
    },
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return {};
    },
    runMutation: async (sessionKey, operation) => {
      mutations.push(sessionKey);
      return operation();
    },
  });

  await client.switch('agent:main:desk', ' leaf-2 ', 'main');

  assert.deepEqual(mutations, ['agent:main:desk']);
  assert.deepEqual(calls, [{
    method: 'sessions.branches.switch',
    params: { sessionKey: 'agent:main:desk', agentId: 'main', leafEntryId: 'leaf-2' },
  }]);
});

test('OpenClawSessionBranchesClient 拒绝猜测的分支响应和切换确认', async () => {
  assert.deepEqual(
    parseOpenClawSessionBranches({
      branches: [{ leafEntryId: 'leaf-1', headline: '', messageCount: 0, updatedAt: '', active: false }],
    }),
    [{ leafEntryId: 'leaf-1', headline: '', messageCount: 0, updatedAt: '', active: false }],
  );
  assert.throws(
    () => parseOpenClawSessionBranches({ branches: [{ leafEntryId: 'leaf-1', headline: 'x', messageCount: -1, active: true }] }),
    OpenClawSessionBranchesResponseError,
  );
  const client = new OpenClawSessionBranchesClient({
    request: async () => null,
    requestPrivileged: async () => null,
    runMutation: async (_sessionKey, operation) => operation(),
  });
  await assert.rejects(client.switch('agent:main:desk', 'leaf-1'), OpenClawSessionBranchesResponseError);
});
