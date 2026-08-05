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

test('workspace bootstrap requires both current connection snapshots', () => {
  assert.equal(hasCurrentWorkspaceBootstrapData(state({
    lastFetch: { sessions: 1_000, agents: 1_001 },
  })), true);
  assert.equal(hasCurrentWorkspaceBootstrapData(state({
    lastFetch: { sessions: 1_001, agents: 0 },
  })), false);
});

test('workspace bootstrap failure waits for requests to settle and never overrides success', () => {
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
});
