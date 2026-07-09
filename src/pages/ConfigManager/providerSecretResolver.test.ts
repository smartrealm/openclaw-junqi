import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveProviderSecret } from './providerSecretResolver';

test('resolveProviderSecret reads OpenClaw auth-store key fields dynamically', () => {
  const secret = resolveProviderSecret(
    {
      auth: {
        profiles: {
          'provider-auth:default': {
            provider: 'provider-auth',
            type: 'api_key',
            key: 'profile-key',
          },
        },
      },
    } as any,
    'provider-auth',
    undefined,
    'provider-auth:default',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'profile-key');
  assert.equal(secret.value, 'profile-key');
});

test('resolveProviderSecret treats OpenClaw keyRef fields as configured references', () => {
  const secret = resolveProviderSecret(
    {
      auth: {
        profiles: {
          'provider-ref:default': {
            provider: 'provider-ref',
            type: 'api_key',
            keyRef: { provider: 'env', name: 'PROVIDER_REF_API_KEY' },
          },
        },
      },
    } as any,
    'provider-ref',
    undefined,
    'provider-ref:default',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'profile-key-ref');
  assert.equal(secret.value, undefined);
});

test('resolveProviderSecret treats provider apiKey SecretRef objects as configured references', () => {
  const secret = resolveProviderSecret(
    {
      models: {
        providers: {
          'provider-secret-ref': {
            apiKey: { provider: 'file', path: '/run/secrets/provider' },
          },
        },
      },
    } as any,
    'provider-secret-ref',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'provider-apiKey-secret-ref');
  assert.equal(secret.value, undefined);
});

test('resolveProviderSecret treats any provider apiKey env refs as configured even when Desktop has no plaintext value', () => {
  const secret = resolveProviderSecret(
    {
      models: {
        providers: {
          'provider-alpha': {
            apiKey: '${PROVIDER_ALPHA_API_KEY}',
          },
        },
      },
    } as any,
    'provider-alpha',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'provider-apiKey-env-ref');
  assert.equal(secret.envKey, 'PROVIDER_ALPHA_API_KEY');
  assert.equal(secret.value, undefined);
});

test('resolveProviderSecret prefers visible template env vars for any matching template', () => {
  const secret = resolveProviderSecret(
    {
      env: {
        vars: {
          PROVIDER_BETA_API_KEY: 'secret-value',
        },
      },
    } as any,
    'provider-beta',
    { id: 'provider-beta', envKey: 'PROVIDER_BETA_API_KEY' },
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'template-env');
  assert.equal(secret.envKey, 'PROVIDER_BETA_API_KEY');
  assert.equal(secret.value, 'secret-value');
});

test('resolveProviderSecret treats provider-level raw apiKey as configured for any provider id', () => {
  const secret = resolveProviderSecret(
    {
      models: {
        providers: {
          'provider-gamma': {
            apiKey: 'raw-provider-key',
          },
        },
      },
    } as any,
    'provider-gamma',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'provider-apiKey-raw');
  assert.equal(secret.value, 'raw-provider-key');
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
