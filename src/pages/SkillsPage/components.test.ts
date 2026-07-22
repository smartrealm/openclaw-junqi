import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = () => readFile(new URL('./components.tsx', import.meta.url), 'utf8');

test('skill details use a compact action-oriented drawer and sanitize external readme HTML', async () => {
  const source = await read();

  assert.match(source, /w-\[460px\]/);
  assert.match(source, /DOMPurify\.sanitize\(skill\?\.readme/);
  assert.match(source, /dangerouslySetInnerHTML=\{\{ __html: safeReadme \}\}/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML=\{\{ __html: skill\.readme \}\}/);
  assert.match(source, /resolvedPersona &&/);
});
