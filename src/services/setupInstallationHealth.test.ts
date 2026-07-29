import assert from 'node:assert/strict';
import test from 'node:test';
import type { OpenclawStatus } from '@/api/tauri-commands';
import { validateCachedSetupInstallation } from './setupInstallationHealth';

const healthyDocker = {
  available: true,
  version: '27.0.0',
  daemon_running: true,
  unsupported_reason: null,
  image_available: true,
};

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
    checkDockerRuntime: async () => healthyDocker,
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
      checkDockerRuntime: async () => healthyDocker,
    });
    assert.equal(valid, false);
  }
});

test('cached Docker setup validates the selected durable runtime', async () => {
  let nativeChecks = 0;
  const valid = await validateCachedSetupInstallation({
    detectRuntime: async () => ({ runtime_mode: 'docker' }),
    checkNativeOpenclaw: async () => {
      nativeChecks += 1;
      return nativeStatus();
    },
    checkDockerRuntime: async () => healthyDocker,
  });

  assert.equal(valid, true);
  assert.equal(nativeChecks, 0);
});

test('cached Docker setup returns to setup when Docker or its available image is missing', async () => {
  for (const docker of [
    { ...healthyDocker, available: false, daemon_running: false, image_available: false },
    { ...healthyDocker, unsupported_reason: 'unsupported host' },
    { ...healthyDocker, image_available: false },
  ]) {
    const valid = await validateCachedSetupInstallation({
      detectRuntime: async () => ({ runtime_mode: 'docker' }),
      checkNativeOpenclaw: async () => nativeStatus(),
      checkDockerRuntime: async () => docker,
    });
    assert.equal(valid, false);
  }
});

test('cached Docker setup leaves a stopped daemon to cold-start recovery', async () => {
  const valid = await validateCachedSetupInstallation({
    detectRuntime: async () => ({ runtime_mode: 'docker' }),
    checkNativeOpenclaw: async () => nativeStatus(),
    checkDockerRuntime: async () => ({
      ...healthyDocker,
      daemon_running: false,
      image_available: false,
    }),
  });

  assert.equal(valid, true);
});
