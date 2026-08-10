import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  OpenClawCronManagementClient,
  OpenClawCronManagementResponseError,
  OpenClawCronManagementUnsupportedError,
} from './OpenClawCronManagementClient';
import type { CronAgentTurnAddParams } from './cronContract';

const agentTurn: CronAgentTurnAddParams = {
  name: 'Daily brief',
  schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'UTC' },
  sessionTarget: 'isolated',
  wakeMode: 'now',
  payload: { kind: 'agentTurn', message: 'Prepare the daily brief.' },
  delivery: { mode: 'none' },
};

describe('OpenClawCronManagementClient', () => {
  it('uses canonical RPC parameters and confirms every mutation response', async () => {
    const calls: Array<{ method: string; params: object }> = [];
    const responses = [{ id: 'job-add' }, { id: 'job-update' }, { ok: true, removed: true }];
    const client = new OpenClawCronManagementClient(async (method, params) => {
      calls.push({ method, params });
      return responses.shift() as never;
    });

    assert.deepEqual(await client.addAgentTurn(agentTurn), { id: 'job-add' });
    assert.deepEqual(await client.update('job-update', { enabled: false }, 'revision-1'), { id: 'job-update' });
    await client.remove('job-remove');

    assert.deepEqual(calls, [
      { method: 'cron.add', params: agentTurn },
      {
        method: 'cron.update',
        params: { id: 'job-update', patch: { enabled: false }, expectedConfigRevision: 'revision-1' },
      },
      { method: 'cron.remove', params: { id: 'job-remove' } },
    ]);
  });

  it('accepts official declaration-key convergence results but requires their returned job id', async () => {
    const client = new OpenClawCronManagementClient(async () => ({
      created: false,
      updated: true,
      job: { id: 'declared-job' },
    }) as never);

    assert.deepEqual(await client.addAgentTurn(agentTurn), { id: 'declared-job' });
  });

  it('rejects malformed success-shaped responses instead of reporting a local success', async () => {
    const invalidAdd = new OpenClawCronManagementClient(async () => ({ id: '' }) as never);
    const invalidUpdate = new OpenClawCronManagementClient(async () => ({ id: 7 }) as never);
    const invalidRemove = new OpenClawCronManagementClient(async () => ({ ok: true, removed: false }) as never);

    await assert.rejects(invalidAdd.addAgentTurn(agentTurn), OpenClawCronManagementResponseError);
    await assert.rejects(invalidUpdate.update('job-update', { agentId: 'ops' }), OpenClawCronManagementResponseError);
    await assert.rejects(invalidRemove.remove('job-remove'), OpenClawCronManagementResponseError);
  });

  it('requests mutations despite discovery omission while invalid input remains local', async () => {
    let calls = 0;
    const unsupported = new OpenClawCronManagementClient(async (method) => {
      calls += 1;
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });
    const invalidPatch = new OpenClawCronManagementClient(async () => {
      throw new Error('request should not be called');
    });

    await assert.rejects(unsupported.addAgentTurn(agentTurn), OpenClawCronManagementUnsupportedError);
    await assert.rejects(unsupported.update('job-update', { enabled: true }), OpenClawCronManagementUnsupportedError);
    await assert.rejects(unsupported.remove('job-remove'), OpenClawCronManagementUnsupportedError);
    assert.equal(calls, 3);
    await assert.rejects(invalidPatch.update('job-update', {}), /Invalid OpenClaw cron update patch/);
    await assert.rejects(invalidPatch.update('job-update', { agentId: '  ' }), /Invalid OpenClaw cron agent id/);
    await assert.rejects(
      invalidPatch.update('job-update', { enabled: true }, '  '),
      /Invalid OpenClaw cron config revision/,
    );
  });

  it('maps authoritative method-not-found responses to unsupported without masking other Gateway errors', async () => {
    const missing = new OpenClawCronManagementClient(async (method) => {
      throw new GatewayRpcError(`unknown method: ${method}`, 'INVALID_REQUEST');
    });
    const denied = new OpenClawCronManagementClient(async () => {
      throw new GatewayRpcError('forbidden', 'FORBIDDEN');
    });

    await assert.rejects(missing.remove('job-remove'), OpenClawCronManagementUnsupportedError);
    await assert.rejects(denied.remove('job-remove'), (error: unknown) => (
      error instanceof GatewayRpcError && error.code === 'FORBIDDEN'
    ));
  });
});
