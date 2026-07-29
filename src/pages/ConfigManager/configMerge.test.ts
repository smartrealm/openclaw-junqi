import test from 'node:test';
import assert from 'node:assert/strict';
import { smartMerge } from './configMerge';

test('BUG-OCA-05 preserves unknown future Runtime fields during an unrelated edit', () => {
  const original = {
    agents: { defaults: { maxConcurrent: 2 } },
    futureRuntimeSection: { mode: 'new', nested: { enabled: true } },
  };
  const disk = {
    ...original,
    futureRuntimeSection: {
      ...original.futureRuntimeSection,
      addedExternally: 42,
    },
  };
  const current = {
    ...original,
    agents: { defaults: { maxConcurrent: 3 } },
  };

  assert.deepEqual(smartMerge(disk, original, current), {
    agents: { defaults: { maxConcurrent: 3 } },
    futureRuntimeSection: {
      mode: 'new',
      nested: { enabled: true },
      addedExternally: 42,
    },
  });
});

test('BUG-OCA-05 preserves a newer external value when the UI did not edit it', () => {
  assert.deepEqual(
    smartMerge(
      { future: { option: 'runtime-v2' } },
      { future: { option: 'runtime-v1' } },
      { future: { option: 'runtime-v1' } },
    ),
    { future: { option: 'runtime-v2' } },
  );
});
