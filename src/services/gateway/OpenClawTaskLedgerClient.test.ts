import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawTaskLedgerClient,
  OpenClawTaskLedgerResponseError,
  OpenClawTaskLedgerUnsupportedError,
} from './OpenClawTaskLedgerClient';

const task = {
  id: ' task-1 ',
  status: 'running',
  sessionKey: 'agent:main:main',
  updatedAt: 100,
  toolUseCount: 2,
  lastToolName: 'read_file',
};

describe('OpenClawTaskLedgerClient', () => {
  it('uses native task methods with the complete official task summary fields', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawTaskLedgerClient(async (method, params) => {
      calls.push({ method, params });
      return method === 'tasks.list'
        ? { tasks: [task], nextCursor: '' } as never
        : { task: { ...task, prompt: 'preserved task prompt' } } as never;
    });

    assert.deepEqual(await client.list({ status: ['queued', 'running'], sessionKey: 'agent:main:main', limit: 50, cursor: '' }), {
      tasks: [task], nextCursor: '', availability: 'available',
    });
    assert.deepEqual(await client.get(' task-1 '), { ...task, prompt: 'preserved task prompt' });
    assert.deepEqual(calls, [
      { method: 'tasks.list', params: { status: ['queued', 'running'], sessionKey: 'agent:main:main', limit: 50, cursor: '' } },
      { method: 'tasks.get', params: { taskId: ' task-1 ' } },
    ]);
  });

  it('uses the normal operator lane for task cancellation', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = new OpenClawTaskLedgerClient(async (method, params) => {
      calls.push({ method, params });
      return { found: true, cancelled: true, task: { ...task, status: 'cancelled' } } as never;
    });

    assert.deepEqual(await client.cancel('task-1'), {
      found: true, cancelled: true, task: { ...task, status: 'cancelled' },
    });
    assert.deepEqual(calls, [{ method: 'tasks.cancel', params: { taskId: 'task-1' } }]);
  });

  it('requests methods despite discovery omission and trusts Gateway unsupported responses', async () => {
    let calls = 0;
    const client = new OpenClawTaskLedgerClient(async () => {
      calls += 1;
      throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND');
    });

    assert.deepEqual(await client.list(), { tasks: [], availability: 'unavailable' });
    await assert.rejects(client.get('task-1'), OpenClawTaskLedgerUnsupportedError);
    await assert.rejects(client.cancel('task-1'), OpenClawTaskLedgerUnsupportedError);
    assert.equal(calls, 3);
  });

  it('treats an unadvertised-method protocol response as unavailable', async () => {
    const client = new OpenClawTaskLedgerClient(async () => {
      throw new GatewayRpcError('missing', 'METHOD_NOT_FOUND');
    });

    assert.deepEqual(await client.list(), { tasks: [], availability: 'unavailable' });
    await assert.rejects(client.get('task-1'), OpenClawTaskLedgerUnsupportedError);
  });

  it('rejects fields that do not satisfy the official response schema', async () => {
    const client = new OpenClawTaskLedgerClient(async () => ({
      tasks: [{ id: 'task-1', status: 'running', updatedAt: -1 }],
    }) as never);

    await assert.rejects(client.list(), OpenClawTaskLedgerResponseError);
  });

  it('preserves official empty optional strings without trimming or omitting them', async () => {
    const client = new OpenClawTaskLedgerClient(async () => ({
      tasks: [{ id: 'task-1', status: 'queued', title: '', progressSummary: '', toolUseCount: 0 }],
    }) as never);

    assert.deepEqual(await client.list(), {
      availability: 'available',
      tasks: [{ id: 'task-1', status: 'queued', title: '', progressSummary: '', toolUseCount: 0 }],
    });
  });
});
