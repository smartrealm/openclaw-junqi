import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('workshop does not retain the unrendered activity timeline', async () => {
  const source = await read('./Workshop.tsx');

  assert.doesNotMatch(source, /function ActivityTimeline\(/);
  assert.doesNotMatch(source, /ActivityEntry/);
  assert.doesNotMatch(source, /tasks, activities,/);
});
