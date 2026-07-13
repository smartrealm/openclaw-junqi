import assert from 'node:assert/strict';
import test from 'node:test';
import { compareAgentWorkspaceTasks } from './taskListModel';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

function task(id: string, status: AgentWorkspaceTask['status'], updatedAt: number, attentionRequestedAt?: number): AgentWorkspaceTask {
  return { id, projectPath: '/repo', prompt: id, agent: 'claude', permissionMode: 'ask', status, createdAt: 1, updatedAt, attentionRequestedAt };
}

test('attention tasks sort before ordinary tasks by the time attention was requested', () => {
  const tasks = [
    task('ordinary-new', 'done', 500),
    task('attention-old', 'awaiting_review', 900, 100),
    task('attention-new', 'input_required', 200, 800),
  ].sort(compareAgentWorkspaceTasks);
  assert.deepEqual(tasks.map((item) => item.id), ['attention-new', 'attention-old', 'ordinary-new']);
});

test('ordinary tasks retain reverse chronological order', () => {
  const tasks = [task('old', 'done', 100), task('new', 'failed', 500)].sort(compareAgentWorkspaceTasks);
  assert.deepEqual(tasks.map((item) => item.id), ['new', 'old']);
});
