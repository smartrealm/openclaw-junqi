import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('terminal worktree dialog uses real new and existing branch Git paths', () => {
  assert.match(source, /listTerminalGitBranches\(projectPath\)/);
  assert.match(source, /mode === 'new' \? branch\.trim\(\) : existingBranch\.trim\(\)/);
  assert.match(source, /startPoint/);
  assert.match(source, /worktreeExistingBranch/);
});
