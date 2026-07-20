import assert from 'node:assert/strict';
import test from 'node:test';
import { captureTaskNameSnapshot, taskStillMatchesNameSnapshot } from './taskNameGuard';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';

const base: AgentWorkspaceTask = {
  id: 'task-1', projectPath: '/repo', prompt: '修复问题', title: '旧标题', agent: 'claude',
  permissionMode: 'ask', status: 'done', createdAt: 1, updatedAt: 2,
  claudeSessionPath: '/sessions/one.jsonl',
};

test('task name result applies only while title, prompt, status and session are unchanged', () => {
  const snapshot = captureTaskNameSnapshot(base);
  assert.equal(taskStillMatchesNameSnapshot(base, snapshot), true);
  assert.equal(taskStillMatchesNameSnapshot({ ...base, title: '用户新标题' }, snapshot), false);
  assert.equal(taskStillMatchesNameSnapshot({ ...base, prompt: '新任务' }, snapshot), false);
  assert.equal(taskStillMatchesNameSnapshot({ ...base, status: 'running' }, snapshot), false);
  assert.equal(taskStillMatchesNameSnapshot({ ...base, claudeSessionPath: '/sessions/two.jsonl' }, snapshot), false);
  assert.equal(taskStillMatchesNameSnapshot(undefined, snapshot), false);
});
