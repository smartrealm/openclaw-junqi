import assert from 'node:assert/strict';
import test from 'node:test';
import { hideDynamicIsland } from './DynamicIslandActions';

test('Dynamic Island close hides locally before the main-window preference sync', () => {
  const calls: string[] = [];
  hideDynamicIsland(
    async () => { calls.push('close'); },
    (action) => { calls.push(action.type); },
  );
  assert.deepEqual(calls, ['close', 'hide']);
});
