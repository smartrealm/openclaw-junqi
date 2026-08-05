import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayHelloObservation } from './runtimeIdentity';
import { readOpenClawSessionHistoryCapabilities } from './sessionCapabilities';

test('会话历史操作要求 Gateway 明确声明方法', () => {
  assert.deepEqual(readOpenClawSessionHistoryCapabilities(null), {
    branches: false,
    branchSwitch: false,
    rewind: false,
    forkAtMessage: false,
  });

  const capabilities = readOpenClawSessionHistoryCapabilities(buildGatewayHelloObservation('ws://127.0.0.1:18789', {
    protocol: 4,
    server: { connId: 'connection-1' },
    features: { methods: ['sessions.branches.list', 'sessions.fork'] },
  }));
  assert.equal(capabilities.branches, true);
  assert.equal(capabilities.branchSwitch, false);
  assert.equal(capabilities.rewind, false);
  assert.equal(capabilities.forkAtMessage, true);
});

test('会话历史方法按 Gateway 声明独立映射', () => {
  const capabilities = readOpenClawSessionHistoryCapabilities(buildGatewayHelloObservation('ws://127.0.0.1:18789', {
    protocol: 4,
    server: { connId: 'connection-1' },
    features: { methods: ['sessions.branches.switch', 'sessions.rewind'] },
  }));
  assert.deepEqual(capabilities, {
    branches: false,
    branchSwitch: true,
    rewind: true,
    forkAtMessage: false,
  });
});
