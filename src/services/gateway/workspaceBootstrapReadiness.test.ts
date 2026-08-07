import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCurrentWorkspaceBootstrapData,
  hasCurrentWorkspaceBootstrapFailure,
  type WorkspaceBootstrapGatewayState,
} from './workspaceBootstrapReadiness';

function state(overrides: Partial<WorkspaceBootstrapGatewayState> = {}): WorkspaceBootstrapGatewayState {
  return {
    connectionStartedAt: 1_000,
    lastFetch: { sessions: 0, agents: 0, ...overrides.lastFetch },
    loading: { sessions: false, agents: false, ...overrides.loading },
    errors: { sessions: null, agents: null, ...overrides.errors },
    ...overrides,
  };
}

test('workspace bootstrap rejects snapshots from a previous Gateway connection', () => {
  assert.equal(hasCurrentWorkspaceBootstrapData(state({
    lastFetch: { sessions: 999, agents: 2_000 },
  })), false);
});

test('workspace bootstrap opens after the current session snapshot', () => {
  assert.equal(hasCurrentWorkspaceBootstrapData(state({
    lastFetch: { sessions: 1_000, agents: 0 },
  })), true);
  assert.equal(hasCurrentWorkspaceBootstrapData(state({
    lastFetch: { sessions: 999, agents: 1_001 },
  })), false);
});

test('workspace bootstrap failure only treats the required session request as fatal', () => {
  assert.equal(hasCurrentWorkspaceBootstrapFailure(state({
    loading: { sessions: true, agents: false },
    errors: { sessions: 'timeout', agents: null },
  })), false);
  assert.equal(hasCurrentWorkspaceBootstrapFailure(state({
    errors: { sessions: 'timeout', agents: null },
  })), true);
  assert.equal(hasCurrentWorkspaceBootstrapFailure(state({
    lastFetch: { sessions: 1_000, agents: 1_000 },
    errors: { sessions: 'timeout', agents: null },
  })), false);
  assert.equal(hasCurrentWorkspaceBootstrapFailure(state({
    errors: { sessions: null, agents: 'unauthorized' },
  })), false);
});
