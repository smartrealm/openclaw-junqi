import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('welcome navigation uses the current company emblem instead of the legacy mark', async () => {
  const source = await readFile(new URL('./WelcomePage.tsx', import.meta.url), 'utf8');
  const sidebarHeader = source.slice(
    source.indexOf('<aside'),
    source.indexOf('<nav'),
  );

  assert.match(sidebarHeader, /JunQiLogo variant="company-emblem"/);
  assert.doesNotMatch(sidebarHeader, /JunQiLogo variant="emblem"/);
});
