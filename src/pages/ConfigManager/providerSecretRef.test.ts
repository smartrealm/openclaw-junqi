import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderSecretRef, clearProviderSecretRef } from './providerSecretRef';

test('BUG-MP-07 creates an official env SecretRef and allowlist', () => {
  const next = applyProviderSecretRef({
    config: { models: { providers: { openai: { baseUrl: 'https://api.openai.com/v1' } } } },
    providerId: 'openai',
    secretProviderId: 'system-env',
    secretId: 'OPENAI_API_KEY',
    definition: { source: 'env' },
  });
  assert.deepEqual(next.models?.providers?.openai.apiKey, {
    source: 'env', provider: 'system-env', id: 'OPENAI_API_KEY',
  });
  assert.deepEqual(next.secrets?.providers?.['system-env'], {
    source: 'env', allowlist: ['OPENAI_API_KEY'],
  });
});

test('BUG-MP-07 clearing a reference preserves the shared secret provider', () => {
  const configured = applyProviderSecretRef({
    config: {}, providerId: 'openai', secretProviderId: 'vault-file', secretId: 'openai',
    definition: { source: 'file', path: '/secure/secrets.json', mode: 'json' },
  });
  const next = clearProviderSecretRef(configured, 'openai');
  assert.equal(next.models?.providers?.openai.apiKey, undefined);
  assert.deepEqual(next.secrets?.providers?.['vault-file'], configured.secrets?.providers?.['vault-file']);
});

test('BUG-MP-07 rejects malformed env references', () => {
  assert.throws(() => applyProviderSecretRef({
    config: {}, providerId: 'openai', secretProviderId: 'system-env', secretId: 'not-valid',
    definition: { source: 'env' },
  }), /uppercase/);
});
