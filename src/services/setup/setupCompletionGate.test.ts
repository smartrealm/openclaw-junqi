import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSetupCompletion } from './setupCompletionGate';

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
