import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayHelloObservation } from './runtimeIdentity';
import { readOpenClawSessionHistoryCapabilities } from './sessionCapabilities';

test('会话历史操作在 Gateway 尚未完成认证握手时不可用', () => {
  assert.deepEqual(readOpenClawSessionHistoryCapabilities(null), {
    branches: false,
    branchSwitch: false,
    rewind: false,
    forkAtMessage: false,
  });

});

test('空握手方法列表不阻止调用官方会话历史 RPC', () => {
  const capabilities = readOpenClawSessionHistoryCapabilities(buildGatewayHelloObservation('ws://127.0.0.1:18789', {
    protocol: 4,
    server: { connId: 'connection-1' },
    features: { methods: [] },
  }));
  assert.equal(capabilities.branches, true);
  assert.equal(capabilities.branchSwitch, true);
  assert.equal(capabilities.rewind, true);
  assert.equal(capabilities.forkAtMessage, true);
});

test('不使用不完整的握手方法列表提前拒绝官方会话历史 RPC', () => {
  const capabilities = readOpenClawSessionHistoryCapabilities(buildGatewayHelloObservation('ws://127.0.0.1:18789', {
    protocol: 4,
    server: { connId: 'connection-1' },
    features: { methods: ['sessions.branches.switch', 'sessions.rewind'] },
  }));
  assert.deepEqual(capabilities, {
    branches: true,
    branchSwitch: true,
    rewind: true,
    forkAtMessage: true,
  });
});
