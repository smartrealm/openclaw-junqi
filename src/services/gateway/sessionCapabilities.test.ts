import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenClawSessionHistoryCapabilities } from './sessionCapabilities';

const observation = (methods: string[]) => ({
  endpoint: 'ws://127.0.0.1:18789',
  protocol: 4,
  serverVersion: '2026.7.2',
  connectionId: 'connection-1',
  stateDir: null,
  configPath: null,
  authMode: null,
  methods,
  events: [],
  negotiatedRole: 'operator',
  negotiatedScopes: [],
  observedAtMs: 0,
});

test('hides transcript history controls without an advertised method list', () => {
  assert.deepEqual(readOpenClawSessionHistoryCapabilities(null), {
    branches: false,
    branchSwitch: false,
    rewind: false,
    forkAtMessage: false,
  });
  assert.deepEqual(readOpenClawSessionHistoryCapabilities(observation([])), {
    branches: false,
    branchSwitch: false,
    rewind: false,
    forkAtMessage: false,
  });
});

test('maps every transcript history method independently', () => {
  assert.deepEqual(readOpenClawSessionHistoryCapabilities(observation([
    'sessions.branches.list',
    'sessions.fork',
  ])), {
    branches: true,
    branchSwitch: false,
    rewind: false,
    forkAtMessage: true,
  });
});
