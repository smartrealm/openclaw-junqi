import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenClawLegacyProgressPlanUpdate } from '@/progress-card/domain';
import { ProgressCardCompatibilityGate } from './progressCardCompatibilityGate';

function update(
  sessionKey = 'agent:main:main',
  steps: OpenClawLegacyProgressPlanUpdate['steps'] = [
    { id: 'step-one', step: '核对协议', status: 'in_progress' },
  ],
): OpenClawLegacyProgressPlanUpdate {
  return {
    sessionKey,
    updatedAt: 1,
    steps,
  };
}

test('能力未知时暂存官方计划流，真实 RPC 不可用后再发布', () => {
  const gate = new ProgressCardCompatibilityGate();
  assert.equal(gate.receive('connection-a', update()), null);

  const projections = gate.recordLegacyStream('connection-a');
  assert.equal(projections.length, 1);
  assert.equal(projections[0]?.card?.steps[0]?.step, '核对协议');
  assert.equal(projections[0]?.card?.revision, 1);
});

test('持久化进度卡可用时丢弃暂存并忽略双发旧流', () => {
  const gate = new ProgressCardCompatibilityGate();
  gate.receive('connection-a', update());
  gate.recordDurable('connection-a');

  assert.deepEqual(gate.recordLegacyStream('connection-a'), []);
  gate.recordDurable('connection-a');
  assert.equal(gate.receive('connection-a', update()), null);
});

test('物理连接变化清除旧计划与本地修订序号', () => {
  const gate = new ProgressCardCompatibilityGate();
  gate.receive('connection-a', update());
  gate.observeConnection('connection-b');
  assert.deepEqual(gate.recordLegacyStream('connection-b'), []);

  const projection = gate.receive('connection-b', update());
  assert.equal(projection?.card?.revision, 1);
});

test('旧计划流空步骤发布清除投影', () => {
  const gate = new ProgressCardCompatibilityGate();
  gate.recordLegacyStream('connection-a');
  const projection = gate.receive('connection-a', update('agent:main:main', []));
  assert.equal(projection?.card, null);
});
