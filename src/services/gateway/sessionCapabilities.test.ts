import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGatewayHelloObservation } from './runtimeIdentity';
import { readOpenClawSessionCapabilities } from './sessionCapabilities';

test('new session controls require explicit Gateway method advertisement', () => {
  assert.deepEqual(readOpenClawSessionCapabilities(null), {
    connectionId: null,
    methodsAdvertised: false,
    branches: false,
    branchSwitch: false,
    rewind: false,
    forkAtMessage: false,
    workspace: false,
    viewerPresence: false,
    abortSession: false,
  });

  const capabilities = readOpenClawSessionCapabilities(buildGatewayHelloObservation('ws://127.0.0.1:18789', {
    protocol: 4,
    server: { connId: 'connection-1' },
    features: { methods: ['sessions.branches.list', 'sessions.fork', 'sessions.files.list', 'sessions.files.get'] },
  }));
  assert.equal(capabilities.branches, true);
  assert.equal(capabilities.branchSwitch, false);
  assert.equal(capabilities.rewind, false);
  assert.equal(capabilities.forkAtMessage, true);
  assert.equal(capabilities.workspace, true);
});
