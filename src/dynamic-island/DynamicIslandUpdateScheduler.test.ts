import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_ISLAND_UPDATE_THROTTLE_MS,
  DynamicIslandUpdateScheduler,
} from './DynamicIslandUpdateScheduler';

test('coalesces rapid dynamic island updates and publishes once with the latest state', () => {
  const pending = { callback: null as (() => void) | null };
  let scheduleCount = 0;
  let published = 0;
  const scheduler = new DynamicIslandUpdateScheduler({
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, DYNAMIC_ISLAND_UPDATE_THROTTLE_MS);
      scheduleCount += 1;
      pending.callback = callback;
      return scheduleCount;
    },
    clear: () => undefined,
    publish: () => { published += 1; },
  });

  scheduler.request();
  scheduler.request();
  assert.equal(scheduleCount, 1);
  assert.equal(published, 0);
  pending.callback?.();
  assert.equal(published, 1);

  scheduler.request();
  scheduler.cancel();
  pending.callback?.();
  assert.equal(scheduleCount, 2);
  assert.equal(published, 1);
});

test('disposed scheduler ignores future requests and clears pending work', () => {
  const pending = { callback: null as (() => void) | null };
  let cleared = 0;
  let published = 0;
  const scheduler = new DynamicIslandUpdateScheduler({
    schedule: (callback) => {
      pending.callback = callback;
      return 1;
    },
    clear: () => { cleared += 1; },
    publish: () => { published += 1; },
  });

  scheduler.request();
  scheduler.dispose();
  scheduler.request();
  pending.callback?.();
  assert.equal(cleared, 1);
  assert.equal(published, 0);
});
