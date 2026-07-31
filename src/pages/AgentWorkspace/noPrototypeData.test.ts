import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('AI workspace contains no hard-coded counts or inert prototype controls', () => {
  assert.doesNotMatch(source, /badge:\s*7|筛选工作区|⌘K/);
  assert.doesNotMatch(source, /worktree\.agent|worktree\.unread/);
  assert.doesNotMatch(source, /state === 'running'|state === 'attention'/);
  assert.doesNotMatch(source, /junqi-wb-repo-heading/);
});
