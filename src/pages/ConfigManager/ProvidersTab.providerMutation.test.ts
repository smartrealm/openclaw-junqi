import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderAddition, applyProviderRemoval } from './ProvidersTab';

test('applyProviderAddition normalizes provider ids, profile keys, model ids, and custom secrets', () => {
  const next = applyProviderAddition(
    {},
    ' My-VLLM : Work ',
    {
      provider: ' My-VLLM ',
      mode: 'api_key',
      apiKey: ' local-secret ',
    },
    [' model-a ', 'My-VLLM/model-a', '/model-b/'],
    {
      baseUrl: ' http://localhost:8000/v1 ',
      api: 'openai-completions',
      textPrimaryModel: ' model-a ',
    },
  );

  assert.equal(next.auth?.profiles?.['my-vllm:Work']?.provider, 'my-vllm');
  assert.equal(next.auth?.profiles?.['my-vllm:Work']?.apiKey, undefined);
  assert.equal(next.env?.vars?.MY_VLLM_API_KEY, 'local-secret');
  assert.equal(next.models?.providers?.['my-vllm']?.apiKey, '${MY_VLLM_API_KEY}');
  assert.equal(next.models?.providers?.['my-vllm']?.baseUrl, 'http://localhost:8000/v1');
  assert.deepEqual(
    next.models?.providers?.['my-vllm']?.models?.map((model: any) => model.id),
    ['model-a', 'model-b'],
  );
  assert.deepEqual(Object.keys(next.agents?.defaults?.models ?? {}), [
    'my-vllm/model-a',
    'my-vllm/model-b',
  ]);
  assert.equal(next.agents?.defaults?.model?.primary, 'my-vllm/model-a');
});

test('applyProviderAddition migrates case-drifted provider config instead of duplicating it', () => {
  const next = applyProviderAddition(
    {
      models: {
        providers: {
          'My-VLLM': {
            baseUrl: 'http://old.example/v1',
            apiKey: '${MY_VLLM_API_KEY}',
            models: [{ id: 'model-a', name: 'Model A' }],
          },
        },
      },
      env: {
        vars: {
          MY_VLLM_API_KEY: 'existing-secret',
        },
      },
      agents: {
        defaults: {
          models: {
            'my-vllm/model-a': { alias: 'Model A' },
          },
        },
      },
    } as any,
    'my-vllm:main',
    {
      provider: 'my-vllm',
      mode: 'api_key',
      profileName: 'Main',
    },
    ['model-a'],
    {
      baseUrl: 'http://new.example/v1',
      api: 'openai-chat',
    },
  );

  assert.equal(next.models?.providers?.['My-VLLM'], undefined);
  assert.equal(next.models?.providers?.['my-vllm']?.baseUrl, 'http://new.example/v1');
  assert.equal(next.models?.providers?.['my-vllm']?.apiKey, '${MY_VLLM_API_KEY}');
  assert.equal(next.env?.vars?.MY_VLLM_API_KEY, 'existing-secret');
});

test('applyProviderRemoval removes matching provider config, models, and orphan env refs', () => {
  const next = applyProviderRemoval(
    {
      auth: {
        profiles: {
          'my-vllm:main': { provider: 'my-vllm', mode: 'api_key' },
        },
      },
      models: {
        providers: {
          'My-VLLM': {
            apiKey: '${CUSTOM_VLLM_SECRET}',
            baseUrl: 'http://localhost:8000/v1',
          },
        },
      },
      env: {
        vars: {
          CUSTOM_VLLM_SECRET: 'secret',
          KEEP_ME: 'value',
        },
      },
      agents: {
        defaults: {
          models: {
            'my-vllm/model-a': { alias: 'Model A' },
            'openai/gpt-4o': { alias: 'GPT-4o' },
          },
          model: { primary: 'my-vllm/model-a' },
        },
      },
    } as any,
    'my-vllm',
    'my-vllm:main',
  );

  assert.deepEqual(next.auth?.profiles, {});
  assert.deepEqual(next.models?.providers, {});
  assert.equal(next.env?.vars?.CUSTOM_VLLM_SECRET, undefined);
  assert.equal(next.env?.vars?.KEEP_ME, 'value');
  assert.equal(next.agents?.defaults?.models?.['my-vllm/model-a'], undefined);
  assert.equal(next.agents?.defaults?.model?.primary, 'openai/gpt-4o');
});

test('applyProviderRemoval keeps shared env refs still used by another provider', () => {
  const next = applyProviderRemoval(
    {
      models: {
        providers: {
          first: { apiKey: '${SHARED_API_KEY}' },
          second: { apiKey: '${SHARED_API_KEY}' },
        },
      },
      env: {
        vars: {
          SHARED_API_KEY: 'secret',
        },
      },
      agents: {
        defaults: {
          models: {
            'first/model-a': {},
            'second/model-b': {},
          },
        },
      },
    } as any,
    'first',
  );

  assert.equal(next.models?.providers?.first, undefined);
  assert.equal(next.models?.providers?.second?.apiKey, '${SHARED_API_KEY}');
  assert.equal(next.env?.vars?.SHARED_API_KEY, 'secret');
  assert.equal(next.agents?.defaults?.models?.['first/model-a'], undefined);
  assert.ok(next.agents?.defaults?.models?.['second/model-b']);
});

test('applyProviderRemoval keeps provider resources when another auth profile still uses them', () => {
  const next = applyProviderRemoval(
    {
      auth: {
        profiles: {
          'openai:main': { provider: 'openai', mode: 'api_key' },
          'openai:backup': { provider: 'openai', mode: 'api_key' },
        },
      },
      models: {
        providers: {
          openai: {
            apiKey: '${OPENAI_API_KEY}',
            baseUrl: 'https://api.openai.com/v1',
          },
        },
      },
      env: {
        vars: {
          OPENAI_API_KEY: 'secret',
        },
      },
      agents: {
        defaults: {
          models: {
            'openai/gpt-4o': {},
          },
          model: { primary: 'openai/gpt-4o' },
        },
      },
    } as any,
    'openai',
    'openai:main',
  );

  assert.equal(next.auth?.profiles?.['openai:main'], undefined);
  assert.ok(next.auth?.profiles?.['openai:backup']);
  assert.equal(next.models?.providers?.openai?.baseUrl, 'https://api.openai.com/v1');
  assert.equal(next.env?.vars?.OPENAI_API_KEY, 'secret');
  assert.ok(next.agents?.defaults?.models?.['openai/gpt-4o']);
  assert.equal(next.agents?.defaults?.model?.primary, 'openai/gpt-4o');
});

test('BUG-MP-08 removing a profile also repairs official auth order', () => {
  const next = applyProviderRemoval({
    auth: {
      profiles: {
        'openai:a': { provider: 'openai', mode: 'api_key' },
        'openai:b': { provider: 'openai', mode: 'oauth' },
      },
      order: { openai: ['openai:a', 'openai:b'] },
    },
  }, 'openai', 'openai:a');
  assert.deepEqual(next.auth?.order?.openai, ['openai:b']);
});
