import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('clearing a project removes persisted drafts and mounted task state', () => {
  assert.match(source, /deleteTasks\(allProjectTasks\)/);
  assert.match(source, /setMountedRunTaskIds/);
  assert.match(source, /setAutoStartTaskId/);
});

test('deleting an active task surfaces cancellation failures', () => {
  assert.match(source, /取消任务失败/);
  assert.match(source, /remove_task_worktree/);
});

test('switching projects cannot leak project-scoped overlays or terminals', () => {
  assert.match(source, /setShowShellTerminal\(false\)/);
  assert.match(source, /setShowFileSearch\(false\)/);
  assert.match(source, /setShowProjectSettings\(false\)/);
  assert.match(source, /key=\{`agent-workspace-shell:/);
});
