import assert from 'node:assert/strict';
import test from 'node:test';
import { startRecoverableTask } from './recoverableTask';

test('recoverable task reports an asynchronous rejection once', async () => {
  const failure = new Error('background failure');
  const observed: unknown[] = [];

  startRecoverableTask(() => Promise.reject(failure), (error) => observed.push(error));
  await Promise.resolve();

  assert.deepEqual(observed, [failure]);
});

test('recoverable task reports a synchronous failure once', () => {
  const failure = new Error('synchronous failure');
  const observed: unknown[] = [];

  startRecoverableTask(() => { throw failure; }, (error) => observed.push(error));

  assert.deepEqual(observed, [failure]);
});
