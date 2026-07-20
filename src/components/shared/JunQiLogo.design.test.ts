import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Daxia branch changes only logo artwork and retains JunQi company information', async () => {
  const source = await readFile(new URL('./JunQiLogo.tsx', import.meta.url), 'utf8');

  assert.match(source, /daxia-group-emblem\.png/);
  assert.match(source, /daxia-group-light\.png/);
  assert.match(source, /daxia-group-dark\.png/);
  assert.match(source, /陕西浚启智境科技有限公司/);
  assert.doesNotMatch(source, /junqi-company-logo/);
  assert.match(source, /data-theme-role="light"[\s\S]*dark:hidden/);
  assert.match(source, /data-theme-role="dark"[\s\S]*dark:block/);
  assert.match(source, /left-1\/2[\s\S]*top-1\.5[\s\S]*w-\[190%\][\s\S]*-translate-x-1\/2/);
});
