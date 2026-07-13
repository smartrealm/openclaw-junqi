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
  assert.match(source, /placeholder="Project path \(cwd if empty\)"/);
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

test('plan mode prompt handling remains idempotent during session recovery', () => {
  assert.match(source, /applyPlanModePrompt\(basePrompt, planMode\)/);
  assert.doesNotMatch(source, /`\$\{basePrompt\}\\n\\nPlease use plan mode\.`/);
});

test('worktree branch loading is stable across parent renders', () => {
  assert.match(source, /baseBranchRef\.current = baseBranch/);
  assert.match(source, /onBranchRef\.current = onBranch/);
  assert.match(source, /\}, \[projectPath\]\);/);
  assert.match(source, /baseBranch \|\| '选择基础分支'/);
});
