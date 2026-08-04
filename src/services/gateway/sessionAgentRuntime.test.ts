import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGatewaySessionAgentRuntime } from './sessionAgentRuntime';

test('会话 Agent Runtime 仅保留 Gateway 确认的非空 id', () => {
  assert.deepEqual(parseGatewaySessionAgentRuntime({ id: ' codex ', source: 'model' }), {
    id: 'codex',
  });
  assert.deepEqual(parseGatewaySessionAgentRuntime({ id: 'future-runtime' }), {
    id: 'future-runtime',
  });
});

test('会话 Agent Runtime 拒绝缺失或非法的 id', () => {
  assert.equal(parseGatewaySessionAgentRuntime(null), null);
  assert.equal(parseGatewaySessionAgentRuntime({}), null);
  assert.equal(parseGatewaySessionAgentRuntime({ id: '   ' }), null);
  assert.equal(parseGatewaySessionAgentRuntime({ id: 42 }), null);
});
