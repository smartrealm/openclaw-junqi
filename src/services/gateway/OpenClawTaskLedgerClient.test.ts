import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawTaskLedgerClient,
  OpenClawTaskLedgerUnavailableError,
  OpenClawTaskLedgerResponseError,
  OpenClawTaskLedgerUnsupportedError,
} from './OpenClawTaskLedgerClient';

const task = {
  id: ' task-1 ',
  status: 'running',
  sessionKey: 'agent:main:main',
  updatedAt: 100,
};

function createClient(request: (method: string, params: Record<string, unknown>) => Promise<unknown>): OpenClawTaskLedgerClient {
  return new OpenClawTaskLedgerClient({
    captureConnectionId: () => 'gateway-a',
    isConnectionCurrent: (connectionId) => connectionId === 'gateway-a',
    requestFenced: request,
  });
}

describe('OpenClawTaskLedgerClient', () => {
  it('uses native task methods with the complete official task summary fields', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = createClient(async (method, params) => {
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
    const client = createClient(async (method, params) => {
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
    const client = createClient(async (method) => {
      calls += 1;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });

    assert.deepEqual(await client.list(), { tasks: [], availability: 'unavailable' });
    await assert.rejects(client.get('task-1'), OpenClawTaskLedgerUnsupportedError);
    await assert.rejects(client.cancel('task-1'), OpenClawTaskLedgerUnsupportedError);
    await assert.rejects(client.retry(['task-1']), OpenClawTaskLedgerUnsupportedError);
    await assert.rejects(client.dismiss(['task-1']), OpenClawTaskLedgerUnsupportedError);
    assert.equal(calls, 5);
  });

  it('treats an unadvertised-method protocol response as unavailable', async () => {
    const client = createClient(async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });

    assert.deepEqual(await client.list(), { tasks: [], availability: 'unavailable' });
    await assert.rejects(client.get('task-1'), OpenClawTaskLedgerUnsupportedError);
  });

  it('rejects fields that do not satisfy the official response schema', async () => {
    const client = createClient(async () => ({
      tasks: [{ id: 'task-1', status: 'running', updatedAt: -1 }],
    }) as never);

    await assert.rejects(client.list(), OpenClawTaskLedgerResponseError);
  });

  it('accepts current stable summary fields and only accepts detail fields from lookup responses', async () => {
    const client = createClient(async (method) => method === 'tasks.get'
      ? { task: { ...task, toolUseCount: 1, lastToolName: 'exec', deliveryStatus: 'failed', terminalOutcome: 'blocked', prompt: 'preserved task prompt', result: 'preserved task result' } } as never
      : { tasks: [{ ...task, prompt: 'not valid in a list response' }] } as never);

    assert.deepEqual(await client.get('task-1'), { ...task, toolUseCount: 1, lastToolName: 'exec', deliveryStatus: 'failed', terminalOutcome: 'blocked', prompt: 'preserved task prompt', result: 'preserved task result' });
    await assert.rejects(client.list(), OpenClawTaskLedgerResponseError);

    const detailFieldListClient = createClient(async () => ({
      tasks: [{ ...task, result: 'not valid in a list response' }],
    }) as never);
    await assert.rejects(detailFieldListClient.list(), OpenClawTaskLedgerResponseError);
  });

  it('preserves official empty optional strings without trimming or omitting them', async () => {
    const client = createClient(async () => ({
      tasks: [{ id: 'task-1', status: 'queued', title: '', progressSummary: '' }],
    }) as never);

    assert.deepEqual(await client.list(), {
      availability: 'available',
      tasks: [{ id: 'task-1', status: 'queued', title: '', progressSummary: '' }],
    });
  });

  it('uses bounded native delivery recovery methods and preserves recovery detail snapshots', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = createClient(async (method, params) => {
      calls.push({ method, params });
      return {
        results: [{ taskId: 'task-1', ok: true, duplicateRisk: method === 'tasks.retry', task: { ...task, status: 'completed', deliveryStatus: 'failed', terminalOutcome: 'blocked', result: 'retained result', prompt: 'retained prompt' } }],
      };
    });

    assert.deepEqual(await client.retry(['task-1']), {
      results: [{ taskId: 'task-1', ok: true, duplicateRisk: true, task: { ...task, status: 'completed', deliveryStatus: 'failed', terminalOutcome: 'blocked', result: 'retained result', prompt: 'retained prompt' } }],
    });
    await client.dismiss(['task-1']);
    assert.deepEqual(calls, [
      { method: 'tasks.retry', params: { taskIds: ['task-1'] } },
      { method: 'tasks.dismiss', params: { taskIds: ['task-1'] } },
    ]);
    await assert.rejects(client.retry([]));
    await assert.rejects(client.dismiss(Array.from({ length: 11 }, (_, index) => `task-${index}`)));
  });

  it('does not send task requests when the attested Gateway connection changes', async () => {
    let sent = false;
    const client = new OpenClawTaskLedgerClient({
      captureConnectionId: () => 'gateway-a',
      isConnectionCurrent: () => false,
      requestFenced: async () => {
        sent = true;
        return { tasks: [] };
      },
    });

    await assert.rejects(client.list(), OpenClawTaskLedgerUnavailableError);
    assert.equal(sent, false);
  });

  it('rejects a response that arrives after its Gateway connection changes', async () => {
    let current = true;
    const client = new OpenClawTaskLedgerClient({
      captureConnectionId: () => 'gateway-a',
      isConnectionCurrent: () => current,
      requestFenced: async () => {
        current = false;
        return { tasks: [] };
      },
    });

    await assert.rejects(client.list(), OpenClawTaskLedgerUnavailableError);
  });
});
