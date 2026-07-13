import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./BranchBar.tsx', import.meta.url), 'utf8');

test('branch creation matches the full Nezha flow', () => {
  assert.match(source, /fromBranch/);
  assert.match(source, /checkout: boolean/);
  assert.match(source, /创建并切换/);
  assert.match(source, /仅创建/);
  assert.match(source, /git_create_branch/);
});

test('branch base picker includes local and remote branch results', () => {
  assert.match(source, /branches\.filter/);
  assert.match(source, /setFromBranch\(branch\.name\)/);
  assert.match(source, /branch\.remote/);
});
