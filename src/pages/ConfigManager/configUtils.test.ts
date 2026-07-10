import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authProfilesForRuntime,
  canonicalProviderId,
  normalizeAuthProfilesFromDisk,
} from './configUtils';

test('authProfilesForRuntime emits only strict OpenClaw profile fields', () => {
  const normalized = authProfilesForRuntime({
    'modelstudio:work': {
      provider: 'modelstudio',
      mode: 'api_key',
      apiKey: 'must-not-be-written',
      profileName: 'Work account',
      email: ' user@example.com ',
      unknown: true,
    },
  }, canonicalProviderId);

  assert.deepEqual(normalized, {
    'qwen:work': {
      provider: 'qwen',
      mode: 'api_key',
      email: 'user@example.com',
      displayName: 'Work account',
    },
  });
});

test('authProfilesForRuntime preserves native modes, maps UI OAuth, and omits local profiles', () => {
  const normalized = authProfilesForRuntime({
    'bedrock:main': { provider: 'bedrock', mode: 'aws-sdk' },
    'custom:token': { provider: 'custom', mode: 'token' },
    'openai:browser': { provider: 'openai', mode: 'oauth_browser' },
    'ollama:main': { provider: 'ollama', mode: 'local' },
  }, canonicalProviderId);

  assert.deepEqual(normalized, {
    'bedrock:main': { provider: 'bedrock', mode: 'aws-sdk' },
    'custom:token': { provider: 'custom', mode: 'token' },
    'openai:browser': { provider: 'openai', mode: 'oauth' },
  });
});

test('normalizeAuthProfilesFromDisk keeps native modes but migrates legacy inline token secrets', () => {
  const normalized = normalizeAuthProfilesFromDisk({
    'bedrock:main': { provider: 'bedrock', mode: 'aws-sdk' },
    'custom:stored-token': { provider: 'custom', mode: 'token' },
    'openai:oauth': { provider: 'openai', mode: 'oauth', displayName: 'Browser login' },
    'legacy:main': { provider: 'legacy', mode: 'token', token: 'legacy-secret' },
  });

  assert.equal(normalized?.['bedrock:main']?.mode, 'aws-sdk');
  assert.equal(normalized?.['custom:stored-token']?.mode, 'token');
  assert.equal(normalized?.['openai:oauth']?.mode, 'oauth');
  assert.equal(normalized?.['openai:oauth']?.profileName, 'Browser login');
  assert.equal(normalized?.['legacy:main']?.mode, 'api_key');
  assert.equal(normalized?.['legacy:main']?.apiKey, 'legacy-secret');
  assert.equal(normalized?.['legacy:main']?.token, undefined);
});
