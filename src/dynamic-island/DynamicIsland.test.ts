import assert from 'node:assert/strict';
import test from 'node:test';
import { hideDynamicIsland } from './DynamicIslandActions';

test('Dynamic Island close returns its intent to the main-window owner', () => {
  const calls: string[] = [];
  hideDynamicIsland(
    (action) => { calls.push(action.type); },
  );
  assert.deepEqual(calls, ['hide']);
});
