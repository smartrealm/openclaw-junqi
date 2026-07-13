import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('company lockup keeps the brand mark while text follows theme contrast tokens', async () => {
  const source = await readFile(new URL('./JunQiLogo.tsx', import.meta.url), 'utf8');
  const lockup = source.slice(
    source.indexOf("if (variant === 'lockup')"),
    source.indexOf("if (variant === 'company-emblem')"),
  );

  assert.match(lockup, />凌启智境</);
  assert.match(lockup, /JUNQI INTELLIGENCE/);
  assert.match(lockup, /text-aegis-text/);
  assert.match(lockup, /text-aegis-text-muted/);
  assert.doesNotMatch(lockup, /dark:brightness/);
});
