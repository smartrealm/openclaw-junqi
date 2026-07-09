import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveProviderSecret } from './providerSecretResolver';

test('resolveProviderSecret treats provider apiKey env refs as configured even when Desktop has no plaintext value', () => {
  const secret = resolveProviderSecret(
    {
      models: {
        providers: {
          deepseek: {
            apiKey: '${DEEPSEEK_API_KEY}',
          },
        },
      },
    } as any,
    'deepseek',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'provider-apiKey-env-ref');
  assert.equal(secret.envKey, 'DEEPSEEK_API_KEY');
  assert.equal(secret.value, undefined);
});

test('resolveProviderSecret prefers visible template env vars when present', () => {
  const secret = resolveProviderSecret(
    {
      env: {
        vars: {
          ZAI_API_KEY: 'secret-value',
        },
      },
    } as any,
    'zai',
    { id: 'zai', envKey: 'ZAI_API_KEY' },
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'template-env');
  assert.equal(secret.envKey, 'ZAI_API_KEY');
  assert.equal(secret.value, 'secret-value');
});

test('resolveProviderSecret reports none only when no supported credential source exists', () => {
  const secret = resolveProviderSecret(
    {
      models: {
        providers: {
          custom: {
            baseUrl: 'https://example.invalid/v1',
          },
        },
      },
    } as any,
    'custom',
  );

  assert.equal(secret.configured, false);
  assert.equal(secret.source, 'none');
});
