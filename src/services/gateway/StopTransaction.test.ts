import assert from 'node:assert/strict';
import test from 'node:test';
import { abortAfterTaskCheckpoint } from './index';

test('does not abort a native Run when its durable Stop checkpoint fails', async () => {
  const events: string[] = [];

  await assert.rejects(
    abortAfterTaskCheckpoint(
      async () => {
        events.push('checkpoint');
        throw new Error('generation conflict');
      },
      async () => {
        events.push('abort');
        return 'unreachable';
      },
    ),
    /generation conflict/,
  );

  assert.deepEqual(events, ['checkpoint']);
});

test('runs the native abort only after the durable Stop checkpoint', async () => {
  const events: string[] = [];

  const result = await abortAfterTaskCheckpoint(
    async () => { events.push('checkpoint'); },
    async () => {
      events.push('abort');
      return 'aborted';
    },
  );

  assert.equal(result, 'aborted');
  assert.deepEqual(events, ['checkpoint', 'abort']);
});
