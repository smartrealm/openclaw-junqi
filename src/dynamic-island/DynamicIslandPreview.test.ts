import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DYNAMIC_ISLAND_PREVIEW_DURATION_MS,
  DynamicIslandPreview,
  requestDynamicIslandPreview,
} from './DynamicIslandPreview';

test('Dynamic Island preview resets its duration and closes exactly once for the latest preview', () => {
  const active: boolean[] = [];
  const timers = new Map<number, () => void>();
  const cleared: number[] = [];
  let nextTimer = 0;
  const preview = new DynamicIslandPreview({
    schedule: (callback, delayMs) => {
      assert.equal(delayMs, DYNAMIC_ISLAND_PREVIEW_DURATION_MS);
      const timer = ++nextTimer;
      timers.set(timer, callback);
      return timer;
    },
    clear: (timer) => {
      cleared.push(timer);
      timers.delete(timer);
    },
    onChange: (value) => {
      active.push(value);
    },
  });

  preview.start();
  preview.start();
  assert.deepEqual(cleared, [1]);
  const latestTimer = timers.get(2);
  assert.ok(latestTimer);
  latestTimer();
  assert.deepEqual(active, [true, true, false]);
});

test('Dynamic Island preview closes without changing a persisted setting', () => {
  const active: boolean[] = [];
  let scheduled: (() => void) | null = null;
  const preview = new DynamicIslandPreview({
    schedule: (callback) => {
      scheduled = callback;
      return 1;
    },
    clear: () => {
      scheduled = null;
    },
    onChange: (value) => {
      active.push(value);
    },
  });

  preview.start();
  preview.stop();
  assert.equal(scheduled, null);
  assert.deepEqual(active, [true, false]);
});

test('Dynamic Island preview emits only the runtime-owned preview intent', async () => {
  const events: string[] = [];
  await requestDynamicIslandPreview(async (event) => {
    events.push(event);
  });
  assert.deepEqual(events, ['dynamic-island:preview']);
});
