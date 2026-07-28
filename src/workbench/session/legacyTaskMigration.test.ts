import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { projectLegacyTasksToWorkbench } from './legacyTaskMigration';

function task(id: string, path: string, sessionId?: string): AgentWorkspaceTask {
  return {
    id, projectPath: '/repo', prompt: id, agent: 'claude', permissionMode: 'ask',
    status: 'done', createdAt: 1, updatedAt: 2, worktreePath: path,
    worktreeBranch: `branch/${id}`, sessionId,
  };
}

test('legacy migration deduplicates worktrees and preserves provider identity without mutation', () => {
  const tasks = [task('a', '/repo-task', 'session-a'), task('b', '/repo-task', 'session-b')];
  const before = structuredClone(tasks);
  const migration = projectLegacyTasksToWorkbench(tasks);
  assert.equal(migration.worktrees.length, 1);
  assert.equal(migration.providerSessions.length, 2);
  assert.equal(migration.worktrees[0]?.hostId, 'local');
  assert.deepEqual(tasks, before);
});

test('legacy migration uses the project path when no task worktree exists', () => {
  const migration = projectLegacyTasksToWorkbench([task('a', '', undefined)]);
  assert.equal(migration.worktrees[0]?.path, '/repo');
  assert.equal(migration.providerSessions.length, 0);
});
