import test from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayRuntimeConfig, ModelConfig } from './types';
import {
  addProviderModel,
  buildEditableProviderModels,
  removeProviderModel,
  updateProviderModel,
} from './providerModelMutations';
import { getModelFallbacks, getModelPrimary } from './modelReference';

function assertModelConfigOmits(config: ModelConfig | string | undefined, modelRef: string): void {
  if (typeof config === 'string') {
    assert.notEqual(config, modelRef);
    return;
  }
  assert.notEqual(config?.primary, modelRef);
  assert.equal(config?.fallbacks?.includes(modelRef) ?? false, false);
}

test('addProviderModel keeps provider declarations and agent defaults in sync', () => {
  const next = addProviderModel({
    config: {
      models: {
        providers: {
          openai: {
            baseUrl: 'https://api.openai.com/v1',
            models: [],
          },
        },
      },
    },
    providerId: 'openai',
    modelId: 'gpt-4o',
    alias: 'Vision',
    supportsImage: true,
  });

  assert.equal(next.models?.providers?.openai?.baseUrl, 'https://api.openai.com/v1');
  assert.deepEqual(next.models?.providers?.openai?.models, [
    {
      id: 'gpt-4o',
      name: 'gpt-4o',
      input: ['text', 'image'],
    },
  ]);
  assert.deepEqual(next.agents?.defaults?.models?.['openai/gpt-4o'], {
    alias: 'Vision',
    supportsImage: true,
    input: ['text', 'image'],
  });
  assert.equal(getModelPrimary(next.agents?.defaults?.model), 'openai/gpt-4o');
  assert.equal(getModelPrimary(next.agents?.defaults?.imageModel), 'openai/gpt-4o');
});

test('buildEditableProviderModels includes provider-only rows without overriding agent metadata', () => {
  const models = buildEditableProviderModels(
    'modelstudio',
    {
      'qwen/enabled': { alias: 'Agent alias', supportsImage: false, input: ['text'] },
      'openai/unrelated': { alias: 'Other' },
    },
    {
      models: [
        { id: 'enabled', name: 'Provider Name', input: ['text', 'image'] },
        { id: 'provider-only', name: 'Provider Only', input: ['text', 'image'] },
      ],
    },
  );

  assert.deepEqual(Object.keys(models), ['qwen/enabled', 'qwen/provider-only']);
  assert.deepEqual(models['qwen/enabled'], {
    alias: 'Agent alias',
    supportsImage: false,
    input: ['text'],
  });
  assert.deepEqual(models['qwen/provider-only'], {
    alias: 'Provider Only',
    supportsImage: true,
    input: ['text', 'image'],
  });
});

test('updateProviderModel synchronizes alias and image capability', () => {
  const next = updateProviderModel({
    config: {
      models: {
        providers: {
          openai: {
            models: [{ id: 'gpt-4o', name: 'GPT-4o', input: ['text'] }],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            'openai/gpt-4o': {
              alias: 'Old alias',
              supportsImage: false,
              input: ['text'],
            },
          },
          model: { primary: 'openai/gpt-4o' },
        },
      },
    },
    providerId: 'openai',
    modelRef: 'openai/gpt-4o',
    alias: 'New alias',
    supportsImage: true,
  });

  assert.deepEqual(next.models?.providers?.openai?.models, [
    { id: 'gpt-4o', name: 'GPT-4o', input: ['text', 'image'] },
  ]);
  assert.deepEqual(next.agents?.defaults?.models?.['openai/gpt-4o'], {
    alias: 'New alias',
    supportsImage: true,
    input: ['text', 'image'],
  });
});

test('provider aliases migrate to canonical refs without creating duplicates', () => {
  const cases = [
    {
      providerId: 'modelstudio',
      existingProviderKey: 'modelstudio',
      canonicalProvider: 'qwen',
      modelRef: 'qwen/qwen3.6-plus',
      rawModelId: 'qwen3.6-plus',
    },
    {
      providerId: 'z.ai',
      existingProviderKey: 'z.ai',
      canonicalProvider: 'zai',
      modelRef: 'zai/glm-5',
      rawModelId: 'glm-5',
    },
  ];

  for (const entry of cases) {
    const next = updateProviderModel({
      config: {
        models: {
          providers: {
            [entry.existingProviderKey]: {
              models: [{ id: entry.rawModelId, name: entry.rawModelId, input: ['text'] }],
            },
          },
        },
        agents: {
          defaults: {
            models: {
              [entry.modelRef]: { alias: 'Old alias', supportsImage: false, input: ['text'] },
            },
            model: { primary: entry.modelRef },
          },
        },
      },
      providerId: entry.providerId,
      modelRef: entry.modelRef,
      alias: 'Canonical alias',
      supportsImage: true,
    });

    assert.deepEqual(Object.keys(next.models?.providers ?? {}), [entry.canonicalProvider]);
    assert.deepEqual(Object.keys(next.agents?.defaults?.models ?? {}), [entry.modelRef]);
    assert.equal(next.agents?.defaults?.models?.[entry.modelRef]?.alias, 'Canonical alias');
    assert.deepEqual(next.models?.providers?.[entry.canonicalProvider]?.models?.[0]?.input, ['text', 'image']);
  }
});

test('provider alias migration merges equivalent agent model metadata', () => {
  const next = updateProviderModel({
    config: {
      agents: {
        defaults: {
          models: {
            'modelstudio/qwen3.6-plus': {
              alias: 'Legacy alias',
              params: { temperature: 0.2 },
              streaming: true,
            },
            'qwen/qwen3.6-plus': {
              alias: 'Canonical alias',
            },
          },
          model: { primary: 'modelstudio/qwen3.6-plus' },
        },
      },
    },
    providerId: 'modelstudio',
    modelRef: 'qwen/qwen3.6-plus',
    alias: 'Updated alias',
  });

  assert.deepEqual(Object.keys(next.agents?.defaults?.models ?? {}), ['qwen/qwen3.6-plus']);
  assert.deepEqual(next.agents?.defaults?.models?.['qwen/qwen3.6-plus'], {
    alias: 'Updated alias',
    params: { temperature: 0.2 },
    streaming: true,
  });
  assert.equal(getModelPrimary(next.agents?.defaults?.model), 'qwen/qwen3.6-plus');
});

test('provider alias migration merges canonical and legacy provider configs without data loss', () => {
  const next = updateProviderModel({
    config: {
      models: {
        providers: {
          modelstudio: {
            api: 'openai-completions',
            baseUrl: 'https://legacy.example/v1',
            request: { allowPrivateNetwork: true },
            models: [{ id: 'legacy-only', name: 'Legacy Only', input: ['text'] }],
          },
          qwen: {
            apiKey: '${MODELSTUDIO_API_KEY}',
            baseUrl: 'https://canonical.example/v1',
            models: [{ id: 'canonical-only', name: 'Canonical Only', input: ['text'] }],
          },
        },
      },
      agents: {
        defaults: {
          models: { 'qwen/canonical-only': {} },
        },
      },
    },
    providerId: 'modelstudio',
    modelRef: 'qwen/canonical-only',
    supportsImage: true,
  });

  assert.deepEqual(Object.keys(next.models?.providers ?? {}), ['qwen']);
  assert.equal(next.models?.providers?.qwen?.api, 'openai-completions');
  assert.equal(next.models?.providers?.qwen?.apiKey, '${MODELSTUDIO_API_KEY}');
  assert.equal(next.models?.providers?.qwen?.baseUrl, 'https://canonical.example/v1');
  assert.deepEqual(next.models?.providers?.qwen?.request, { allowPrivateNetwork: true });
  assert.deepEqual(
    next.models?.providers?.qwen?.models?.map((model) => model.id),
    ['legacy-only', 'canonical-only'],
  );
});

test('removeProviderModel removes a model across canonical and legacy provider keys', () => {
  const next = removeProviderModel({
    config: {
      models: {
        providers: {
          modelstudio: {
            api: 'openai-completions',
            models: [
              { id: 'remove-me', name: 'Legacy Remove', input: ['text'] },
              { id: 'legacy-only', name: 'Legacy Only', input: ['text'] },
            ],
          },
          qwen: {
            baseUrl: 'https://canonical.example/v1',
            models: [
              { id: 'remove-me', name: 'Canonical Remove', input: ['text'] },
              { id: 'canonical-only', name: 'Canonical Only', input: ['text'] },
            ],
          },
        },
      },
      agents: {
        defaults: {
          models: { 'qwen/remove-me': {}, 'qwen/canonical-only': {} },
          model: { primary: 'qwen/remove-me' },
        },
      },
    },
    providerId: 'modelstudio',
    modelRef: 'qwen/remove-me',
  });

  assert.deepEqual(Object.keys(next.models?.providers ?? {}), ['qwen']);
  assert.equal(next.models?.providers?.qwen?.api, 'openai-completions');
  assert.equal(next.models?.providers?.qwen?.baseUrl, 'https://canonical.example/v1');
  assert.deepEqual(
    next.models?.providers?.qwen?.models?.map((model) => model.id),
    ['legacy-only', 'canonical-only'],
  );
  assert.equal(next.agents?.defaults?.models?.['qwen/remove-me'], undefined);
  assert.equal(getModelPrimary(next.agents?.defaults?.model), 'qwen/canonical-only');
});

test('removeProviderModel clears provider models and every default and agent reference', () => {
  const removed = 'openai/remove-me';
  const kept = 'openai/keep-me';
  const next = removeProviderModel({
    config: {
      models: {
        providers: {
          openai: {
            models: [
              { id: 'remove-me', name: 'Remove Me', input: ['text', 'image'] },
              { id: 'keep-me', name: 'Keep Me', input: ['text', 'image'] },
            ],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            [removed]: { alias: 'Remove', supportsImage: true, input: ['text', 'image'] },
            [kept]: { alias: 'Keep', supportsImage: true, input: ['text', 'image'] },
          },
          model: { primary: removed, fallbacks: [removed, kept] },
          imageModel: { primary: removed, fallbacks: [removed, kept] },
          imageGenerationModel: { primary: removed, fallbacks: [removed, kept] },
          videoGenerationModel: { primary: removed, fallbacks: [removed, kept] },
        },
        list: [
          {
            id: 'main',
            model: { primary: removed, fallbacks: [removed, kept] },
            imageModel: { primary: removed, fallbacks: [removed, kept] },
            imageGenerationModel: { primary: removed, fallbacks: [removed, kept] },
            videoGenerationModel: { primary: removed, fallbacks: [removed, kept] },
          },
          {
            id: 'worker',
            model: removed,
            imageModel: removed,
            imageGenerationModel: removed,
            videoGenerationModel: removed,
          } as any,
        ],
      },
    } as GatewayRuntimeConfig,
    providerId: 'openai',
    modelRef: removed,
  });

  assert.deepEqual(next.models?.providers?.openai?.models?.map((model) => model.id), ['keep-me']);
  assert.equal(next.agents?.defaults?.models?.[removed], undefined);
  assert.ok(next.agents?.defaults?.models?.[kept]);
  assert.equal(getModelPrimary(next.agents?.defaults?.model), kept);
  assert.equal(getModelPrimary(next.agents?.defaults?.imageModel), kept);

  assertModelConfigOmits(next.agents?.defaults?.model, removed);
  assertModelConfigOmits(next.agents?.defaults?.imageModel, removed);
  assertModelConfigOmits(next.agents?.defaults?.imageGenerationModel, removed);
  assertModelConfigOmits(next.agents?.defaults?.videoGenerationModel, removed);
  for (const agent of next.agents?.list ?? []) {
    assertModelConfigOmits(agent.model, removed);
    assertModelConfigOmits(agent.imageModel, removed);
    assertModelConfigOmits(agent.imageGenerationModel, removed);
    assertModelConfigOmits(agent.videoGenerationModel, removed);
  }
});

test('disabling the current image model falls back to another image-capable model', () => {
  const next = updateProviderModel({
    config: {
      models: {
        providers: {
          openai: {
            models: [
              { id: 'vision-a', name: 'Vision A', input: ['text', 'image'] },
              { id: 'vision-b', name: 'Vision B', input: ['text', 'image'] },
            ],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            'openai/vision-a': { supportsImage: true, input: ['text', 'image'] },
            'openai/vision-b': { supportsImage: true, input: ['text', 'image'] },
          },
          model: { primary: 'openai/vision-a' },
          imageModel: { primary: 'openai/vision-a' },
        },
      },
    },
    providerId: 'openai',
    modelRef: 'openai/vision-a',
    supportsImage: false,
  });

  assert.equal(getModelPrimary(next.agents?.defaults?.imageModel), 'openai/vision-b');
});

test('disabling image support also rewrites per-agent image model references', () => {
  const next = updateProviderModel({
    config: {
      agents: {
        defaults: {
          models: {
            'custom/vision-a': { supportsImage: true, input: ['text', 'image'] },
            'custom/vision-b': { supportsImage: true, input: ['text', 'image'] },
          },
          model: { primary: 'custom/vision-a' },
          imageModel: { primary: 'custom/vision-a' },
        },
        list: [
          { id: 'main', imageModel: { primary: 'custom/vision-a', fallbacks: ['custom/vision-a'] } },
          { id: 'worker', imageModel: { primary: 'custom/vision-a' } },
        ],
      },
    },
    providerId: 'custom',
    modelRef: 'custom/vision-a',
    supportsImage: false,
  });

  assert.equal(getModelPrimary(next.agents?.defaults?.imageModel), 'custom/vision-b');
  for (const agent of next.agents?.list ?? []) {
    assert.equal(getModelPrimary(agent.imageModel), 'custom/vision-b');
    assert.equal(getModelFallbacks(agent.imageModel).includes('custom/vision-a'), false);
  }
});

test('disabling the only image-capable model clears image primary', () => {
  const next = updateProviderModel({
    config: {
      models: {
        providers: {
          openai: {
            models: [{ id: 'vision', name: 'Vision', input: ['text', 'image'] }],
          },
        },
      },
      agents: {
        defaults: {
          models: {
            'openai/vision': { supportsImage: true, input: ['text', 'image'] },
          },
          model: { primary: 'openai/vision' },
          imageModel: { primary: 'openai/vision' },
        },
      },
    },
    providerId: 'openai',
    modelRef: 'openai/vision',
    supportsImage: false,
  });

  assert.equal(next.agents?.defaults?.imageModel, undefined);
});

test('BUG-MP-06 writes advanced fields only to the provider model definition', () => {
  const next = updateProviderModel({
    config: {
      models: { providers: { openai: { models: [{ id: 'gpt-5.6', name: 'GPT-5.6' }] } } },
      agents: { defaults: { models: { 'openai/gpt-5.6': { alias: 'gpt' } } } },
    },
    providerId: 'openai',
    modelRef: 'openai/gpt-5.6',
    providerPatch: {
      id: 'gpt-5.6',
      name: 'GPT-5.6',
      reasoning: true,
      contextWindow: 1_000_000,
      compat: { supportsTools: true },
    },
  });
  assert.equal(next.models?.providers?.openai.models?.[0]?.reasoning, true);
  assert.equal(next.models?.providers?.openai.models?.[0]?.contextWindow, 1_000_000);
  assert.deepEqual(next.models?.providers?.openai.models?.[0]?.compat, { supportsTools: true });
  assert.deepEqual(next.agents?.defaults?.models?.['openai/gpt-5.6'], { alias: 'gpt' });
});
