import assert from 'node:assert/strict';
import test from 'node:test';
import { hideDynamicIsland } from './DynamicIslandActions';

test('Dynamic Island close hides natively and returns its intent to the main-window owner', async () => {
  const calls: string[] = [];
  await hideDynamicIsland(
    async () => { calls.push('native-hide'); },
    async (action) => { calls.push(action.type); },
  );
  assert.deepEqual(calls.sort(), ['hide', 'native-hide']);
});

test('Dynamic Island close keeps the main-window intent when native hiding fails', async () => {
  const calls: string[] = [];
  await assert.rejects(
    hideDynamicIsland(
      async () => { throw new Error('native hide failed'); },
      async (action) => { calls.push(action.type); },
    ),
    /native hide failed/,
  );
  assert.deepEqual(calls, ['hide']);
});
