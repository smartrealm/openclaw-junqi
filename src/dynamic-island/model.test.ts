import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import {
  EMPTY_DYNAMIC_ISLAND_SNAPSHOT,
  formatElapsedTime,
  formatRemainingTime,
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

test('voice activity peeks once when capture or playback starts', () => {
  const listening = { ...EMPTY_DYNAMIC_ISLAND_SNAPSHOT, voicePhase: 'listening' as const };
  assert.equal(shouldPeekForSnapshot(EMPTY_DYNAMIC_ISLAND_SNAPSHOT, listening), true);
  assert.equal(shouldPeekForSnapshot(listening, { ...listening, voicePhase: 'transcribing' }), false);
  assert.equal(shouldPeekForSnapshot(listening, { ...listening, autoExpand: false }), false);
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
  assert.equal(shouldShowDynamicIsland({ ...base, mainMinimized: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], mainMinimized: true }), false);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], mainMinimized: true, voiceActive: true }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, tasks: [], voiceActive: true }), false);
  assert.equal(shouldShowDynamicIsland({
    ...base,
    tasks: [],
    resourceDrop: { phase: 'dragging', count: 1, labels: ['brief.pdf'] },
  }), true);
  assert.equal(shouldShowDynamicIsland({ ...base, enabled: false, mainMinimized: true }), false);
});
