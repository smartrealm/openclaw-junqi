import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('switching files with unsaved edits uses the application confirmation dialog', async () => {
  const source = await read('./WorkspacePanel.tsx');

  assert.match(source, /showConfirm\(/);
  assert.match(source, /workspace\.discardUnsavedTitle/);
  assert.doesNotMatch(source, /window\.confirm/);
});
