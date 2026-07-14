import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

test('global dialogs expose semantics, Escape dismissal, and deliberate initial focus', async () => {
  const source = await read('./AlertDialog.tsx');

  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /event\.key !== 'Escape'/);
  assert.match(source, /cancelRef\.current \|\| dismissRef\.current/);
  assert.doesNotMatch(source, /rounded-2xl/);
});
