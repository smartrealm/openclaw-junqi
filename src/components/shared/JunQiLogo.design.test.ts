import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('JunQi lockups use the official emblem and theme-aware brand text', async () => {
  const source = await readFile(new URL('./JunQiLogo.tsx', import.meta.url), 'utf8');
  const lockup = source.slice(
    source.indexOf("if (variant === 'lockup')"),
    source.indexOf("if (variant === 'company-emblem')"),
  );

  assert.match(source, /junqi-emblem\.svg/);
  assert.doesNotMatch(source, /daxia-group/);
  assert.doesNotMatch(source, /junqi-company-logo/);
  assert.match(lockup, />浚启智境</);
  assert.match(lockup, /JUNQI INTELLIGENCE/);
  assert.match(lockup, /text-aegis-text/);
  assert.match(lockup, /text-aegis-text-muted/);
  assert.doesNotMatch(lockup, /dark:brightness/);
  assert.match(source, /陕西浚启智境科技有限公司/);
  assert.match(source, /深浚其智，广启其途/);
  assert.doesNotMatch(source, /dark:/);
});
