import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { OpenclawUpdateResult, OpenclawUpdateStatus } from '@/api/tauri-commands';
import { initialOpenclawUpdateState, openclawUpdateReducer } from './openclawUpdateState';

const status: OpenclawUpdateStatus = {
  installedVersion: '2026.6.11',
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
  npmRegistry: 'https://registry.npmjs.org',
  npmRegistryKind: 'official',
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
    npmRegistry: 'https://registry.npmjs.org',
    npmRegistryKind: 'official',
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

test('update progress remains monotonic and suppresses adjacent duplicate logs', () => {
  let next = openclawUpdateReducer(initialOpenclawUpdateState, { type: 'updateStarted' });
  next = openclawUpdateReducer(next, {
    type: 'progressReceived',
    progress: 40,
    message: 'Checking Node.js runtime',
  });
  next = openclawUpdateReducer(next, {
    type: 'progressReceived',
    progress: 20,
    message: 'Checking Node.js runtime',
  });

  assert.equal(next.progress, 40);
  assert.deepEqual(next.logs, ['Checking Node.js runtime']);

  for (let index = 0; index < 205; index += 1) {
    next = openclawUpdateReducer(next, {
      type: 'progressReceived',
      progress: null,
      message: `line-${index}`,
    });
  }
  assert.equal(next.logs.length, 200);
  assert.equal(next.logs[0], 'line-5');
});

test('diagnostics stay in logs without replacing the localized progress phase', () => {
  let next = openclawUpdateReducer(initialOpenclawUpdateState, { type: 'updateStarted' });
  next = openclawUpdateReducer(next, {
    type: 'progressReceived',
    progress: 40,
    message: 'Checking Node.js runtime',
  });
  next = openclawUpdateReducer(next, {
    type: 'diagnosticReceived',
    message: 'npm http fetch GET 200 https://registry.npmjs.org/openclaw',
  });

  assert.equal(next.statusMessage, 'Checking Node.js runtime');
  assert.equal(next.progress, 40);
  assert.deepEqual(next.logs, [
    'Checking Node.js runtime',
    'npm http fetch GET 200 https://registry.npmjs.org/openclaw',
  ]);
});
