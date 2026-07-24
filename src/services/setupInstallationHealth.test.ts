import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenclawStatus } from '@/api/tauri-commands';
import { validateCachedSetupInstallation } from './setupInstallationHealth';

function nativeStatus(overrides: Partial<OpenclawStatus> = {}): OpenclawStatus {
  return {
    installed: true,
    version: '1.0.0',
    path: '/runtime/openclaw',
    source: 'test',
    binary_found: true,
    version_ok: true,
    package_valid: true,
    gateway_command_ok: true,
    relocation_required: false,
    error: null,
    ...overrides,
  };
}

test('cached Native setup validity does not depend on a running Gateway', async () => {
  const valid = await validateCachedSetupInstallation({
    detectRuntime: async () => ({ runtime_mode: 'native' }),
    checkNativeOpenclaw: async () => nativeStatus(),
  });

  assert.equal(valid, true);
});

test('cached Native setup re-enters setup for a missing or relocated package', async () => {
  for (const status of [
    nativeStatus({ installed: false }),
    nativeStatus({ relocation_required: true }),
  ]) {
    const valid = await validateCachedSetupInstallation({
      detectRuntime: async () => ({ runtime_mode: 'native' }),
      checkNativeOpenclaw: async () => status,
    });
    assert.equal(valid, false);
  }
});

test('cached Docker setup leaves daemon readiness to cold-start recovery', async () => {
  let nativeChecks = 0;
  const valid = await validateCachedSetupInstallation({
    detectRuntime: async () => ({ runtime_mode: 'docker' }),
    checkNativeOpenclaw: async () => {
      nativeChecks += 1;
      return nativeStatus();
    },
  });

  assert.equal(valid, true);
  assert.equal(nativeChecks, 0);
});
