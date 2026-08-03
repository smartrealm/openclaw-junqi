import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BROWSER_PROVIDER_DESCRIPTORS,
  hasOpenClawBrowserTool,
  parseBrowserProviderProbes,
} from './browserProviders';

test('browser provider probe keeps the native and external providers distinct', () => {
  const result = parseBrowserProviderProbes([{
    providerId: 'ego-lite',
    status: 'available',
    platform: 'macos',
    platformSupported: true,
    executablePath: '/usr/local/bin/ego-browser',
  }]);

  assert.equal(result[0]?.providerId, 'ego-lite');
  assert.equal(result[0]?.executablePath, '/usr/local/bin/ego-browser');
  assert.deepEqual(BROWSER_PROVIDER_DESCRIPTORS.map((provider) => provider.id), [
    'openclaw-native',
    'ego-lite',
  ]);
});

test('browser provider probe rejects unknown providers and invalid status values', () => {
  assert.throws(() => parseBrowserProviderProbes([{ providerId: 'fake', status: 'available', platform: 'macos', platformSupported: true }]));
  assert.throws(() => parseBrowserProviderProbes([{ providerId: 'ego-lite', status: 'ready', platform: 'macos', platformSupported: true }]));
});

test('native browser availability is derived from the effective Gateway tool list', () => {
  assert.equal(hasOpenClawBrowserTool({
    agentId: 'main',
    profile: 'full',
    groups: [{ id: 'core', source: 'core', label: 'Core', tools: [{
      id: 'browser', label: 'Browser', description: '', rawDescription: '', source: 'core',
    }] }],
  }), true);
  assert.equal(hasOpenClawBrowserTool(null), false);
});
