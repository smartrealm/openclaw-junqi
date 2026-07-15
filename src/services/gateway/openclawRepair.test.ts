import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenClawRepairCoordinator, gatewayMigrationRetryDelayMs } from './openclawRepair';

test('OpenClaw repair is single-flight and publishes its global busy state', async () => {
  let resolveRepair!: (value: boolean) => void;
  let calls = 0;
  const states: boolean[] = [];
  const coordinator = createOpenClawRepairCoordinator(() => {
    calls += 1;
    return new Promise<boolean>((resolve) => {
      resolveRepair = resolve;
    });
  });
  coordinator.subscribe(() => states.push(coordinator.isRepairing()));

  const first = coordinator.run();
  const second = coordinator.run();

  assert.equal(first, second);
  assert.equal(calls, 1);
  assert.equal(coordinator.isRepairing(), true);
  resolveRepair(true);
  assert.equal(await first, true);
  assert.equal(coordinator.isRepairing(), false);
  assert.deepEqual(states, [true, false]);
});

test('migration lock retry waits for the official expiry without unbounded sleeps', () => {
  const now = Date.parse('2026-07-15T04:48:00.000Z');
  const error = 'OpenClaw startup migrations are already running; retry after the other gateway finishes or after 2026-07-15T04:50:45.044Z.';
  assert.equal(gatewayMigrationRetryDelayMs(error, now), 166_044);
  assert.equal(gatewayMigrationRetryDelayMs(error, Date.parse('2026-07-15T04:51:00.000Z')), 0);
  assert.equal(gatewayMigrationRetryDelayMs('unrelated failure', now), 0);
});
