import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8');

test('clearing a project removes persisted drafts and mounted task state', () => {
  assert.match(source, /deleteTasks\(allProjectTasks\)/);
  assert.match(source, /setMountedRunTaskIds/);
  assert.match(source, /setAutoStartTaskId/);
});

test('task deletion keeps persisted state until runtime and worktree cleanup succeeds', () => {
  assert.match(source, /await cleanupAgentWorkspaceTask/);
  assert.match(source, /removeTask\(task\.id\)/);
  assert.ok(source.indexOf('await cleanupAgentWorkspaceTask') < source.indexOf('removeTask(task.id)'));
  assert.match(source, /return removedIds\.size === deletingIds\.size/);
});

test('switching projects preserves isolated project view state', () => {
  assert.match(source, /projectUiStatesRef/);
  assert.match(source, /restored\?\.openFiles/);
  assert.match(source, /restored\?\.showShellTerminal/);
  assert.match(source, /restored\?\.taskSidebarMode/);
  assert.match(source, /setShowFileSearch\(false\)/);
  assert.match(source, /setShowProjectSettings\(false\)/);
  assert.match(source, /key=\{`agent-workspace-shell:/);
});

test('pending tasks stay mounted and participate in active-task cleanup', () => {
  assert.match(source, /task\.status === 'pending'\s*\n\s*\|\| task\.status === 'running'/);
  assert.match(source, /mountedRunTaskIds\.has\(task\.id\) && isActiveTask\(task\)/);
});

test('new task drafts open the full editor instead of the todo detail view', () => {
  assert.match(source, /task\.isDraft \|\| task\.status !== 'todo'/);
  assert.match(source, /selected\.status === 'todo' && !selected\.isDraft/);
  assert.match(source, /initialIsDraft=\{task\.isDraft\}/);
});

test('opening a local project initializes the JunQi project configuration', () => {
  assert.match(source, /invoke\('init_project_config', \{ projectPath \}\)/);
  assert.match(source, /workspace\?\.sshRemoteHost/);
  assert.match(source, /agentWorkspace\.initProjectFailed/);
});

test('the empty task page can open a local project directly', () => {
  const emptyStateStart = source.indexOf(") : !projectPath ? (");
  const emptyStateEnd = source.indexOf(") : !selected ? (", emptyStateStart);
  const emptyState = source.slice(emptyStateStart, emptyStateEnd);
  assert.match(emptyState, /openProjectWorkspace\(\)/);
  assert.doesNotMatch(emptyState, /navigate\('\/terminal'\)/);
});

test('task list actions match JunQi ownership boundaries', () => {
  const start = source.indexOf("agentWorkspace.unstarTask");
  const end = source.indexOf('agentWorkspace.deleteTask', start);
  const taskActions = source.slice(start, end);
  assert.match(taskActions, /agentWorkspace\.runNow/);
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
  assert.match(source, /agentWorkspace\.hideProject/);
  assert.match(source, /agentWorkspace\.pinProject/);
  assert.match(source, /projectRailRef\.current\?\.contains/);
  assert.match(source, /document\.addEventListener\('pointerdown', onPointerDown, true\)/);
  assert.match(source, /setProjectDrawerQuery\(''\)/);
  assert.match(source, /agentWorkspace\.hidden/);
});

test('project management keeps rename, visibility and removal actions discoverable', () => {
  assert.match(source, /agentWorkspace\.projectManager/);
  assert.match(source, /<FolderCog size=\{15\} \/>/);
  assert.match(source, /agentWorkspace\.renameProject/);
  assert.match(source, /agentWorkspace\.removeProject/);
  assert.match(source, /requestCloseProject\(item\)/);
  assert.match(source, /<Trash2 size=\{12\} \/>/);
  assert.doesNotMatch(source, /title="关闭项目"/);
});

test('full task panel owns footer actions while compact mode keeps only the project rail', () => {
  assert.equal((source.match(/<NotificationBell \/>/g) ?? []).length, 1);
  assert.match(source, /taskSidebarMode === 'full'/);
  assert.match(source, /taskSidebarMode !== 'hidden'/);
  assert.match(source, /setTaskSidebarMode\('compact'\)/);
  assert.match(source, /navigate\('\/settings\?tab=terminal'\)/);
  assert.match(source, /terminalSettings\.title/);
  assert.match(source, /setTheme\(darkTheme \? 'aegis-light' : 'aegis-dark'\)/);
  assert.match(source, /agentWorkspace\.switchLightTheme/);
  assert.match(source, /agentWorkspace\.switchDarkTheme/);
  assert.match(source, /ENABLE_USAGE_INSIGHTS && <UsagePopover \/>/);
  assert.match(source, /visible=\{selected\?\.id === task\.id && selectedRunVisible\}/);
});

test('AI workspace exposes a deterministic back hierarchy and animated content scenes', () => {
  assert.match(source, /if \(openDiff\)/);
  assert.match(source, /if \(activeFilePath\)/);
  assert.match(source, /selectTask\(null\)/);
  assert.doesNotMatch(source, /navigate\('\/'\)/);
  assert.match(source, /: null;/);
  assert.match(source, /\{backLabel && \(/);
  assert.match(source, /aria-label=\{backLabel\}/);
  assert.match(source, /<AnimatePresence initial=\{false\} mode="wait">/);
  assert.match(source, /<WorkspaceContentScene key=/);
  assert.match(source, /key=\{`files:\$\{projectPath\}`\}/);
  assert.doesNotMatch(source, /key=\{`file:\$\{activeFilePath\}`\}/);
  assert.match(source, /agentWorkspace\.backToTask/);
  assert.match(source, /agentWorkspace\.backToTaskList/);
  assert.doesNotMatch(source, /agentWorkspace\.backToDashboard/);
});

test('empty task state stays secondary to the task sidebar action', () => {
  assert.match(source, /agentWorkspace\.noTaskSelected/);
  assert.doesNotMatch(source, /<h1 className="mb-2 text-xl font-semibold">新建 AI 任务<\/h1>/);
  assert.doesNotMatch(source, /使用完整编辑器配置智能体、权限、工作树和附件/);
});

test('AI workspace navigation labels exist in every supported locale', () => {
  for (const locale of ['zh', 'zh-TW', 'en']) {
    const messages = JSON.parse(readFileSync(new URL(`../../locales/${locale}.json`, import.meta.url), 'utf8'));
    assert.equal(typeof messages.agentWorkspace.backToTask, 'string');
    assert.equal(typeof messages.agentWorkspace.backToTaskList, 'string');
    assert.equal(typeof messages.agentWorkspace.expandSidebar, 'string');
    assert.equal(typeof messages.agentWorkspace.projectManager, 'string');
    assert.equal(typeof messages.agentWorkspace.removeProject, 'string');
  }
});

test('closing the active file tab follows JunQi adjacent-tab fallback', () => {
  assert.match(source, /if \(index === -1\) return current;/);
  assert.match(source, /next\[Math\.min\(index, next\.length - 1\)\]\?\.path \?\? null/);
  assert.doesNotMatch(source, /next\[index - 1\]\?\.path \?\? next\[index\]\?\.path/);
});

test('task notification deep links select their project and task', () => {
  assert.match(source, /new URLSearchParams\(location\.search\)\.get\('task'\)/);
  assert.match(source, /findWorkspaceForDirectory\(workspaces, task\.projectPath\)/);
  assert.match(source, /activateWorkspace\(targetWorkspace\.id\)/);
  assert.match(source, /selectProjectTask\(task\.projectPath, task\.id\)/);
  assert.match(source, /navigate\('\/ai-workspace', \{ replace: true \}\)/);
});

test('task history and attention badge preferences live in JunQi app settings', () => {
  assert.match(source, /readAttentionBadge/);
  assert.match(source, /attentionBadge && activity\.attention > 0/);
  assert.match(source, /attentionBadge && hasAttention/);
  assert.doesNotMatch(source, /aria-label="任务历史范围"/);
  assert.match(source, /agentWorkspace\.clear/);
});

test('workspace capability panel reuses shared skills and persisted task settings', () => {
  assert.match(source, /useSkillsStore/);
  assert.match(source, /task\.permissionMode/);
  assert.match(source, /task\.planMode/);
  assert.match(source, /task\.launchMode/);
  assert.match(source, /toggleRightPanel\('capabilities'\)/);
  assert.match(source, /onNavigate\('\/activity'\)/);
  assert.match(source, /agentWorkspace\.directMode/);
  assert.doesNotMatch(source, />Skills<|>Memory</);
});

test('task list delegates JunQi attention ordering to the shared model', () => {
  assert.match(source, /sort\(compareAgentWorkspaceTasks\)/);
  assert.match(source, /agentTaskNeedsAttention\(task\)/);
});

test('worktree terminals route the selected directory through the shared shell panel', () => {
  assert.match(source, /setPendingTerminalDirectory\(worktreePath\)/);
  assert.match(source, /shellTerminalRef\.current\?\.openDirectory\(pendingTerminalDirectory\)/);
  assert.match(source, /ref=\{shellTerminalRef\}/);
});
