import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenClawTaskLedgerClient } from './OpenClawTaskLedgerClient';

const task = { id: 'task-1', status: 'running', sessionKey: 'agent:main:main', updatedAt: 100 };

describe('OpenClawTaskLedgerClient', () => {
  it('uses native task list and get methods with validated responses', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawTaskLedgerClient(async (method, params) => {
      calls.push({ method, params });
      return method === 'tasks.list' ? { tasks: [task], nextCursor: '1' } as never : { task } as never;
    }, async () => ({}) as never);
    assert.deepEqual(await client.list({ status: ['queued', 'running'], sessionKey: 'agent:main:main', limit: 50 }), {
      tasks: [task], nextCursor: '1',
    });
    assert.deepEqual(await client.get('task-1'), task);
    assert.deepEqual(calls, [
      { method: 'tasks.list', params: { status: ['queued', 'running'], sessionKey: 'agent:main:main', limit: 50 } },
      { method: 'tasks.get', params: { taskId: 'task-1' } },
    ]);
  });

  it('uses the privileged lane only for native cancellation', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawTaskLedgerClient(async () => ({}) as never, async (method, params) => {
      calls.push({ method, params });
      return { found: true, cancelled: true, task: { ...task, status: 'cancelled' } } as never;
    });
    assert.deepEqual(await client.cancel('task-1', 'operator stop'), {
      found: true, cancelled: true, task: { ...task, status: 'cancelled' },
    });
    assert.deepEqual(calls, [{ method: 'tasks.cancel', params: { taskId: 'task-1', reason: 'operator stop' } }]);
  });
});
