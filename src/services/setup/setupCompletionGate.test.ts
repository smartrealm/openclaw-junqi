import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileWizardSessionLoss, validateSetupCompletion } from './setupCompletionGate';

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

test('setup completion follows Gateway readiness and the current official terminal gate', async () => {
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

test('Wizard 会话丢失后即使 Gateway 可用也保留终态未知', async () => {
  const result = await reconcileWizardSessionLoss({
    probeGateway: async () => true,
  });

  assert.deepEqual(result, { state: 'terminal-unknown' });
});

test('Gateway 不可用时会话丢失保持不可核验', async () => {
  const result = await reconcileWizardSessionLoss({
    probeGateway: async () => false,
  });

  assert.deepEqual(result, { state: 'gateway-unavailable' });
});
