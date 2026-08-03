import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseStorageRuntimePaths,
  parseSystemMetricsPayload,
  parseTauriPlatformInfo,
} from './tauriAdapterContracts';

test('Tauri adapter contracts retain only the platform fields rendered by JunQi', () => {
  assert.deepEqual(
    parseTauriPlatformInfo({
      os: 'linux',
      arch: 'x86_64',
      homeDir: '/private',
      desktopDir: '/private/Desktop',
    }),
    { os: 'linux', arch: 'x86_64' },
  );
});

test('Tauri adapter contracts reject malformed platform responses', () => {
  assert.throws(() => parseTauriPlatformInfo(null), /get_platform_info/);
  assert.throws(() => parseTauriPlatformInfo({ os: 'darwin', arch: '' }), /platform arch/);
  assert.throws(() => parseTauriPlatformInfo({ os: 9, arch: 'aarch64' }), /platform os/);
});

test('storage path projection requires both verified native paths', () => {
  assert.deepEqual(
    parseStorageRuntimePaths({ stateDir: '/state', workspaceDir: '/workspace', configured: true }),
    { stateDir: '/state', workspaceDir: '/workspace' },
  );
  assert.equal(parseStorageRuntimePaths({ stateDir: '/state' }), null);
  assert.equal(parseStorageRuntimePaths({ stateDir: '', workspaceDir: '/workspace' }), null);
  assert.equal(parseStorageRuntimePaths(['not-an-object']), null);
});

test('system metrics accepts only complete non-negative native event payloads', () => {
  const metrics = {
    cpu: 9.8,
    cpu_count: 8,
    mem_used: 2,
    mem_total: 4,
    disk_used: 3,
    disk_total: 8,
    net_up_speed: 1,
    net_down_speed: 2,
    uptime: 6,
    load1: 0.1,
    load5: 0.2,
    load15: 0.3,
    platform: 'Linux',
    platform_version: '1',
    arch: 'x86_64',
  };

  assert.deepEqual(parseSystemMetricsPayload(metrics), metrics);
  assert.equal(parseSystemMetricsPayload({ ...metrics, mem_total: -1 }), null);
  assert.equal(parseSystemMetricsPayload({ ...metrics, platform: '' }), null);
  assert.equal(parseSystemMetricsPayload({ ...metrics, load5: Number.NaN }), null);
});
