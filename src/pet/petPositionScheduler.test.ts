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
