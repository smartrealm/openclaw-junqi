import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
  formatElapsedTime,
  formatRemainingTime,
  isDynamicIslandVoiceInputActive,
  projectDynamicIslandVoiceInput,
  shouldShowDynamicIsland,
  shouldPeekForSnapshot,
} from './model';

test('editing a static focus snapshot does not masquerade as active work', () => {
  const focused = {
    ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
    focus: {
      schemaVersion: 1 as const,
      target: { kind: 'chat-session' as const, id: 'agent:main:main' },
      title: 'Initial title',
      detail: '/repo',
      route: '/chat',
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
  const base = {
    enabled: true,
    mainMinimized: false,
    sessionRunning: false,
    resourceDrop: null,
  };
  assert.equal(shouldShowDynamicIsland(base), false);
  assert.equal(shouldShowDynamicIsland({ ...base, preview: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, mainMinimized: true }), false);
  assert.equal(shouldShowDynamicIsland({
    ...base,
    mainMinimized: true,
    focus: {
      schemaVersion: 1,
      target: { kind: 'chat-session', id: 'agent:main:main' },
      title: 'Focused session',
      detail: 'main',
      route: '/chat',
      focusedAt: 1,
      state: 'idle',
    },
  }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, mainMinimized: true, voiceActive: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, voiceActive: true }), false);
  assert.equal(shouldShowDynamicIsland({
    ...base,
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
