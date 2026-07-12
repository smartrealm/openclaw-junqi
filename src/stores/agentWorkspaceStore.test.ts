import assert from 'node:assert/strict';
import test from 'node:test';
import { isAgentWorkspaceTaskStatus, useAgentWorkspaceStore } from './agentWorkspaceStore';

function resetStore() {
  useAgentWorkspaceStore.setState({ tasks: [], selectedTaskId: null, selectedTaskIds: {} });
}

test('agent workspace status guard rejects unknown backend values', () => {
  assert.equal(isAgentWorkspaceTaskStatus('running'), true);
  assert.equal(isAgentWorkspaceTaskStatus('awaiting_review'), true);
  assert.equal(isAgentWorkspaceTaskStatus('unexpected-status'), false);
});

test('agent workspace tasks are created selected and updated independently', () => {
  resetStore();
  const store = useAgentWorkspaceStore.getState();
  const first = store.createTask({
    projectPath: '/repo-a',
    prompt: 'Implement task panel',
    agent: 'claude',
    permissionMode: 'ask',
  });
  const second = useAgentWorkspaceStore.getState().createTask({
    projectPath: '/repo-b',
    prompt: 'Review the diff',
    agent: 'codex',
    permissionMode: 'auto_edit',
  });

  useAgentWorkspaceStore.getState().updateTask(first.id, {
    status: 'running',
    sessionId: 'session-1',
  });

  const state = useAgentWorkspaceStore.getState();
  assert.equal(state.selectedTaskId, second.id);
  assert.equal(state.tasks.find((task) => task.id === first.id)?.status, 'running');
  assert.equal(state.tasks.find((task) => task.id === first.id)?.sessionId, 'session-1');
  assert.equal(state.tasks.find((task) => task.id === second.id)?.status, 'todo');
});

test('new-task drafts can become visible todo tasks without replacing their identity', () => {
  resetStore();
  const draft = useAgentWorkspaceStore.getState().createTask({
    projectPath: '/repo-a',
    prompt: '',
    title: '',
    agent: 'claude',
    permissionMode: 'ask',
    planMode: true,
    launchMode: 'worktree',
    baseBranch: 'main',
    isDraft: true,
  });

  useAgentWorkspaceStore.getState().updateTask(draft.id, {
    prompt: 'Refactor the project rail',
    title: 'Refactor the project rail',
    status: 'todo',
    isDraft: false,
  });

  const saved = useAgentWorkspaceStore.getState().tasks.find((task) => task.id === draft.id);
  assert.equal(saved?.isDraft, false);
  assert.equal(saved?.status, 'todo');
  assert.equal(saved?.prompt, 'Refactor the project rail');
  assert.equal(saved?.planMode, true);
  assert.equal(saved?.launchMode, 'worktree');
  assert.equal(saved?.baseBranch, 'main');
});

test('clearing one project retains tasks and selection from other projects', () => {
  resetStore();
  const first = useAgentWorkspaceStore.getState().createTask({
    projectPath: '/repo-a',
    prompt: 'Task A',
    agent: 'claude',
    permissionMode: 'ask',
  });
  const second = useAgentWorkspaceStore.getState().createTask({
    projectPath: '/repo-b',
    prompt: 'Task B',
    agent: 'pi',
    permissionMode: 'full_access',
  });

  useAgentWorkspaceStore.getState().selectTask(second.id);
  useAgentWorkspaceStore.getState().clearProjectTasks('/repo-a');

  const state = useAgentWorkspaceStore.getState();
  assert.equal(state.tasks.some((task) => task.id === first.id), false);
  assert.equal(state.tasks.some((task) => task.id === second.id), true);
  assert.equal(state.selectedTaskId, second.id);
});

test('removing the selected task clears the current selection', () => {
  resetStore();
  const task = useAgentWorkspaceStore.getState().createTask({
    projectPath: '/repo-a',
    prompt: 'Task to remove',
    agent: 'claude',
    permissionMode: 'ask',
  });

  useAgentWorkspaceStore.getState().removeTask(task.id);

  const state = useAgentWorkspaceStore.getState();
  assert.equal(state.tasks.length, 0);
  assert.equal(state.selectedTaskId, null);
});

test('replacing one project after disk hydration preserves other project tasks', () => {
  resetStore();
  const store = useAgentWorkspaceStore.getState();
  const old = store.createTask({ projectPath: '/repo-a', prompt: 'old', agent: 'codex', permissionMode: 'ask' });
  const other = useAgentWorkspaceStore.getState().createTask({ projectPath: '/repo-b', prompt: 'keep', agent: 'claude', permissionMode: 'ask' });
  const loaded = { ...old, prompt: 'loaded from disk', updatedAt: old.updatedAt + 10 };

  useAgentWorkspaceStore.getState().replaceProjectTasks('/repo-a', [loaded]);

  const state = useAgentWorkspaceStore.getState();
  assert.equal(state.tasks.find((task) => task.id === old.id)?.prompt, 'loaded from disk');
  assert.equal(state.tasks.find((task) => task.id === other.id)?.prompt, 'keep');
  assert.equal(state.selectedTaskId, other.id);
});

test('each project retains its own selected task', () => {
  resetStore();
  const first = useAgentWorkspaceStore.getState().createTask({ projectPath: '/repo-a', prompt: 'A', agent: 'claude', permissionMode: 'ask' });
  const second = useAgentWorkspaceStore.getState().createTask({ projectPath: '/repo-b', prompt: 'B', agent: 'codex', permissionMode: 'ask' });
  useAgentWorkspaceStore.getState().selectProjectTask('/repo-a', first.id);

  const state = useAgentWorkspaceStore.getState();
  assert.equal(state.selectedTaskIds['/repo-a'], first.id);
  assert.equal(state.selectedTaskIds['/repo-b'], second.id);
});
