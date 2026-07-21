import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWorkflowGraphProjection,
  workflowGraphEdgePath,
} from './workflowGraph';
import type { CollaborationWorkItemSnapshot } from './types';

function item(
  logicalId: string,
  dependencies: string[] = [],
): CollaborationWorkItemSnapshot {
  return {
    id: `item-${logicalId}`,
    logicalId,
    planRevisionId: 'plan-1',
    title: logicalId,
    status: 'PLANNED',
    inputScope: [],
    dependencies,
    requiredCapabilities: [],
    candidateAgentIds: ['worker'],
    acceptanceCriteria: [],
    revision: 1,
    riskLevel: 'LOW',
    sideEffectClass: 'READ_ONLY',
  };
}

test('workflow graph projects only declared dependency edges into stable layers', () => {
  const graph = buildWorkflowGraphProjection([
    item('review', ['research']),
    item('research'),
    item('publish', ['review', 'missing-item']),
  ]);

  assert.deepEqual(graph.nodes.map((node) => [node.id, node.column, node.row]), [
    ['research', 0, 0],
    ['review', 1, 0],
    ['publish', 2, 0],
  ]);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['research->review', 'review->publish']);
  assert.match(workflowGraphEdgePath(graph.edges[0]!), /^M \d+ \d+ C /);
});

test('workflow graph keeps independent roots in deterministic rows', () => {
  const graph = buildWorkflowGraphProjection([item('beta'), item('alpha')]);
  assert.deepEqual(graph.nodes.map((node) => [node.id, node.column, node.row]), [
    ['alpha', 0, 0],
    ['beta', 0, 1],
  ]);
  assert.equal(graph.edges.length, 0);
});
