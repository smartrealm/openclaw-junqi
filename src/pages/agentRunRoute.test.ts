import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentRunTask } from './agentRunRoute';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

const task: AgentWorkspaceTask = {
  id: 'task-1',
  projectPath: '/repo',
  prompt: 'Run the exact task',
  agent: 'codex',
  permissionMode: 'ask',
  status: 'todo',
  createdAt: 1,
  updatedAt: 1,
};

test('agent run deep links resolve only the exact persisted task', () => {
  assert.deepEqual(resolveAgentRunTask('task-1', [task]), { kind: 'task', task });
  assert.deepEqual(resolveAgentRunTask('missing', [task]), { kind: 'unavailable', taskId: 'missing' });
});

test('agent run without a task identity retains the new-task route', () => {
  assert.deepEqual(resolveAgentRunTask(null, [task]), { kind: 'new' });
  assert.deepEqual(resolveAgentRunTask('  ', [task]), { kind: 'new' });
});
