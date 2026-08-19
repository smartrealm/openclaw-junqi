import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkspaceBootstrapReadiness,
  releaseWorkspaceAfterGatewayData,
  shouldReleaseWorkspaceAfterGatewayRetryExhaustion,
} from './workspaceBootstrapReadiness';

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

test('当前连接的集中会话快照可在单独首屏请求被取代后放行工作区', () => {
  const readiness = createWorkspaceBootstrapReadiness();

  assert.equal(releaseWorkspaceAfterGatewayData(readiness, false), false);
  assert.equal(readiness.isWorkspaceDataReady(), false);

  assert.equal(releaseWorkspaceAfterGatewayData(readiness, true), true);
  assert.equal(readiness.isWorkspaceDataReady(), true);
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

test('仅在已完成安装验证后，连接重试穷尽才能放行可恢复工作区', () => {
  assert.equal(shouldReleaseWorkspaceAfterGatewayRetryExhaustion(false, false), false);
  assert.equal(shouldReleaseWorkspaceAfterGatewayRetryExhaustion(true, true), false);
  assert.equal(shouldReleaseWorkspaceAfterGatewayRetryExhaustion(true, false), true);
});
