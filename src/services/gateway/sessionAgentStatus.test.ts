import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatewaySessionAgentStatus } from './sessionAgentStatus';

test('只投影带非空说明的 Gateway 会话 Agent 状态', () => {
  assert.deepEqual(parseGatewaySessionAgentStatus({ note: ' waiting for review ' }), {
    note: 'waiting for review',
  });
  assert.equal(parseGatewaySessionAgentStatus({ note: '' }), null);
  assert.equal(parseGatewaySessionAgentStatus({ note: '  ' }), null);
  assert.equal(parseGatewaySessionAgentStatus({ note: 42 }), null);
  assert.equal(parseGatewaySessionAgentStatus(null), null);
});
