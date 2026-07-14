import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenClawRepairCoordinator } from './openclawRepair';

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
