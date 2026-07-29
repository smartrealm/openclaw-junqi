import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSetupCompletion } from './setupCompletionGate';

function dependencies(overrides: Partial<Parameters<typeof validateSetupCompletion>[0]> = {}) {
  return {
    probeGateway: async () => true,
    requiresOnboarding: async () => false,
    probeModel: async () => ({ ready: true, model: 'openai/gpt-5.6' }),
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
  let modelChecked = false;
  const result = await validateSetupCompletion(dependencies({
    requiresOnboarding: async () => true,
    probeModel: async () => {
      modelChecked = true;
      return { ready: true };
    },
  }));

  assert.deepEqual(result, { ready: false, reason: 'onboarding-required' });
  assert.equal(modelChecked, false);
});

test('setup completion returns the live model diagnostic without treating Gateway health as model health', async () => {
  const result = await validateSetupCompletion(dependencies({
    probeModel: async () => ({ ready: false, detail: 'provider authorization failed' }),
  }));

  assert.deepEqual(result, {
    ready: false,
    reason: 'model-unavailable',
    detail: 'provider authorization failed',
  });
});

test('setup completion succeeds only after all three checks pass', async () => {
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
    probeModel: async () => {
      calls.push('model');
      return { ready: true, model: 'openai/gpt-5.6' };
    },
  });

  assert.deepEqual(result, { ready: true, model: 'openai/gpt-5.6' });
  assert.deepEqual(calls, ['gateway', 'config', 'model']);
});
