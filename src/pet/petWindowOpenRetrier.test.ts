import assert from 'node:assert/strict';
import test from 'node:test';
import { createPetWindowOpenRetrier } from './petWindowOpenRetrier';

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

test('failed pet-window creation retries while its owner remains active', async () => {
  let attempts = 0;
  const scheduled: Array<() => void> = [];
  const retrier = createPetWindowOpenRetrier({
    open: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary native window failure');
    },
    schedule: (callback) => {
      scheduled.push(callback);
      return 1;
    },
    cancel: () => undefined,
    retryDelayMs: 1,
  });

  retrier.start();
  await flushPromises();
  assert.equal(attempts, 1);
  const retry = scheduled.shift();
  assert.ok(retry);

  retry();
  await flushPromises();
  assert.equal(attempts, 2);
});

test('stopping the owner cancels a pending pet-window retry', async () => {
  let attempts = 0;
  const scheduled: Array<() => void> = [];
  let cancelled = false;
  const retrier = createPetWindowOpenRetrier({
    open: async () => {
      attempts += 1;
      throw new Error('temporary native window failure');
    },
    schedule: (callback) => {
      scheduled.push(callback);
      return 1;
    },
    cancel: () => {
      cancelled = true;
    },
    retryDelayMs: 1,
  });

  retrier.start();
  await flushPromises();
  const retry = scheduled.shift();
  assert.ok(retry);

  retrier.stop();
  assert.equal(cancelled, true);
  retry();
  await flushPromises();
  assert.equal(attempts, 1);
});
