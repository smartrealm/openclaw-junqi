import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import {
  EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
  formatElapsedTime,
  formatRemainingTime,
  isDynamicIslandVoiceInputActive,
  projectDynamicIslandVoiceInput,
  selectDynamicIslandTasks,
  shouldShowDynamicIsland,
  shouldPeekForSnapshot,
} from './model';

const task = (id: string, status: AgentWorkspaceTask['status'], updatedAt: number): AgentWorkspaceTask => ({
  id,
  status,
  updatedAt,
  createdAt: updatedAt,
  projectPath: '/tmp/project',
  prompt: `Prompt ${id}`,
  agent: 'codex',
  permissionMode: 'auto_edit',
});

test('attention tasks sort ahead of recent running and completed tasks', () => {
  const selected = selectDynamicIslandTasks([
    task('done', 'done', 30),
    task('running', 'running', 40),
    task('attention', 'input_required', 10),
    task('ignored', 'todo', 50),
  ]);
  assert.deepEqual(selected.map((item) => item.id), ['attention', 'running', 'done']);
});

test('auto peek only reacts to a new notice or meaningful status transition', () => {
  const running = { ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT, tasks: [selectDynamicIslandTasks([task('a', 'running', 1)])[0]] };
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, running), false);
  const attention = { ...running, tasks: [selectDynamicIslandTasks([task('a', 'input_required', 2)])[0]] };
  assert.equal(shouldPeekForSnapshot(running, attention), true);
  assert.equal(shouldPeekForSnapshot(attention, { ...attention, autoExpand: false }), false);
});

test('editing a static focus snapshot does not masquerade as active work', () => {
  const focused = {
    ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
    focus: {
      schemaVersion: 1 as const,
      target: { kind: 'task-brief' as const, id: 'brief-1' },
      title: 'Initial title',
      detail: '/repo',
      route: '/briefs?brief=brief-1',
      focusedAt: 1,
      state: 'idle' as const,
    },
  };
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, focused), false);
  assert.equal(shouldPeekForSnapshot(focused, {
    ...focused,
    focus: { ...focused.focus, title: 'Edited title' },
  }), false);
});

test('voice activity peeks once when capture or playback starts', () => {
  const listening = { ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT, voicePhase: 'listening' as const };
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, listening), true);
  assert.equal(shouldPeekForSnapshot(listening, { ...listening, voicePhase: 'transcribing' }), false);
  assert.equal(shouldPeekForSnapshot(listening, { ...listening, autoExpand: false }), false);
});

test('语音投影只包含非敏感的 Talk 模式状态', () => {
  const projection = projectDynamicIslandVoiceInput({
    mode: 'talk',
    phase: 'thinking',
    error: null,
  });

  assert.deepEqual(projection, {
    mode: 'talk',
    phase: 'thinking',
    error: null,
  });
  assert.equal(isDynamicIslandVoiceInputActive(projection), true);
  assert.equal(isDynamicIslandVoiceInputActive(EMPTY_DYNAMIC_ISLAND_SNAPSHOT.voiceInput), false);
});

test('Talk 启动只触发一次灵动岛展开', () => {
  const preparing = {
    ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
    voiceInput: {
      mode: 'talk' as const,
      phase: 'preparing' as const,
      error: null,
    },
  };
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, preparing), true);
  assert.equal(shouldPeekForSnapshot(preparing, { ...preparing, revision: 2 }), false);
});

test('a newly blocked native observer digest peeks once without becoming a task', () => {
  const blocked = {
    ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
    sessionRunning: true,
    sessionActivities: [{
      id: 'observer:agent:main:main',
      sessionKey: 'agent:main:main',
      agentName: 'main',
      sessionTitle: 'OpenClaw observation',
      phase: 'observing' as const,
      startedAt: 1,
      observer: {
        headline: 'Waiting for a decision.',
        health: 'waiting-on-user' as const,
      },
    }],
  };
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, blocked), true);
  assert.equal(shouldPeekForSnapshot(blocked, { ...blocked, revision: 2 }), false);
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, { ...blocked, autoExpand: false }), false);
});

test('remaining time freezes while paused and uses stable tabular format', () => {
  const paused = {
    ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
    pomodoro: {
      ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT.pomodoro,
      enabled: true,
      running: true,
      paused: true,
      pausedRemainingMs: 61_000,
    },
  };
  assert.equal(formatRemainingTime(paused, 10_000), '01:01');
});

test('session activity elapsed time stays readable under one minute and after one minute', () => {
  assert.equal(formatElapsedTime(10_000, 28_000), '00:18');
  assert.equal(formatElapsedTime(10_000, 90_000), '01:20');
});

test('the island is conditional unless a file drag needs immediate feedback', () => {
  const running = selectDynamicIslandTasks([task('a', 'running', 1)]);
  const base = {
    enabled: true,
    mainMinimized: false,
    sessionRunning: false,
    tasks: running,
    resourceDrop: null,
    terminalPulse: false,
  };
  assert.equal(shouldShowDynamicIsland(base), false);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], preview: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, mainMinimized: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], mainMinimized: true }), false);
  assert.equal(shouldShowDynamicIsland({
    ...base,
    tasks: [],
    mainMinimized: true,
    focus: {
      schemaVersion: 1,
      target: { kind: 'task-brief', id: 'brief-1' },
      title: 'Focused brief',
      detail: '/repo',
      route: '/briefs?brief=brief-1',
      focusedAt: 1,
      state: 'idle',
    },
  }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], mainMinimized: true, voiceActive: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], voiceActive: true }), false);
  assert.equal(shouldShowDynamicIsland({
    ...base,
    tasks: [],
    resourceDrop: { phase: 'dragging', count: 1, labels: ['brief.pdf'] },
  }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, enabled: false, mainMinimized: true }), false);
  assert.equal(shouldShowDynamicIsland({ ...base, enabled: false, preview: true }), false);
});

test('a plan advancing to the next step earns one peek', () => {
  const atStepOne = {
    ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
    executionPlan: { currentStep: 1, totalSteps: 5, stepTitle: 'Inspect protocol' },
  };
  const atStepTwo = {
    ...atStepOne,
    executionPlan: { currentStep: 2, totalSteps: 5, stepTitle: 'Locate entry points' },
  };
  assert.equal(shouldPeekForSnapshot(atStepOne, atStepTwo), true);
  // 仅重新规划不能再次展开灵动岛，只有步骤向前推进才允许展开。
  assert.equal(shouldPeekForSnapshot(atStepOne, {
    ...atStepOne,
    executionPlan: { currentStep: 1, totalSteps: 7, stepTitle: 'Inspect protocol' },
  }), false);
  assert.equal(shouldPeekForSnapshot(atStepTwo, atStepOne), false);
  assert.equal(shouldPeekForSnapshot(atStepOne, { ...atStepTwo, autoExpand: false }), false);
});

test('the island plan projection carries no transcript content', () => {
  const keys = Object.keys(
    { currentStep: 1, totalSteps: 2, stepTitle: 'Step' } satisfies NonNullable<
      typeof EMPTY_DYNAMIC_ISLAND_SNAPSHOT.executionPlan
    >,
  );
  assert.deepEqual(keys.sort(), ['currentStep', 'stepTitle', 'totalSteps']);
  assert.equal(EMPTY_DYNAMIC_ISLAND_SNAPSHOT.executionPlan, null);
});

test('native observer projection is limited to display-safe state', () => {
  const keys = Object.keys({ headline: 'Waiting for a decision.', health: 'waiting-on-user' } satisfies NonNullable<
    typeof EMPTY_DYNAMIC_ISLAND_SNAPSHOT.sessionActivities[number]['observer']
  >);
  assert.deepEqual(keys.sort(), ['headline', 'health']);
});
