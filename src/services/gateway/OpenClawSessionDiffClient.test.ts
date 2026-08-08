import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawSessionDiffClient,
  OpenClawSessionDiffResponseError,
  OpenClawSessionDiffUnavailableError,
} from './OpenClawSessionDiffClient';

test('会话变更快照只接受当前连接返回的同一会话', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = new OpenClawSessionDiffClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (id) => id === 'gateway-a',
    requestFenced: async (_method, params) => {
      calls.push(params);
      return {
        sessionKey: 'agent:main:one',
        root: '/workspace',
        branch: 'feature/session-diff',
        baseRef: 'main',
        files: [{
          path: 'src/file.ts',
          oldPath: 'src/old-file.ts',
          status: 'renamed',
          additions: 2,
          deletions: 1,
          patch: '@@ -1 +1 @@',
        }],
        additions: 2,
        deletions: 1,
      };
    },
  });

  assert.deepEqual(await client.get(' agent:main:one ', ' main '), {
    sessionKey: 'agent:main:one',
    root: '/workspace',
    branch: 'feature/session-diff',
    baseRef: 'main',
    files: [{
      path: 'src/file.ts',
      oldPath: 'src/old-file.ts',
      status: 'renamed',
      additions: 2,
      deletions: 1,
      patch: '@@ -1 +1 @@',
    }],
    additions: 2,
    deletions: 1,
  });
  assert.deepEqual(calls, [{ sessionKey: 'agent:main:one', agentId: 'main' }]);
});

test('会话变更优先使用带 operator.admin 的特权连接', async () => {
  const lanes: string[] = [];
  const client = new OpenClawSessionDiffClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => {
      lanes.push('ordinary');
      throw new Error('ordinary connection must not be used when privileged lane exists');
    },
    requestPrivileged: async (method, params, connectionId) => {
      lanes.push(`${method}:${JSON.stringify(params)}:${connectionId}`);
      return {
        sessionKey: 'agent:main:one',
        files: [],
        additions: 0,
        deletions: 0,
      };
    },
  });

  await client.get('agent:main:one');
  assert.deepEqual(lanes, ['sessions.diff:{"sessionKey":"agent:main:one"}:gateway-a']);
});

test('会话变更快照拒绝身份错配和畸形协议字段', async () => {
  const identityMismatch = new OpenClawSessionDiffClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({
      sessionKey: 'agent:main:other',
      files: [],
      additions: 0,
      deletions: 0,
    }),
  });
  await assert.rejects(
    identityMismatch.get('agent:main:one'),
    OpenClawSessionDiffResponseError,
  );

  const malformedFile = new OpenClawSessionDiffClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({
      sessionKey: 'agent:main:one',
      files: [{ path: 'src/file.ts', status: 'changed', additions: 0, deletions: 0 }],
      additions: 0,
      deletions: 0,
    }),
  });
  await assert.rejects(
    malformedFile.get('agent:main:one'),
    OpenClawSessionDiffResponseError,
  );
});

test('会话变更快照在连接切换后失败关闭', async () => {
  const client = new OpenClawSessionDiffClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => false,
    requestFenced: async () => ({
      sessionKey: 'agent:main:one',
      files: [],
      additions: 0,
      deletions: 0,
    }),
  });

  await assert.rejects(
    client.get('agent:main:one'),
    OpenClawSessionDiffUnavailableError,
  );
});

test('会话变更快照保留 Gateway 的缺失权限事实', async () => {
  const client = new OpenClawSessionDiffClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => {
      throw new GatewayRpcError(
        'missing scope: operator.admin',
        'UNAUTHORIZED',
      );
    },
    requestPrivileged: async () => {
      throw new GatewayRpcError(
        'missing scope: operator.admin',
        'UNAUTHORIZED',
      );
    },
  });

  await assert.rejects(
    client.get('agent:main:one'),
    (error: unknown) => error instanceof OpenClawSessionDiffUnavailableError
      && error.missingScope === 'operator.admin'
      && error.authorization,
  );
});
