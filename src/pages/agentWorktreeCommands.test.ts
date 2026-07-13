import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaskWorktreeArgs, mergeTaskWorktreeArgs, taskWorktreeArgs, worktreeDiffStatsArgs } from './agentWorktreeCommands';

test('agent worktree IPC payloads match the Rust command field names', () => {
  assert.deepEqual(createTaskWorktreeArgs('/repo', 'task-1', ''), { projectPath: '/repo', taskId: 'task-1', baseBranch: '' });
  assert.deepEqual(taskWorktreeArgs('/repo', '/repo/.worktrees/task-1', 'task/task-1'), { projectPath: '/repo', worktreePath: '/repo/.worktrees/task-1', branch: 'task/task-1' });
  assert.deepEqual(mergeTaskWorktreeArgs('/repo', '/worktree', 'task/one', 'develop'), { projectPath: '/repo', worktreePath: '/worktree', branch: 'task/one', baseBranch: 'develop' });
  assert.deepEqual(worktreeDiffStatsArgs('/repo', '/worktree'), { projectPath: '/repo', worktreePath: '/worktree', baseBranch: '' });
});
