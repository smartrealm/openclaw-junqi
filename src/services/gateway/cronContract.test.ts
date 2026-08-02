import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCronAgentTurnAddParams,
  cronAgentUpdatePatch,
  isCronAgentSelectionConfirmed,
} from './cronContract';

test('cron agent-turn creation matches the OpenClaw top-level RPC contract', () => {
  const params = buildCronAgentTurnAddParams({
    name: ' Ops sweep ',
    message: ' Check the queue. ',
    agentId: ' ops ',
    schedule: { kind: 'cron', expr: '0 6 * * *', tz: 'Asia/Shanghai' },
    enabled: true,
  });

  assert.deepEqual(params, {
    name: 'Ops sweep',
    agentId: 'ops',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 6 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'Check the queue.' },
    delivery: { mode: 'none' },
  });
  assert.equal('job' in params, false);
});

test('cron agent-turn creation omits an unpinned default agent', () => {
  const params = buildCronAgentTurnAddParams({
    name: 'Reminder',
    message: 'Review the calendar.',
    agentId: ' ',
    schedule: { kind: 'at', at: '2026-08-03T08:00:00.000Z' },
    deleteAfterRun: true,
  });

  assert.equal('agentId' in params, false);
  assert.equal(params.sessionTarget, 'isolated');
  assert.equal(params.wakeMode, 'now');
});

test('cron Agent updates distinguish pinning from clearing', () => {
  assert.deepEqual(cronAgentUpdatePatch('writer'), { agentId: 'writer' });
  assert.deepEqual(cronAgentUpdatePatch(''), { agentId: null });
  assert.deepEqual(cronAgentUpdatePatch(null), { agentId: null });
});

test('cron Agent updates require a matching refreshed job snapshot', () => {
  const jobs = [
    { id: 'daily', agentId: 'writer' },
    { id: 'default-route' },
  ];

  assert.equal(isCronAgentSelectionConfirmed(jobs, 'daily', 'writer'), true);
  assert.equal(isCronAgentSelectionConfirmed(jobs, 'daily', 'ops'), false);
  assert.equal(isCronAgentSelectionConfirmed(jobs, 'default-route', ''), true);
  assert.equal(isCronAgentSelectionConfirmed(jobs, 'missing', ''), false);
});
