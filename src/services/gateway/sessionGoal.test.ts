import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatewaySessionGoal } from './sessionGoal';

const valid = {
  schemaVersion: 1,
  id: 'goal-1',
  objective: 'Keep the session task state durable',
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
  tokenStart: 3,
  tokensUsed: 4,
  continuationTurns: 5,
};

test('只投影完整且类型正确的 Gateway 会话目标', () => {
  assert.deepEqual(parseGatewaySessionGoal(valid), {
    id: 'goal-1',
    objective: 'Keep the session task state durable',
    status: 'active',
  });
  assert.deepEqual(parseGatewaySessionGoal({
    ...valid,
    status: 'blocked',
    tokenBudget: 100,
    blockedAt: 6,
  }), {
    id: 'goal-1',
    objective: 'Keep the session task state durable',
    status: 'blocked',
  });
});

test('拒绝不完整、未知或伪造的本地会话目标', () => {
  assert.equal(parseGatewaySessionGoal({ ...valid, schemaVersion: 2 }), null);
  assert.equal(parseGatewaySessionGoal({ ...valid, status: 'running' }), null);
  assert.equal(parseGatewaySessionGoal({ ...valid, objective: '   ' }), null);
  assert.equal(parseGatewaySessionGoal({ ...valid, tokensUsed: -1 }), null);
  assert.equal(parseGatewaySessionGoal({ ...valid, tokenBudget: '100' }), null);
  assert.equal(parseGatewaySessionGoal({ ...valid, completedAt: -1 }), null);
});
