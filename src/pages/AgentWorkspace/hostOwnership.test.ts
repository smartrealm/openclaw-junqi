import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('local-only Files Git and PTY consumers reject remote host paths at the UI boundary', () => {
  assert.match(source, /worktree\?\.hostId === 'local' && worktree\.hostRevision === 0/);
  assert.match(source, /const selectedLocalPath = localWorktreePath\(selectedWorktree\)/);
  assert.match(source, /const targetLocalPath = localWorktreePath\(targetWorktree\)/);
  assert.match(source, /projectPath=\{selectedLocalPath\}/);
  assert.match(source, /projectPath=\{targetLocalPath\}/);
});
