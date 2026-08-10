import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionCompactionClient } from './SessionCompactionClient';
import { OpenClawSessionTargetError } from './OpenClawSessionTarget';

const SESSION_KEY = 'agent:main:main';
const CHECKPOINT_ID = 'checkpoint-1';
const CHECKPOINT = {
  checkpointId: CHECKPOINT_ID,
  sessionKey: SESSION_KEY,
  sessionId: 'session-1',
  createdAt: 1_735_000_000_000,
  reason: 'manual',
  preCompaction: { sessionId: 'session-1', entryId: 'entry-before' },
  postCompaction: { sessionId: 'session-1', entryId: 'entry-after' },
};

test('keeps checkpoint branches and restores on their declared lanes', async () => {
  const calls: Array<{ lane: 'daily' | 'admin'; method: string; params: Record<string, unknown> }> = [];
  const client = new SessionCompactionClient({
    request: async (method, params) => {
      calls.push({ lane: 'daily', method, params });
      return {
        ok: true,
        sourceKey: SESSION_KEY,
        key: 'agent:main:branch-1',
        sessionId: 'session-branch',
        checkpoint: CHECKPOINT,
        entry: { sessionId: 'session-branch', updatedAt: 1_735_000_000_100 },
      };
    },
    requestPrivileged: async (method, params) => {
      calls.push({ lane: 'admin', method, params });
      return {
        ok: true,
        key: SESSION_KEY,
        sessionId: 'session-restored',
        checkpoint: CHECKPOINT,
        entry: { sessionId: 'session-restored', updatedAt: 1_735_000_000_200 },
      };
    },
    runMutation: (_key, operation) => operation(),
  });

  await client.branch(SESSION_KEY, CHECKPOINT_ID, 'main');
  await client.restore(SESSION_KEY, CHECKPOINT_ID, 'main');

  assert.deepEqual(calls, [
    { lane: 'daily', method: 'sessions.compaction.branch', params: { key: SESSION_KEY, agentId: 'main', checkpointId: CHECKPOINT_ID } },
    { lane: 'admin', method: 'sessions.compaction.restore', params: { key: SESSION_KEY, agentId: 'main', checkpointId: CHECKPOINT_ID } },
  ]);
});

test('serializes branch and restore mutations through the shared session lane', async () => {
  const order: string[] = [];
  let releaseBranch!: () => void;
  const branchBlocked = new Promise<void>((resolve) => { releaseBranch = resolve; });
  let calls = 0;
  const client = new SessionCompactionClient({
    request: async (method) => {
      calls += 1;
      order.push(`start-${method}`);
      if (method === 'sessions.compaction.branch') await branchBlocked;
      order.push(`end-${method}`);
      if (method === 'sessions.compaction.branch') {
        return {
          ok: true,
          sourceKey: SESSION_KEY,
          key: 'agent:main:branch-1',
          sessionId: 'session-branch',
          checkpoint: CHECKPOINT,
          entry: { sessionId: 'session-branch', updatedAt: 1 },
        };
      }
      return {
        ok: true,
        key: SESSION_KEY,
        sessionId: 'session-restored',
        checkpoint: CHECKPOINT,
        entry: { sessionId: 'session-restored', updatedAt: 2 },
      };
    },
    requestPrivileged: async (method) => {
      order.push(`start-${method}`);
      order.push(`end-${method}`);
      return {
        ok: true,
        key: SESSION_KEY,
        sessionId: 'session-restored',
        checkpoint: CHECKPOINT,
        entry: { sessionId: 'session-restored', updatedAt: 2 },
      };
    },
    runMutation: (() => {
      const pending = new Map<string, Promise<unknown>>();
      return (key, operation) => {
        const previous = pending.get(key);
        const result = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(operation);
        pending.set(key, result);
        void result.finally(() => {
          if (pending.get(key) === result) pending.delete(key);
        }).catch(() => undefined);
        return result;
      };
    })(),
  });

  const first = client.branch(SESSION_KEY, CHECKPOINT_ID);
  const second = client.restore(SESSION_KEY, CHECKPOINT_ID);
  await Promise.resolve();
  assert.equal(calls, 1);
  releaseBranch();
  await Promise.all([first, second]);
  assert.deepEqual(order, [
    'start-sessions.compaction.branch',
    'end-sessions.compaction.branch',
    'start-sessions.compaction.restore',
    'end-sessions.compaction.restore',
  ]);
});

test('在请求或 mutation coordinator 前拒绝缺失检查点会话目标', async () => {
  let mutations = 0;
  let requests = 0;
  const client = new SessionCompactionClient({
    request: async () => {
      requests += 1;
      return {};
    },
    requestPrivileged: async () => {
      requests += 1;
      return {};
    },
    runMutation: async (_key, operation) => {
      mutations += 1;
      return operation();
    },
  });
  const missingTarget = '   ';

  await assert.rejects(client.branch(missingTarget, CHECKPOINT_ID), OpenClawSessionTargetError);
  await assert.rejects(client.restore(missingTarget, CHECKPOINT_ID), OpenClawSessionTargetError);
  assert.equal(mutations, 0);
  assert.equal(requests, 0);
});
