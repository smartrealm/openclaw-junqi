import assert from 'node:assert/strict';
import test from 'node:test';
import { handoffTaskBrief } from './handoff';
import type { TaskBrief } from './domain';

const promptLabels = {
  task: 'Task',
  untitled: 'Untitled task',
  project: 'Project',
  references: 'Context references',
  sections: {
    goal: 'Goal',
    background: 'Background',
    constraint: 'Constraints',
    acceptance: 'Acceptance criteria',
    note: 'Notes',
  },
};

const brief: TaskBrief = {
  id: 'brief-1', title: 'Ship task brief', projectPath: '/repo', status: 'ready',
  cards: [
    { id: 'g', kind: 'goal', content: 'Ship the feature' },
    { id: 'a', kind: 'acceptance', content: 'Tests pass' },
  ],
  references: [], agent: 'claude', permissionMode: 'auto_edit', planMode: true,
  launchMode: 'worktree', baseBranch: 'main', createdAt: 1, updatedAt: 1,
};

test('handoff creates one linked task then updates brief and focus atomically in order', () => {
  const calls: string[] = [];
  const result = handoffTaskBrief(brief, {
    createTask: (input) => { calls.push('task'); return { id: 'task-1', createdAt: 1, updatedAt: 1, status: input.status ?? 'todo', ...input }; },
    findTaskBySourceBriefId: () => null,
    markLaunched: (briefId, taskId) => { calls.push(`brief:${briefId}:${taskId}`); },
    setFocus: (focus) => { calls.push(`focus:${focus.target.id}`); },
    promptLabels,
  });
  assert.equal(result.taskId, 'task-1');
  assert.equal(result.route, '/agent-run?taskId=task-1');
  assert.deepEqual(calls, ['task', 'brief:brief-1:task-1', 'focus:task-1']);
  assert.equal(result.task.sourceBriefId, 'brief-1');
  assert.equal(result.task.status, 'todo');
  assert.equal(result.task.baseBranch, 'main');
  assert.equal(result.created, true);
});

test('handoff reuses an existing task linked to the same brief', () => {
  let createCount = 0;
  const existing = {
    id: 'task-existing',
    projectPath: '/repo',
    prompt: 'Existing prompt',
    agent: 'claude',
    permissionMode: 'auto_edit' as const,
    status: 'todo' as const,
    sourceBriefId: brief.id,
    createdAt: 1,
    updatedAt: 1,
  };
  const result = handoffTaskBrief(brief, {
    createTask: () => { createCount += 1; throw new Error('must not create'); },
    findTaskBySourceBriefId: () => existing,
    markLaunched: () => undefined,
    setFocus: () => undefined,
    promptLabels,
  });
  assert.equal(createCount, 0);
  assert.equal(result.taskId, existing.id);
  assert.equal(result.created, false);
});

test('handoff fails before mutations when brief has blocking findings', () => {
  assert.throws(() => handoffTaskBrief({ ...brief, projectPath: '' }, {
    createTask: () => { throw new Error('must not run'); },
    findTaskBySourceBriefId: () => null,
    markLaunched: () => undefined,
    setFocus: () => undefined,
    promptLabels,
  }), /not ready/i);
});
