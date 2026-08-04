import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawSessionFilesClient,
  OpenClawSessionFileConflictError,
  OpenClawSessionFilesResponseError,
  OpenClawSessionFilesUnavailableError,
} from './OpenClawSessionFilesClient';

const sessionKey = 'agent:main:session-files';
const hash = 'a'.repeat(64);

test('会话文件读取绑定当前会话和 Gateway 连接', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: async (method, params) => {
      calls.push({ method, params });
      if (method === 'sessions.files.list') {
        return {
          sessionKey,
          root: '/workspace',
          gitCheckout: true,
          files: [{ path: 'src/main.ts', name: 'main.ts', kind: 'modified', missing: false }],
          browser: {
            path: '',
            entries: [{ path: 'src', name: 'src', kind: 'directory', sessionKind: 'modified' }],
          },
        };
      }
      return {
        sessionKey,
        root: '/workspace',
        file: {
          path: 'src/main.ts',
          name: 'main.ts',
          kind: 'modified',
          missing: false,
          content: 'export {};',
          hash,
          mimeType: 'text/plain',
          contentEncoding: 'utf8',
          previewKind: 'text',
        },
      };
    },
  });

  assert.equal((await client.list(` ${sessionKey} `, { agentId: ' main ' })).browser?.entries[0]?.name, 'src');
  assert.equal((await client.get(sessionKey, ' src/main.ts ', 'main')).file.content, 'export {};');
  assert.deepEqual(calls, [
    { method: 'sessions.files.list', params: { sessionKey, agentId: 'main' } },
    { method: 'sessions.files.get', params: { sessionKey, path: 'src/main.ts', agentId: 'main' } },
  ]);
});

test('会话文件读取拒绝错配和畸形协议响应', async () => {
  const wrongSession = new OpenClawSessionFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({ sessionKey: 'agent:main:other', files: [] }),
  });
  await assert.rejects(wrongSession.list(sessionKey), OpenClawSessionFilesResponseError);

  const malformedFile = new OpenClawSessionFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => ({
      sessionKey,
      file: { path: 'src/main.ts', name: 'main.ts', kind: 'modified', missing: false, hash: 'bad' },
    }),
  });
  await assert.rejects(malformedFile.get(sessionKey, 'src/main.ts'), OpenClawSessionFilesResponseError);
});

test('会话文件读取在连接切换后失败关闭', async () => {
  const client = new OpenClawSessionFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => false,
    requestFenced: async () => ({ sessionKey, files: [] }),
  });
  await assert.rejects(client.list(sessionKey), OpenClawSessionFilesUnavailableError);
});

test('会话文件写入只走管理员请求并保留原生 CAS 冲突', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => { throw new Error('写入不应使用日常连接'); },
    requestPrivileged: async (method, params) => {
      calls.push({ method, params });
      return {
        sessionKey,
        file: { path: 'src/main.ts', name: 'main.ts', kind: 'modified', missing: false, hash },
      };
    },
  });
  assert.equal((await client.set(sessionKey, 'src/main.ts', 'next\n', hash, 'main')).file.hash, hash);
  assert.deepEqual(calls, [{
    method: 'sessions.files.set',
    params: { sessionKey, path: 'src/main.ts', content: 'next\n', expectedHash: hash, agentId: 'main' },
  }]);

  const conflict = new OpenClawSessionFilesClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: () => true,
    requestFenced: async () => null,
    requestPrivileged: async () => {
      throw new GatewayRpcError('conflict', 'INVALID_REQUEST', {
        type: 'session_file_conflict',
        currentHash: 'b'.repeat(64),
      });
    },
  });
  await assert.rejects(
    conflict.set(sessionKey, 'src/main.ts', 'next\n', hash),
    (error: unknown) => error instanceof OpenClawSessionFileConflictError && error.currentHash === 'b'.repeat(64),
  );
});
