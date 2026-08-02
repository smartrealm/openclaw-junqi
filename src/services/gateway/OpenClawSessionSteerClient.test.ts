import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionSteerClient,
  OpenClawSessionSteerResponseError,
} from './OpenClawSessionSteerClient';

test('sends the official sessions.steer schema and preserves its acknowledgement', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionSteerClient(async (method, params) => {
    calls.push({ method, params });
    return { runId: 'voice-run', status: 'started', interruptedActiveRun: true };
  });

  const result = await client.steer({
    key: 'agent:main:jarvis',
    message: '继续刚才的任务',
    attachments: [{ type: 'file' }],
    idempotencyKey: 'voice-run',
  });

  assert.deepEqual(result.acknowledgement, { state: 'active', runId: 'voice-run' });
  assert.equal(result.interruptedActiveRun, true);
  assert.deepEqual(calls, [{
    method: 'sessions.steer',
    params: {
      key: 'agent:main:jarvis',
      message: '继续刚才的任务',
      attachments: [{ type: 'file' }],
      idempotencyKey: 'voice-run',
    },
  }]);
});

test('does not infer steer success from an unrecognized Gateway payload', async () => {
  const client = new OpenClawSessionSteerClient(async () => ({
    runId: 'other-run',
    status: 'started',
  }));

  await assert.rejects(
    client.steer({ key: 'agent:main:jarvis', message: '继续', idempotencyKey: 'voice-run' }),
    OpenClawSessionSteerResponseError,
  );
});
