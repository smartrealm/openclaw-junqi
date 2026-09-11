import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyClassicOpenClawModel } from './classicOpenClawModelVerification';

function createPorts(events: string[], overrides: Record<string, unknown> = {}) {
  return {
    captureConnectionId: () => 'connection-1',
    isConnectionCurrent: () => true,
    requestFenced: async (method: string, params: Record<string, unknown>) => {
      events.push(method);
      if (method === 'agents.list') {
        return {
          defaultId: 'main',
          mainKey: 'main',
          scope: 'per-sender',
          agents: [{ id: 'main' }],
        };
      }
      return { runId: params.runId, status: 'ok' };
    },
    requestPrivileged: async (method: string, params: Record<string, unknown>) => {
      events.push(method);
      if (method === 'agent.wait') {
        return { runId: params.runId, status: 'ok' };
      }
      return {
        runId: 'run-1',
        sessionKey: params.sessionKey,
        status: 'accepted',
      };
    },
    cleanupSession: async () => { events.push('cleanup'); },
    createId: () => 'probe-1',
    ...overrides,
  } as Parameters<typeof verifyClassicOpenClawModel>[0];
}

test('Classic 既有配置通过官方 agent 终态核验后删除隔离会话', async () => {
  const events: string[] = [];

  const result = await verifyClassicOpenClawModel(createPorts(events));

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['agents.list', 'agent', 'agent.wait', 'cleanup']);
});

test('默认探针标识通过 Web Crypto 实例生成', async () => {
  const events: string[] = [];
  const ports = createPorts(events);
  delete ports.createId;

  const result = await verifyClassicOpenClawModel(ports);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ['agents.list', 'agent', 'agent.wait', 'cleanup']);
});

test('智能体目录读取失败时返回未核验且不清理不存在的会话', async () => {
  const events: string[] = [];
  const result = await verifyClassicOpenClawModel(createPorts(events, {
    requestFenced: async (method: string) => {
      events.push(method);
      throw new Error('agent inventory unavailable');
    },
  }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /agent inventory unavailable/);
  assert.deepEqual(events, ['agents.list']);
});

test('agent.wait 未返回成功终态时保持配置未核验并执行清理', async () => {
  const events: string[] = [];
  const result = await verifyClassicOpenClawModel(createPorts(events, {
    requestPrivileged: async (method: string, params: Record<string, unknown>) => {
      events.push(method);
      if (method === 'agent') {
        return {
          runId: 'run-1',
          sessionKey: params.sessionKey,
          status: 'accepted',
        };
      }
      return { runId: params.runId, status: 'error' };
    },
  }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /did not complete successfully/);
  assert.deepEqual(events, ['agents.list', 'agent', 'agent.wait', 'cleanup']);
});

test('模型核验期间连接变化时不得接受旧连接结果', async () => {
  const events: string[] = [];
  let currentChecks = 0;
  const result = await verifyClassicOpenClawModel(createPorts(events, {
    isConnectionCurrent: () => {
      currentChecks += 1;
      return currentChecks < 3;
    },
  }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /connection changed/);
  assert.deepEqual(events, ['agents.list', 'agent', 'cleanup']);
});

test('成功核验后的会话清理失败时不提交完成状态', async () => {
  const events: string[] = [];
  const result = await verifyClassicOpenClawModel(createPorts(events, {
    cleanupSession: async () => {
      events.push('cleanup');
      throw new Error('delete rejected');
    },
  }));

  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.error, /cleanup failed/);
  assert.deepEqual(events, ['agents.list', 'agent', 'agent.wait', 'cleanup']);
});
