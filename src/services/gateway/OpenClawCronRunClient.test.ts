import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawCronRunClient,
  OpenClawCronRunResponseError,
  OpenClawCronRunUnsupportedError,
  type OpenClawCronRunRequester,
} from './OpenClawCronRunClient';

const finished = {
  ts: 100,
  jobId: 'job-1',
  action: 'finished',
  status: 'ok',
  runId: 'run-1',
  durationMs: 20,
};

const page = {
  entries: [finished],
  total: 1,
  offset: 0,
  limit: 1,
  hasMore: false,
  nextOffset: null,
};

function createClient(
  request: OpenClawCronRunRequester,
  requestPrivileged = request,
): OpenClawCronRunClient {
  return new OpenClawCronRunClient({ request, requestPrivileged });
}

describe('OpenClawCronRunClient', () => {
  it('only accepts a queued manual run with a Gateway run id', async () => {
    const calls: Array<{ lane: string; method: string; params: Record<string, unknown> }> = [];
    const client = createClient(
      async () => page as never,
      async (method, params) => {
        calls.push({ lane: 'admin', method, params });
        return { ok: true, enqueued: true, runId: 'run-1' } as never;
      },
    );

    assert.deepEqual(await client.enqueue('job-1'), { ok: true, enqueued: true, runId: 'run-1' });
    assert.deepEqual(calls, [{ lane: 'admin', method: 'cron.run', params: { id: 'job-1', mode: 'force' } }]);
  });

  it('keeps run history on the read lane', async () => {
    const calls: Array<{ lane: string; method: string; params: Record<string, unknown> }> = [];
    const client = createClient(
      async (method, params) => {
        calls.push({ lane: 'read', method, params });
        return page as never;
      },
      async (method, params) => {
        calls.push({ lane: 'admin', method, params });
        return { ok: true, enqueued: true, runId: 'run-1' } as never;
      },
    );

    assert.deepEqual(await client.findTerminal('job-1', 'run-1'), finished);
    assert.deepEqual(calls, [{ lane: 'read', method: 'cron.runs', params: { scope: 'job', id: 'job-1', runId: 'run-1', limit: 1 } }]);
  });

  it('uses the same lane contract for unsupported responses', async () => {
    const lanes: string[] = [];
    const client = createClient(
      async (method) => {
        lanes.push('read');
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      },
      async (method) => {
        lanes.push('admin');
        throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
      },
    );

    await assert.rejects(client.enqueue('job-1'), OpenClawCronRunUnsupportedError);
    await assert.rejects(client.list('job-1'), OpenClawCronRunUnsupportedError);
    assert.deepEqual(lanes, ['admin', 'read']);
  });

  it('does not settle a run from a different history identity', async () => {
    const client = createClient(async () => ({
      ...page,
      entries: [{ ...finished, runId: 'other-run' }],
    }) as never);

    assert.equal(await client.findTerminal('job-1', 'run-1'), null);
  });

  it('preserves every official terminal status without treating an absent record as completion', async () => {
    for (const status of ['ok', 'error', 'skipped'] as const) {
      const client = createClient(async () => ({
        ...page,
        entries: [{ ...finished, status }],
      }) as never);

      assert.equal((await client.findTerminal('job-1', 'run-1'))?.status, status);
    }

    const pending = createClient(async () => ({ ...page, entries: [] }) as never);
    assert.equal(await pending.findTerminal('job-1', 'run-1'), null);
  });

  it('rejects malformed acknowledgements and history entries', async () => {
    const missingRunId = createClient(async () => ({ ok: true, enqueued: true }) as never);
    const malformedEntry = createClient(async () => ({
      ...page,
      entries: [{ ...finished, status: 'running' }],
    }) as never);

    await assert.rejects(missingRunId.enqueue('job-1'), OpenClawCronRunResponseError);
    await assert.rejects(malformedEntry.list('job-1'), OpenClawCronRunResponseError);
  });

  it('requests methods despite discovery omission and trusts Gateway unsupported responses', async () => {
    let calls = 0;
    const client = createClient(async (method) => {
      calls += 1;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });

    await assert.rejects(client.enqueue('job-1'), OpenClawCronRunUnsupportedError);
    await assert.rejects(client.list('job-1'), OpenClawCronRunUnsupportedError);
    assert.equal(calls, 2);
  });

  it('maps an authoritative method-not-found response to unsupported', async () => {
    const client = createClient(async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });

    await assert.rejects(client.list('job-1'), OpenClawCronRunUnsupportedError);
  });
});
