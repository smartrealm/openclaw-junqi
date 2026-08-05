import assert from 'node:assert/strict';
import test from 'node:test';
import { DynamicIslandVisibilityController } from './DynamicIslandVisibilityController';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test('a hide intent received while opening wins before stale window synchronization', async () => {
  const opening = deferred();
  const calls: string[] = [];
  const controller = new DynamicIslandVisibilityController<string>({
    open: async () => {
      calls.push('open');
      await opening.promise;
    },
    close: async () => { calls.push('close'); },
    synchronize: async () => { calls.push('synchronize'); },
  });

  controller.reconcile({ visible: true, snapshot: 'initial', ignorePointerEvents: false });
  await Promise.resolve();
  controller.reconcile({ visible: false, snapshot: 'hidden', ignorePointerEvents: false });
  opening.resolve();
  await controller.whenIdle();

  assert.deepEqual(calls, ['open', 'close']);
});

test('the latest show intent synchronizes after a rapid visibility change', async () => {
  const opening = deferred();
  const calls: string[] = [];
  const controller = new DynamicIslandVisibilityController<string>({
    open: async () => {
      calls.push('open');
      if (calls.length === 1) await opening.promise;
    },
    close: async () => { calls.push('close'); },
    synchronize: async (snapshot) => { calls.push(`synchronize:${snapshot}`); },
  });

  controller.reconcile({ visible: true, snapshot: 'first', ignorePointerEvents: false });
  await Promise.resolve();
  controller.reconcile({ visible: false, snapshot: 'hidden', ignorePointerEvents: false });
  controller.reconcile({ visible: true, snapshot: 'latest', ignorePointerEvents: true });
  opening.resolve();
  await controller.whenIdle();

  assert.deepEqual(calls, ['open', 'open', 'synchronize:latest']);
});
