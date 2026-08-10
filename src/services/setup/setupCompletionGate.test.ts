import assert from 'node:assert/strict';
import test from 'node:test';
import {
  shouldStartOfficialOnboarding,
  validateSetupCompletion,
} from './setupCompletionGate';
import { OpenClawSetupMethodUnavailableError } from '@/services/gateway/OpenClawSetupClient';

function dependencies(overrides: Partial<Parameters<typeof validateSetupCompletion>[0]> = {}) {
  return {
    probeGateway: async () => true,
    requiresOnboarding: async () => false,
    ...overrides,
  };
}

test('setup completion stops at an unavailable selected Gateway', async () => {
  let configChecked = false;
  const result = await validateSetupCompletion(dependencies({
    probeGateway: async () => false,
    requiresOnboarding: async () => {
      configChecked = true;
      return false;
    },
  }));

  assert.deepEqual(result, { ready: false, reason: 'gateway-unavailable' });
  assert.equal(configChecked, false);
});

test('setup completion rejects a selected-runtime config that still requires onboarding', async () => {
  const result = await validateSetupCompletion(dependencies({
    requiresOnboarding: async () => true,
  }));

  assert.deepEqual(result, { ready: false, reason: 'onboarding-required' });
  assert.equal(result.ready, false);
});

test('setup completion follows the native Gateway and configuration gates', async () => {
  const calls: string[] = [];
  const result = await validateSetupCompletion({
    probeGateway: async () => {
      calls.push('gateway');
      return true;
    },
    requiresOnboarding: async () => {
      calls.push('config');
      return false;
    },
  });

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(calls, ['gateway', 'config']);
});

test('缺少结构化检测方法时进入同一 Gateway 的官方向导', async () => {
  const startsWizard = await shouldStartOfficialOnboarding(async () => {
    throw new OpenClawSetupMethodUnavailableError(
      'openclaw.setup.detect',
      'unsupported',
      'Gateway method is not supported',
    );
  });

  assert.equal(startsWizard, true);
});

test('连接或响应异常不能被当作可跳过官方向导', async () => {
  await assert.rejects(
    shouldStartOfficialOnboarding(async () => {
      throw new OpenClawSetupMethodUnavailableError(
        'openclaw.setup.detect',
        'connection-unavailable',
        'authenticated Gateway connection is unavailable',
      );
    }),
    OpenClawSetupMethodUnavailableError,
  );
});
