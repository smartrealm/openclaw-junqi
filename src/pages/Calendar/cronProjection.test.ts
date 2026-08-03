import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectUpcomingCronJobs,
  resolveCronLastRunStatus,
  resolveCronNextRunAtMs,
} from './cronProjection';

test('Cron next-run projection prioritizes the Gateway read view over nested scheduler state', () => {
  assert.equal(resolveCronNextRunAtMs({
    id: 'daily',
    enabled: true,
    nextRunAtMs: 20,
    state: { nextRunAtMs: 10 },
  }), 20);
  assert.equal(resolveCronNextRunAtMs({
    id: 'nested',
    enabled: true,
    state: { nextRunAtMs: 10 },
  }), 10);
  assert.equal(resolveCronNextRunAtMs({
    id: 'invalid',
    enabled: true,
    nextRunAtMs: Number.NaN,
    state: { nextRunAtMs: 10 },
  }), null);
});

test('Cron calendar projection only returns enabled future Gateway schedules in time order', () => {
  const jobs = projectUpcomingCronJobs([
    { id: 'past', name: 'Past', enabled: true, nextRunAtMs: 99 },
    { id: 'disabled', name: 'Disabled', enabled: false, nextRunAtMs: 105 },
    { id: 'missing', name: 'Missing', enabled: true },
    { id: 'later', name: 'Later', enabled: true, nextRunAtMs: 130, lastRunStatus: 'ok' },
    { id: 'soon', enabled: true, state: { nextRunAtMs: 110, lastRunStatus: 'skipped' } },
  ], 100);

  assert.deepEqual(jobs, [
    { id: 'soon', label: 'soon', nextRunAtMs: 110, lastRunStatus: 'skipped' },
    { id: 'later', label: 'Later', nextRunAtMs: 130, lastRunStatus: 'ok' },
  ]);
  assert.equal(resolveCronLastRunStatus({ id: 'invalid-status', enabled: true, lastRunStatus: 'unknown' }), undefined);
});
