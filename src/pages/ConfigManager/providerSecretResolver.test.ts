import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProviderSecretPatch,
  deriveProviderApiKeyEnvKey,
  getProviderSecretEnvKeysForRemoval,
  isProviderSecretEnvKeyInUse,
  resolveProviderSecret,
} from './providerSecretResolver';

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

test('resolveProviderSecret reads provider apiKey despite provider key case drift', () => {
  const secret = resolveProviderSecret(
    {
      models: {
        providers: {
          'Provider-Gamma': {
            apiKey: '${PROVIDER_GAMMA_API_KEY}',
          },
        },
      },
      env: {
        vars: {
          PROVIDER_GAMMA_API_KEY: 'drift-secret',
        },
      },
    } as any,
    'provider-gamma',
  );

  assert.equal(secret.configured, true);
  assert.equal(secret.source, 'provider-apiKey-env-ref');
  assert.equal(secret.envKey, 'PROVIDER_GAMMA_API_KEY');
  assert.equal(secret.value, 'drift-secret');
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

test('buildProviderSecretPatch stores template provider secrets in env vars and strips profile secret', () => {
  const next = buildProviderSecretPatch({
    prev: {},
    providerId: 'openai',
    profileKey: 'openai:main',
    profile: { provider: 'openai', mode: 'api_key', apiKey: 'sk-live' },
    secret: 'sk-live',
    template: { id: 'openai', envKey: 'OPENAI_API_KEY' },
  } as any);

  assert.equal(next.env?.vars?.OPENAI_API_KEY, 'sk-live');
  assert.equal(next.auth?.profiles?.['openai:main']?.apiKey, undefined);
  assert.equal(next.models?.providers?.openai?.apiKey, undefined);
});

test('buildProviderSecretPatch stores custom provider secrets as env ref plus env value', () => {
  const next = buildProviderSecretPatch({
    prev: {},
    providerId: 'my-vllm',
    profileKey: 'my-vllm:main',
    profile: { provider: 'my-vllm', mode: 'api_key', apiKey: 'local-secret' },
    secret: 'local-secret',
    providerEnvKey: 'MY_VLLM_API_KEY',
    preferProviderConfig: true,
  } as any);

  assert.equal(next.env?.vars?.MY_VLLM_API_KEY, 'local-secret');
  assert.equal(next.models?.providers?.['my-vllm']?.apiKey, '${MY_VLLM_API_KEY}');
  assert.equal(next.auth?.profiles?.['my-vllm:main']?.apiKey, undefined);
});

test('buildProviderSecretPatch falls back to raw provider apiKey only without any env key', () => {
  const next = buildProviderSecretPatch({
    prev: {},
    providerId: 'raw-provider',
    profileKey: 'raw-provider:main',
    profile: { provider: 'raw-provider', mode: 'api_key', apiKey: 'raw-secret' },
    secret: 'raw-secret',
    preferProviderConfig: true,
  } as any);

  assert.equal(next.env?.vars, undefined);
  assert.equal(next.models?.providers?.['raw-provider']?.apiKey, 'raw-secret');
  assert.equal(next.auth?.profiles?.['raw-provider:main']?.apiKey, undefined);
});

test('buildProviderSecretPatch preserves existing inline profile secret when no new secret is submitted', () => {
  const next = buildProviderSecretPatch({
    prev: {},
    providerId: 'openai',
    profileKey: 'openai:main',
    profile: {
      provider: 'openai',
      mode: 'api_key',
      profileName: 'Renamed',
      apiKey: 'legacy-inline-secret',
    },
    template: { id: 'openai', envKey: 'OPENAI_API_KEY' },
  } as any);

  assert.equal(next.auth?.profiles?.['openai:main']?.apiKey, 'legacy-inline-secret');
  assert.equal(next.env?.vars?.OPENAI_API_KEY, undefined);
});

test('buildProviderSecretPatch does not create or overwrite provider apiKey without a submitted secret', () => {
  const next = buildProviderSecretPatch({
    prev: {
      models: {
        providers: {
          'my-vllm': {
            apiKey: '${MY_VLLM_API_KEY}',
            baseUrl: 'http://localhost:8000/v1',
          },
        },
      },
    },
    providerId: 'my-vllm',
    profileKey: 'my-vllm:main',
    profile: { provider: 'my-vllm', mode: 'api_key', profileName: 'Renamed' },
    providerEnvKey: 'MY_VLLM_API_KEY',
    preferProviderConfig: true,
  } as any);

  assert.equal(next.models?.providers?.['my-vllm']?.apiKey, '${MY_VLLM_API_KEY}');
  assert.equal(next.models?.providers?.['my-vllm']?.baseUrl, 'http://localhost:8000/v1');
});

test('getProviderSecretEnvKeysForRemoval includes provider apiKey env refs and explicit provider env key', () => {
  const keys = getProviderSecretEnvKeysForRemoval({
    config: {
      models: {
        providers: {
          'my-vllm': {
            apiKey: '${MY_VLLM_API_KEY}',
          },
        },
      },
    } as any,
    providerId: 'my-vllm',
    providerEnvKey: 'MY_VLLM_API_KEY',
  });

  assert.deepEqual(keys, ['MY_VLLM_API_KEY']);
});

test('getProviderSecretEnvKeysForRemoval reads env refs from case-drifted provider keys', () => {
  const keys = getProviderSecretEnvKeysForRemoval({
    config: {
      models: {
        providers: {
          'My-VLLM': {
            apiKey: '${CUSTOM_VLLM_SECRET}',
          },
        },
      },
    } as any,
    providerId: 'my-vllm',
  });

  assert.deepEqual(keys, ['CUSTOM_VLLM_SECRET']);
});

test('getProviderSecretEnvKeysForRemoval includes template primary and alternate env keys', () => {
  const keys = getProviderSecretEnvKeysForRemoval({
    config: {},
    providerId: 'openai',
    template: {
      id: 'openai',
      envKey: 'OPENAI_API_KEY',
      envKeyAlt: ['OPENAI_COMPAT_API_KEY'],
    },
  } as any);

  assert.deepEqual(keys, ['OPENAI_API_KEY', 'OPENAI_COMPAT_API_KEY']);
});

test('isProviderSecretEnvKeyInUse detects remaining provider env references', () => {
  const inUse = isProviderSecretEnvKeyInUse({
    config: {
      models: {
        providers: {
          other: { apiKey: '${SHARED_API_KEY}' },
        },
      },
    } as any,
    envKey: 'SHARED_API_KEY',
  });

  assert.equal(inUse, true);
});

test('isProviderSecretEnvKeyInUse detects remaining template-backed profiles', () => {
  const inUse = isProviderSecretEnvKeyInUse({
    config: {
      auth: {
        profiles: {
          'openai:secondary': { provider: 'openai', mode: 'api_key' },
        },
      },
    } as any,
    envKey: 'OPENAI_API_KEY',
    resolveTemplate: (providerId) => (
      providerId === 'openai'
        ? { id: 'openai', envKey: 'OPENAI_API_KEY', envKeyAlt: ['OPENAI_COMPAT_API_KEY'] }
        : undefined
    ),
  });

  assert.equal(inUse, true);
});

test('isProviderSecretEnvKeyInUse returns false for removed provider-only env keys', () => {
  const inUse = isProviderSecretEnvKeyInUse({
    config: {
      auth: { profiles: {} },
      models: { providers: {} },
    } as any,
    envKey: 'MY_VLLM_API_KEY',
  });

  assert.equal(inUse, false);
});

test('deriveProviderApiKeyEnvKey is stable for custom provider ids', () => {
  assert.equal(deriveProviderApiKeyEnvKey('my-vllm'), 'MY_VLLM_API_KEY');
  assert.equal(
    deriveProviderApiKeyEnvKey('custom', { id: 'custom', envKey: 'OPENCLAW_CUSTOM_API_KEY' }),
    'OPENCLAW_CUSTOM_API_KEY',
  );
});
