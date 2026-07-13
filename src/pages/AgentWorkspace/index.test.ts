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

test('switching projects preserves isolated project view state', () => {
  assert.match(source, /projectUiStatesRef/);
  assert.match(source, /restored\?\.openFiles/);
  assert.match(source, /restored\?\.showShellTerminal/);
  assert.match(source, /setShowFileSearch\(false\)/);
  assert.match(source, /setShowProjectSettings\(false\)/);
  assert.match(source, /key=\{`agent-workspace-shell:/);
});

test('pending tasks stay mounted and participate in active-task cleanup', () => {
  assert.match(source, /task\.status === 'pending'\s*\n\s*\|\| task\.status === 'running'/);
  assert.match(source, /mountedRunTaskIds\.has\(task\.id\) && isActiveTask\(task\)/);
});

test('task list actions match Nezha ownership boundaries', () => {
  const start = source.indexOf("title={task.starred ? '取消收藏'");
  const end = source.indexOf('title="删除任务"', start);
  const taskActions = source.slice(start, end);
  assert.match(taskActions, /title="立即运行"/);
  assert.doesNotMatch(taskActions, /编辑任务/);
  assert.doesNotMatch(taskActions, /生成任务名称/);
  assert.doesNotMatch(source, /editingTaskId|commitTaskRename/);
});

test('project rail uses WebView-safe pointer reordering', () => {
  assert.match(source, /Math\.hypot\(moveEvent\.clientX - startX, moveEvent\.clientY - startY\) < 5/);
  assert.match(source, /elementFromPoint/);
  assert.match(source, /position: moveEvent\.clientY < bounds\.top \+ bounds\.height \/ 2 \? 'before' : 'after'/);
  assert.match(source, /window\.addEventListener\('pointercancel', onCancel, true\)/);
  assert.match(source, /window\.addEventListener\('blur', onBlur\)/);
  assert.match(source, /suppressWorkspaceClickRef/);
  assert.doesNotMatch(source, /onDragStart=/);
});

test('hidden projects remain available in the drawer and active project stays on the rail', () => {
  assert.match(source, /!item\.hiddenFromRail \|\| item\.id === activeRailWorkspaceId/);
  assert.match(source, /toggleWorkspaceHidden\(item\.id\)/);
  assert.match(source, /从项目栏隐藏/);
  assert.match(source, /固定到项目栏/);
  assert.match(source, /projectRailRef\.current\?\.contains/);
  assert.match(source, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(source, /setProjectDrawerQuery\(''\)/);
  assert.match(source, /已隐藏/);
});
