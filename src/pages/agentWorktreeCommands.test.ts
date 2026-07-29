import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cleanupAgentWorkspaceTask,
  createTaskWorktreeArgs,
  mergeAndRemoveTaskWorktree,
  mergeTaskWorktreeArgs,
  taskWorktreeArgs,
  worktreeDiffStatsArgs,
} from './agentWorktreeCommands';

test('agent worktree IPC payloads match the Rust command field names', () => {
  assert.deepEqual(createTaskWorktreeArgs('/repo', 'task-1', ''), { projectPath: '/repo', taskId: 'task-1', baseBranch: '' });
  assert.deepEqual(taskWorktreeArgs('/repo', '/repo/.worktrees/task-1', 'task/task-1'), { projectPath: '/repo', worktreePath: '/repo/.worktrees/task-1', branch: 'task/task-1' });
  assert.deepEqual(mergeTaskWorktreeArgs('/repo', '/worktree', 'task/one', 'develop'), { projectPath: '/repo', worktreePath: '/worktree', branch: 'task/one', baseBranch: 'develop' });
  assert.deepEqual(worktreeDiffStatsArgs('/repo', '/worktree'), { projectPath: '/repo', worktreePath: '/worktree', baseBranch: '' });
});

test('merge state is not committed when worktree cleanup fails', async () => {
  const calls: string[] = [];
  await assert.rejects(
    mergeAndRemoveTaskWorktree(
      async () => { calls.push('merge'); },
      async () => { calls.push('remove'); throw new Error('cleanup failed'); },
    ),
    /cleanup failed/,
  );
  assert.deepEqual(calls, ['merge', 'remove']);
});

test('task cleanup failure prevents the caller state transition', async () => {
  let removed = false;
  await assert.rejects(
    cleanupAgentWorkspaceTask(
      { active: true, worktreePath: '/repo/worktree', worktreeBranch: 'task/one' },
      {
        cancel: async () => undefined,
        removeWorktree: async () => { throw new Error('worktree busy'); },
      },
    ).then(() => { removed = true; }),
    /worktree busy/,
  );
  assert.equal(removed, false);
});
