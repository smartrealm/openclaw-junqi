import assert from 'node:assert/strict';
import test from 'node:test';
import { BackdropSampleScheduler } from './backdropSampleScheduler';

test('backdrop sampling follows continuous movement at a bounded rate', async () => {
  let now = 0;
  const samples: number[] = [];
  const timers: Array<() => void> = [];
  const resolvers: Array<(value: number) => void> = [];
  const scheduler = new BackdropSampleScheduler<number>({
    intervalMs: 120,
    now: () => now,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => undefined,
    sample: () => new Promise<number>((resolve) => resolvers.push(resolve)),
    publish: (value) => samples.push(value),
  });

  scheduler.request();
  scheduler.request();
  scheduler.request();
  assert.equal(resolvers.length, 1);

  resolvers.shift()?.(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(samples, []);
  assert.equal(timers.length, 1);

  now = 120;
  timers.shift()?.();
  assert.equal(resolvers.length, 1);
  resolvers.shift()?.(2);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(samples, [2]);
});

test('backdrop sampling drops an in-flight result superseded by a movement request', async () => {
  let now = 0;
  const samples: number[] = [];
  const timers: Array<() => void> = [];
  const resolvers: Array<(value: number) => void> = [];
  const scheduler = new BackdropSampleScheduler<number>({
    intervalMs: 120,
    now: () => now,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => undefined,
    sample: () => new Promise<number>((resolve) => resolvers.push(resolve)),
    publish: (value) => samples.push(value),
  });

  scheduler.request();
  scheduler.request();
  resolvers.shift()?.(1);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(samples, []);

  now = 120;
  timers.shift()?.();
  resolvers.shift()?.(2);
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(samples, [2]);
});

test('backdrop sampling recovers after a failed sample and keeps the latest request', async () => {
  let now = 0;
  const timers: Array<() => void> = [];
  let attempt = 0;
  let failures = 0;
  const scheduler = new BackdropSampleScheduler<number>({
    intervalMs: 120,
    now: () => now,
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: () => undefined,
    sample: () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('capture failed')) : Promise.resolve(2);
    },
    publish: () => undefined,
    fail: () => { failures += 1; },
  });

  scheduler.request();
  scheduler.request();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers.length, 1);
  assert.equal(failures, 1);

  now = 120;
  timers.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(attempt, 2);
  assert.equal(failures, 1);
});

test('disposed backdrop sampling never publishes a late native result', async () => {
  let resolveSample: ((value: number) => void) | undefined;
  const published: number[] = [];
  const scheduler = new BackdropSampleScheduler<number>({
    intervalMs: 120,
    sample: () => new Promise<number>((resolve) => { resolveSample = resolve; }),
    publish: (value) => published.push(value),
  });

  scheduler.request();
  scheduler.dispose();
  resolveSample?.(1);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(published, []);
});
