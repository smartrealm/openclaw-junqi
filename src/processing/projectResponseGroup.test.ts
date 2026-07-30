import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResponseGroups } from './buildResponseGroups';
import { buildSemanticBlocks } from './buildSemanticBlocks';
import { normalizeGatewayMessage } from './normalizeGatewayMessage';
import { projectResponseGroupToRenderBlocks } from './projectResponseGroup';

function planMessage(id: string, plan: Array<{ step: string; status: string }>) {
  return normalizeGatewayMessage({
    id,
    sessionKey: 'agent:main:main',
    runId: 'run-plan',
    role: 'tool',
    timestamp: `2026-07-30T10:00:0${id.endsWith('2') ? '2' : '1'}.000Z`,
    toolName: 'update_plan',
    toolInput: { plan },
    toolStatus: 'done',
  });
}

test('response projection replaces plan revisions with one latest plan card', () => {
  const semanticBlocks = [
    ...buildSemanticBlocks(planMessage('plan-1', [
      { step: 'Inspect protocol', status: 'in_progress' },
      { step: 'Run tests', status: 'pending' },
    ]), { toolIntentEnabled: true }),
    ...buildSemanticBlocks(planMessage('plan-2', [
      { step: 'Inspect protocol', status: 'completed' },
      { step: 'Implement Chat card', status: 'in_progress' },
      { step: 'Run tests', status: 'pending' },
    ]), { toolIntentEnabled: true }),
  ];
  const groups = buildResponseGroups(semanticBlocks);
  assert.equal(groups.length, 1);

  const blocks = projectResponseGroupToRenderBlocks(groups[0]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'execution-plan');
  if (blocks[0].type === 'execution-plan') {
    assert.equal(blocks[0].plan.revision, 2);
    assert.equal(blocks[0].plan.steps.length, 3);
    assert.equal(blocks[0].plan.currentStepIndex, 1);
    assert.equal(blocks[0].plan.previousStepCount, 2);
  }
});
