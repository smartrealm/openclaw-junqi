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
