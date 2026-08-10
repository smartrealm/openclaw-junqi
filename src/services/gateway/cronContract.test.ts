import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCronAgentTurnAddParams,
  createCronDeclarationKey,
  cronAgentUpdatePatch,
  isCronAgentSelectionConfirmed,
  resolveCronDeclarationKey,
} from './cronContract';

test('cron declaration key is generated from one explicit creation intent', () => {
  assert.equal(
    createCronDeclarationKey('junqi-cron-manual', () => 'request-1'),
    'junqi-cron-manual:request-1',
  );
  assert.throws(() => createCronDeclarationKey(' ', () => 'request-1'), /声明键/);
  assert.throws(() => createCronDeclarationKey('junqi-cron-manual', () => ' '), /声明键/);
});

test('cron declaration retry retains the same unconfirmed request identity', () => {
  const first = resolveCronDeclarationKey(null, 'junqi-cron-manual', () => 'request-1');
  assert.equal(
    resolveCronDeclarationKey(first, 'junqi-cron-manual', () => 'request-2'),
    first,
  );
});

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

test('cron agent-turn creation retains an official declaration key for Gateway-side convergence', () => {
  const params = buildCronAgentTurnAddParams({
    name: 'Calendar reminder',
    declarationKey: ' junqi-calendar-reminder:event-1 ',
    message: 'Review the calendar event.',
    schedule: { kind: 'at', at: '2030-01-02T08:45:00.000Z' },
  });

  assert.equal(params.declarationKey, 'junqi-calendar-reminder:event-1');
});

test('cron schedule input retains the official event-driven schedule variants', () => {
  const streamSchedule = {
    kind: 'stream' as const,
    command: ['node', 'watch.mjs'],
    mode: 'match' as const,
    match: '^ready$',
    batchMs: 250,
  };
  const params = buildCronAgentTurnAddParams({
    name: 'Stream watcher',
    message: 'Process the stream batch.',
    schedule: streamSchedule,
  });

  assert.deepEqual(params.schedule, streamSchedule);
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
