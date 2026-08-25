import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentFleetActivityProjection } from './agentFleetActivityProjection';

test('running/hasActiveRun/hasActiveSubagentRun 均视为忙碌，缺少 agentId 的会话被忽略', () => {
  const projection = buildAgentFleetActivityProjection(
    [
      { id: 'writer', name: 'Writer' },
      { id: 'researcher', name: 'Researcher' },
      { id: 'idle-agent', name: 'Idle Agent' },
    ],
    [
      { agentId: 'writer', running: true, updatedAt: 100 },
      { agentId: 'researcher', hasActiveRun: true, updatedAt: 200 },
      { agentId: 'researcher', hasActiveSubagentRun: false, running: false, updatedAt: 50 },
      { running: true, updatedAt: 999 },
      { agentId: 'idle-agent', running: false, hasActiveRun: false, updatedAt: 10 },
    ],
  );

  const byId = new Map(projection.map((entry) => [entry.agentId, entry]));
  assert.equal(byId.get('writer')?.active, true);
  assert.equal(byId.get('writer')?.activeSessionCount, 1);
  assert.equal(byId.get('researcher')?.active, true);
  assert.equal(byId.get('researcher')?.activeSessionCount, 1);
  assert.equal(byId.get('idle-agent')?.active, false);
  assert.equal(byId.get('idle-agent')?.activeSessionCount, 0);
});

test('忙碌 Agent 排在空闲 Agent 之前，同状态按显示名排序', () => {
  const projection = buildAgentFleetActivityProjection(
    [
      { id: 'zeta', name: 'Zeta' },
      { id: 'alpha', name: 'Alpha' },
      { id: 'busy-b', name: 'Busy B' },
      { id: 'busy-a', name: 'Busy A' },
    ],
    [
      { agentId: 'busy-b', running: true },
      { agentId: 'busy-a', running: true },
    ],
  );

  assert.deepEqual(projection.map((entry) => entry.agentId), ['busy-a', 'busy-b', 'alpha', 'zeta']);
});

test('无显示名回退到 agent id，最新活动时间取该 Agent 所有会话的最大值', () => {
  const projection = buildAgentFleetActivityProjection(
    [{ id: 'no-name-agent' }],
    [
      { agentId: 'no-name-agent', running: true, updatedAt: 10 },
      { agentId: 'no-name-agent', running: false, updatedAt: 500 },
    ],
  );

  assert.equal(projection[0]?.displayName, 'no-name-agent');
  assert.equal(projection[0]?.lastActiveAt, 500);
});

test('没有任何会话的 Agent 返回空闲状态与 null 活动时间', () => {
  const projection = buildAgentFleetActivityProjection(
    [{ id: 'solo', name: 'Solo' }],
    [],
  );

  assert.deepEqual(projection, [{
    agentId: 'solo',
    displayName: 'Solo',
    active: false,
    activeSessionCount: 0,
    lastActiveAt: null,
  }]);
});
