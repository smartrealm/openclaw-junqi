import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentRunView.tsx', import.meta.url), 'utf8');

test('AI task terminal forwards interactive keyboard input', () => {
  assert.match(source, /attachLinuxIMEFix\(term, sendTerminalInput\)/);
  assert.match(source, /agent_send_input/);
  assert.doesNotMatch(source, /data\.length <= 3/);
});

test('AI task terminal installs Nezha terminal affordances', () => {
  assert.match(source, /attachSmartCopy\(term, \{/);
  assert.match(source, /attachMacWebKitShiftInputFix\(term\)/);
  assert.match(source, /attachTerminalScrollbarAutoHide\(term, container\)/);
  assert.match(source, /loadWebglAddon\(term\)/);
});

test('AI task terminal follows the configured newline shortcut', () => {
  assert.match(source, /matchesTerminalNewline\(event, shiftEnterNewlineRef\.current\)/);
  assert.match(source, /sendTerminalInput\(TERMINAL_NEWLINE_SEQUENCE\)/);
  assert.match(source, /terminal_shift_enter_newline/);
  assert.match(source, /nezha:app-settings-changed/);
});

test('running task follow-up input supports multiline text and stops during recovery', () => {
  assert.match(source, /<textarea/);
  assert.match(source, /if \(e\.key === 'Enter' && !e\.shiftKey\)/);
  assert.match(source, /disabled=\{needsRecovery\}/);
  assert.doesNotMatch(source, /<input[\s\S]{0,400}Shift\+Enter for newline/);
});

test('AI task terminal applies live font and theme settings', () => {
  assert.match(source, /applyTerminalFontSize/);
  assert.match(source, /applyTerminalFontFamily/);
  assert.match(source, /applyTerminalThemeOnPanel/);
  assert.match(source, /agent_resize_pty/);
});

test('worktree actions are mutually exclusive while running', () => {
  assert.match(source, /worktreeBusy/);
  assert.match(source, /disabled=\{worktreeBusy !== null\}/);
  assert.match(source, /finally \{ setWorktreeBusy\(null\); \}/);
  assert.match(source, /合并中\.\.\./);
  assert.match(source, /丢弃中\.\.\./);
});

test('detached and interrupted tasks perform a real session recovery', () => {
  assert.match(source, /reset_task_process/);
  assert.match(source, /handleStart\(prompt, true\)/);
  assert.match(source, /disabled=\{!recoverySessionId\}/);
  assert.match(source, /未保存会话 ID，无法恢复/);
  assert.match(source, /shouldIgnoreAgentWorkspaceTaskStatusTransition\(currentStatus, nextStatus\)/);
});

test('worktree session recovery reuses the existing worktree and blocks discarded worktrees', () => {
  assert.match(source, /resumeIdRef\.current && worktreePathRef\.current/);
  assert.match(source, /actualPath = worktreePathRef\.current/);
  assert.match(source, /!!resumeFlag && !worktreeDiscarded/);
  assert.match(source, /if \(worktreeDiscarded\) return/);
});

test('failed and cancelled sessions can resume when a session id exists', () => {
  assert.match(source, /isDone && !!recoverySessionId && !!resumeFlag && !worktreeDiscarded/);
  assert.doesNotMatch(source, /status === 'done' && !worktreeDiscarded/);
  assert.match(source, /\{\(sessionPath \|\| canResume\) && \(/);
});

test('workspace-owned tasks cannot change their project path', () => {
  assert.match(source, /providedProjectPath === undefined && \(/);
  assert.match(source, /placeholder="项目路径（留空使用当前目录）"/);
});

test('new task composition follows the Nezha card and launch-bar hierarchy', () => {
  assert.match(source, /claudeGif from '@\/assets\/gif\/claude\.gif'/);
  assert.match(source, /codexGif from '@\/assets\/gif\/codex\.gif'/);
  assert.match(source, /agent === 'codex' \? codexGif : claudeGif/);
  assert.match(source, /rounded-lg border border-aegis-border bg-aegis-card/);
  assert.match(source, /border-t border-aegis-border px-3 py-2/);
  assert.match(source, /保存为待办/);
  assert.match(source, /rounded-md border border-aegis-border bg-aegis-surface px-3/);
  assert.doesNotMatch(source, /<SessionHistoryStrip agent=/);
});

test('todo tasks reject attachments instead of silently dropping them', () => {
  assert.match(source, /attachedImages\.length > 0 \|\| textAttachments\.length > 0 \|\| !prompt\.trim\(\)/);
  assert.match(source, /disabled=\{launchMode === 'worktree' \|\| attachedImages\.length > 0 \|\| textAttachments\.length > 0 \|\| !prompt\.trim\(\)\}/);
  assert.match(source, /包含附件的任务必须立即发送/);
});

test('workspace task agent choices match Nezha while standalone runs may use Pi', () => {
  assert.match(source, /allowPi \? \['claude', 'codex', 'pi'\] : \['claude', 'codex'\]/);
  assert.match(source, /allowPi=\{providedProjectPath === undefined\}/);
  assert.match(source, /a === 'codex' \? 'Codex' : 'Pi'/);
});

test('new worktree tasks require an explicit base branch', () => {
  assert.match(source, /launchMode === 'worktree' && !resumingExistingWorktree && !baseBranch\.trim\(\)/);
  assert.match(source, /请选择工作树的基础分支/);
});

test('new worktree creation consumes the Nezha camel-case response contract', () => {
  assert.match(source, /worktreePath: string; worktreeBranch: string; baseBranch: string/);
  assert.match(source, /actualPath = result\.worktreePath/);
  assert.match(source, /worktreeBranch: result\.worktreeBranch/);
  assert.match(source, /baseBranch: result\.baseBranch/);
  assert.doesNotMatch(source, /result\.path|result\.branch/);
});

test('plan mode prompt handling remains idempotent during session recovery', () => {
  assert.match(source, /applyPlanModePrompt\(basePrompt, planMode\)/);
  assert.doesNotMatch(source, /`\$\{basePrompt\}\\n\\nPlease use plan mode\.`/);
});

test('generated task names cannot overwrite concurrent task edits', () => {
  assert.match(source, /captureTaskNameSnapshot\(expectedTask\)/);
  assert.match(source, /sessionPath: snapshot\.sessionPath/);
  assert.match(source, /taskStillMatchesNameSnapshot\(currentTask, snapshot\)/);
});

test('workspace todos use the project task store as their only source of truth', () => {
  assert.doesNotMatch(source, /junqi:saved-todos/);
  assert.match(source, /status: 'todo'/);
  assert.match(source, /isDraft: false/);
});

test('worktree branch loading is stable across parent renders', () => {
  assert.match(source, /baseBranchRef\.current = baseBranch/);
  assert.match(source, /onBranchRef\.current = onBranch/);
  assert.match(source, /\}, \[projectPath\]\);/);
  assert.match(source, /baseBranch \|\| '选择基础分支'/);
});

test('completed tasks cannot be reset into a new task with the same id', () => {
  assert.doesNotMatch(source, /setStatus\('idle'\); setRunning\(false\); setError\(null\); setMetrics\(null\); setSessionPath\(null\)/);
});

test('worktree actions remain available when diff statistics are unavailable', () => {
  assert.match(source, /worktreePath && worktreeBranch && !worktreeDiscarded/);
  assert.match(source, /\{diffStats && <>/);
});

test('visible task runs share usage snapshots and pause hidden metrics polling', () => {
  assert.match(source, /useUsageSnapshot\(visible\)/);
  assert.match(source, /if \(!visible\) return;/);
  assert.match(source, /\[sessionPath, running, visible\]/);
  assert.match(source, /usageSnapshot\?\.claude\.status === 'available'/);
  assert.match(source, /usageSnapshot\?\.codex\.status === 'available'/);
  assert.match(source, /<InlineUsageWindow label="5h"/);
  assert.match(source, /<InlineUsageWindow label="7d"/);
});
