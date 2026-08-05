import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionAbortClient,
  OpenClawSessionAbortResponseError,
} from './OpenClawSessionAbortClient';

test('sends the native sessions.abort fields and decodes an exact aborted run', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionAbortClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return { ok: true, status: 'aborted', abortedRunId: 'run-stop' } as T;
  });

  assert.deepEqual(await client.abort({
    key: ' agent:main:main ',
    runId: ' run-stop ',
    agentId: ' main ',
  }), {
    ok: true,
    status: 'aborted',
    abortedRunId: 'run-stop',
  });
  assert.deepEqual(calls, [{
    method: 'sessions.abort',
    params: {
      key: 'agent:main:main',
      runId: 'run-stop',
      agentId: 'main',
    },
  }]);
});

test('preserves no-active-run without claiming that a local run was stopped', async () => {
  const client = new OpenClawSessionAbortClient(async <T>(): Promise<T> => ({
    ok: true,
    status: 'no-active-run',
    abortedRunId: null,
  } as T));

  assert.deepEqual(await client.abort({ key: 'agent:main:main' }), {
    ok: true,
    status: 'no-active-run',
    abortedRunId: null,
  });
});

test('allows explicit queue clearing but does not add it by default', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = new OpenClawSessionAbortClient(async <T>(
    _method: string,
    params: Record<string, unknown>,
  ): Promise<T> => {
    calls.push(params);
    return { ok: true, status: 'aborted', abortedRunId: null } as T;
  });

  await client.abort({ key: 'agent:main:main' });
  await client.abort({ key: 'agent:main:main', clearQueued: true });
  assert.deepEqual(calls, [
    { key: 'agent:main:main' },
    { key: 'agent:main:main', clearQueued: true },
  ]);
});

test('rejects unverifiable responses and invalid targets', async () => {
  const client = new OpenClawSessionAbortClient(async <T>(): Promise<T> => ({
    ok: true,
    status: 'aborted',
    abortedRunId: 42,
  } as T));

  await assert.rejects(client.abort({ key: 'agent:main:main' }), OpenClawSessionAbortResponseError);
  await assert.rejects(client.abort({}));
  await assert.rejects(client.abort({ key: '   ' }));
  await assert.rejects(client.abort({ runId: 'run-1', clearQueued: 'yes' as never }));
});
