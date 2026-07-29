import assert from 'node:assert/strict';
import test from 'node:test';
import { localizeSetupProgressDetail } from './useSetupProgress';

test('localizes an active setup event with the current language translator', () => {
  const detail = {
    step: 'gateway',
    message: 'Preparing Gateway...',
    progress: 42,
    key: 'setup.gateway.preparing',
    params: {},
  };

  const chinese = localizeSetupProgressDetail(
    () => '正在准备 OpenClaw Gateway…',
    detail,
  );
  const english = localizeSetupProgressDetail(
    () => 'Preparing OpenClaw Gateway…',
    detail,
  );

  assert.equal(chinese.message, '正在准备 OpenClaw Gateway…');
  assert.equal(english.message, 'Preparing OpenClaw Gateway…');
  assert.equal(english.progress, 42);
});

test('retains the raw event message when a translation key is unavailable', () => {
  const detail = localizeSetupProgressDetail(
    (key) => key,
    {
      step: 'gateway',
      message: 'Preparing Gateway...',
      progress: 42,
      key: 'setup.gateway.preparing',
    },
  );

  assert.equal(detail.message, 'Preparing Gateway...');
});

test('passes runtime interpolation parameters to the translator', () => {
  let receivedParams: Record<string, unknown> | undefined;
  const detail = localizeSetupProgressDetail(
    (_key, params) => {
      receivedParams = params;
      return `Gateway runtime ${String(params?.mode)} is ready`;
    },
    {
      step: 'gateway',
      message: 'Gateway runtime is ready',
      progress: 0.75,
      key: 'gateway.progress.runtimeReady',
      params: { mode: 'system-service' },
      status: 'running',
    },
  );

  assert.deepEqual(receivedParams, { mode: 'system-service' });
  assert.equal(detail.message, 'Gateway runtime system-service is ready');
  assert.doesNotMatch(detail.message, /\{\{/);
});
