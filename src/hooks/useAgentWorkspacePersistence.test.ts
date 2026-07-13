import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeLoadedAgentWorkspaceTasks } from './useAgentWorkspacePersistence';
import type { AgentWorkspaceTask } from '@/stores/agentWorkspaceStore';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./useAgentWorkspacePersistence.ts', import.meta.url), 'utf8');

function task(id: string, status: AgentWorkspaceTask['status']): AgentWorkspaceTask {
  return {
    id,
    projectPath: '/old',
    prompt: id,
    agent: 'claude',
    permissionMode: 'ask',
    status,
    createdAt: 100,
    updatedAt: 100,
  };
}

test('startup recovery marks live tasks detached and missing processes interrupted', () => {
  const normalized = normalizeLoadedAgentWorkspaceTasks(
    [task('live', 'running'), task('missing', 'awaiting_review'), task('done', 'done')],
    '/current',
    new Set(['live']),
  );

  assert.equal(normalized[0].status, 'detached');
  assert.equal(normalized[1].status, 'interrupted');
  assert.equal(normalized[2].status, 'done');
  assert.equal(normalized[0].projectPath, '/current');
  assert.equal(typeof normalized[0].attentionRequestedAt, 'number');
});

test('pending task writes flush when the AI workspace unmounts', () => {
  assert.match(source, /pendingSavesRef\.current\.set\(projectId, current\)/);
  assert.match(source, /for \(const \[projectId, tasks\] of pendingSavesRef\.current\)/);
  assert.match(source, /flush AI workspace tasks/);
  assert.match(source, /pendingSavesRef\.current\.clear\(\)/);
});
