import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PetPositionScheduler, type PetPoint } from './petPositionScheduler';

test('coalesces moves while IPC is in flight and keeps the latest point', async () => {
  const calls: PetPoint[] = [];
  const frames: FrameRequestCallback[] = [];
  const resolvers: Array<() => void> = [];
  const scheduler = new PetPositionScheduler(
    (point) => new Promise<void>((resolve) => {
      calls.push(point);
      resolvers.push(resolve);
    }),
    (callback) => { frames.push(callback); return frames.length; },
    () => undefined,
  );

  scheduler.enqueue({ x: 1, y: 1 });
  scheduler.enqueue({ x: 2, y: 2 });
  frames.shift()?.(0);
  assert.deepEqual(calls, [{ x: 2, y: 2 }]);

  scheduler.enqueue({ x: 3, y: 3 });
  scheduler.enqueue({ x: 4, y: 4 });
  assert.equal(calls.length, 1);
  resolvers.shift()?.();
  await Promise.resolve();
  frames.shift()?.(16);
  assert.deepEqual(calls, [{ x: 2, y: 2 }, { x: 4, y: 4 }]);
});

test('calls browser frame APIs with the window receiver', () => {
  const browserWindow = window as typeof window & {
    requestAnimationFrame: typeof requestAnimationFrame;
    cancelAnimationFrame: typeof cancelAnimationFrame;
  };
  const originalRequest = browserWindow.requestAnimationFrame;
  const originalCancel = browserWindow.cancelAnimationFrame;
  let scheduled: FrameRequestCallback | null = null;
  let cancelled = 0;

  browserWindow.requestAnimationFrame = function requestFrame(callback) {
    assert.equal(this, browserWindow);
    scheduled = callback;
    return 27;
  };
  browserWindow.cancelAnimationFrame = function cancelFrame(handle) {
    assert.equal(this, browserWindow);
    cancelled = handle;
  };

  try {
    const scheduler = new PetPositionScheduler(async () => undefined);
    scheduler.enqueue({ x: 1, y: 2 });
    assert.ok(scheduled);
    scheduler.cancel();
    assert.equal(cancelled, 27);
  } finally {
    browserWindow.requestAnimationFrame = originalRequest;
    browserWindow.cancelAnimationFrame = originalCancel;
  }
});

test('continues with the latest point after a rejected move', async () => {
  const calls: PetPoint[] = [];
  const frames: FrameRequestCallback[] = [];
  let attempt = 0;
  const scheduler = new PetPositionScheduler(
    (point) => {
      calls.push(point);
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('transient IPC failure')) : Promise.resolve();
    },
    (callback) => { frames.push(callback); return frames.length; },
    () => undefined,
  );

  scheduler.enqueue({ x: 1, y: 1 });
  frames.shift()?.(0);
  scheduler.enqueue({ x: 2, y: 2 });
  await Promise.resolve();
  frames.shift()?.(16);

  assert.deepEqual(calls, [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
});

test('does not restart scheduling after disposal during an in-flight move', async () => {
  const calls: PetPoint[] = [];
  const frames: FrameRequestCallback[] = [];
  let resolveMove: (() => void) | undefined;
  const scheduler = new PetPositionScheduler(
    (point) => new Promise<void>((resolve) => {
      calls.push(point);
      resolveMove = resolve;
    }),
    (callback) => { frames.push(callback); return frames.length; },
    () => undefined,
  );

  scheduler.enqueue({ x: 1, y: 1 });
  frames.shift()?.(0);
  scheduler.enqueue({ x: 2, y: 2 });
  scheduler.dispose();
  scheduler.enqueue({ x: 3, y: 3 });
  resolveMove?.();
  await Promise.resolve();

  assert.deepEqual(calls, [{ x: 1, y: 1 }]);
  assert.equal(frames.length, 0);
});

test('recovers after a synchronous move failure', () => {
  const calls: PetPoint[] = [];
  const frames: FrameRequestCallback[] = [];
  let attempt = 0;
  const scheduler = new PetPositionScheduler(
    (point) => {
      calls.push(point);
      attempt += 1;
      if (attempt === 1) throw new Error('synchronous IPC failure');
      return Promise.resolve();
    },
    (callback) => { frames.push(callback); return frames.length; },
    () => undefined,
  );

  scheduler.enqueue({ x: 1, y: 1 });
  assert.doesNotThrow(() => frames.shift()?.(0));
  scheduler.enqueue({ x: 2, y: 2 });
  frames.shift()?.(16);

  assert.deepEqual(calls, [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
});
