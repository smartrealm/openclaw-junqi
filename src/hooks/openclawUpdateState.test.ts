import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenclawUpdateResult, OpenclawUpdateStatus } from '@/api/tauri-commands';
import { initialOpenclawUpdateState, openclawUpdateReducer } from './openclawUpdateState';

const status: OpenclawUpdateStatus = {
  currentVersion: '2026.6.11',
  latestVersion: '2026.7.1',
  available: true,
  hasGitUpdate: false,
  hasRegistryUpdate: true,
  gitBehind: null,
  channel: 'stable',
  channelLabel: 'stable (default)',
  installKind: 'package',
  packageManager: 'npm',
  error: null,
};

test('update state distinguishes available status from a failed check', () => {
  const checking = openclawUpdateReducer(initialOpenclawUpdateState, { type: 'checkStarted' });
  assert.equal(checking.phase, 'checking');

  const ready = openclawUpdateReducer(checking, { type: 'checkCompleted', status });
  assert.equal(ready.phase, 'ready');
  assert.equal(ready.status?.available, true);

  const failed = openclawUpdateReducer(ready, {
    type: 'checkCompleted',
    status: { ...status, available: false, error: 'network unavailable' },
  });
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error, 'network unavailable');
});

test('successful update retains the refreshed runtime status', () => {
  const result: OpenclawUpdateResult = {
    success: true,
    status: 'ok',
    mode: 'npm',
    reason: null,
    beforeVersion: '2026.6.11',
    afterVersion: '2026.7.1',
    gatewayRestarted: true,
    gatewayError: null,
    error: null,
  };
  const next = openclawUpdateReducer(
    { ...initialOpenclawUpdateState, status },
    {
      type: 'updateCompleted',
      result,
      status: { ...status, currentVersion: '2026.7.1', available: false },
    },
  );

  assert.equal(next.phase, 'success');
  assert.equal(next.status?.currentVersion, '2026.7.1');
  assert.equal(next.result?.gatewayRestarted, true);
});
