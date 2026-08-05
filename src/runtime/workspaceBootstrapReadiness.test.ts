import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceBootstrapReadiness } from './workspaceBootstrapReadiness';

test('首批 Gateway 数据水合只放行工作区，不重置就绪状态', () => {
  const readiness = createWorkspaceBootstrapReadiness();

  assert.equal(readiness.markInitialWorkspaceDataReady(), false);

  readiness.updateGatewayDataReady(true);
  assert.equal(readiness.markInitialWorkspaceDataReady(), true);
  assert.equal(readiness.isWorkspaceDataReady(), true);

  readiness.updateGatewayDataReady(false);
  readiness.updateGatewayDataReady(true);
  assert.equal(readiness.markInitialWorkspaceDataReady(), false);
});

test('不完整快照仅可由明确的失败路径放行，重置后重新等待', () => {
  const readiness = createWorkspaceBootstrapReadiness();

  assert.equal(readiness.markInitialWorkspaceDataReady(true), true);
  readiness.reset();

  assert.equal(readiness.isWorkspaceDataReady(), false);
  assert.equal(readiness.markInitialWorkspaceDataReady(), false);
  readiness.updateGatewayDataReady(true);
  assert.equal(readiness.markInitialWorkspaceDataReady(), true);
});
