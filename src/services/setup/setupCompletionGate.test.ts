import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSetupCompletion } from './setupCompletionGate';

function dependencies(overrides: Partial<Parameters<typeof validateSetupCompletion>[0]> = {}) {
  return {
    probeGateway: async () => true,
    requiresOnboarding: async () => false,
    verifyConfiguredInference: async () => ({
      status: 'verified' as const,
      modelRef: 'openai/gpt-5.6-sol',
      latencyMs: 120,
    }),
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

test('setup completion rejects a static model reference that fails official live verification', async () => {
  const result = await validateSetupCompletion(dependencies({
    verifyConfiguredInference: async () => ({
      status: 'failed',
      reason: 'auth',
      error: 'Credential rejected',
    }),
  }));

  assert.deepEqual(result, {
    ready: false,
    reason: 'inference-unverified',
    verification: { status: 'failed', reason: 'auth', error: 'Credential rejected' },
  });
});

test('setup completion preserves an unavailable official verification capability', async () => {
  const result = await validateSetupCompletion(dependencies({
    verifyConfiguredInference: async () => ({
      status: 'unavailable',
      error: 'The connected OpenClaw Gateway does not support openclaw.setup.verify',
    }),
  }));

  assert.deepEqual(result, {
    ready: false,
    reason: 'inference-verification-unavailable',
    verification: {
      status: 'unavailable',
      error: 'The connected OpenClaw Gateway does not support openclaw.setup.verify',
    },
  });
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
    verifyConfiguredInference: async () => {
      calls.push('inference');
      return { status: 'verified', modelRef: 'openai/gpt-5.6-sol', latencyMs: 120 };
    },
  });

  assert.deepEqual(result, { ready: true });
  assert.deepEqual(calls, ['gateway', 'config', 'inference']);
});
