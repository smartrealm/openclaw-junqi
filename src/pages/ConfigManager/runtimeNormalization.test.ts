import test from 'node:test';
import assert from 'node:assert/strict';
import type { GatewayRuntimeConfig } from './types';
import {
  normalizeAgentsForRuntime,
  normalizeModelsProvidersForRuntime,
} from './runtimeNormalization';
import { getModelPrimary } from './modelReference';

const generatedProviderCatalog = {
  qwen: [
    { id: 'qwen/qwen3.6-plus', supportsImage: true },
    { id: 'qwen/qwen3-coder-plus', supportsImage: false },
  ],
  openai: [
    { id: 'openai/gpt-4o', supportsImage: true },
  ],
  'kimi-coding': [
    { id: 'kimi-coding/k2p5', supportsImage: false },
  ],
};

function canonicalProviderId(providerId: string | undefined): string {
  const normalized = String(providerId ?? '').trim().toLowerCase();
  if (normalized === 'kimi-coding' || normalized === 'kimi-code' || normalized === 'kimi') return 'kimi-coding';
  return normalized;
}

function stripProviderPrefix(providerId: string, modelId: string | undefined): string {
  const trimmed = String(modelId ?? '').trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return trimmed;
  const head = trimmed.slice(0, slashIndex);
  if (canonicalProviderId(head) !== canonicalProviderId(providerId)) return trimmed;
  return trimmed.slice(slashIndex + 1);
}

function canonicalizeModelRef(modelRef: string | undefined): string | undefined {
  const trimmed = String(modelRef ?? '').trim();
  if (!trimmed) return undefined;
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return trimmed;
  const provider = canonicalProviderId(trimmed.slice(0, slashIndex));
  const model = trimmed.slice(slashIndex + 1).trim();
  return provider && model ? `${provider}/${model}` : trimmed;
}

test('normalizeModelsProvidersForRuntime preserves explicit known template provider models', () => {
  const providers = {
    qwen: {
      apiKey: 'secret',
      models: [
        { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus' },
      ],
    },
  };

  const normalized = normalizeModelsProvidersForRuntime({
    providers,
    agents: undefined,
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (providerId === 'qwen' ? { id: 'qwen' } : undefined),
  });

  assert.deepEqual(normalized, {
    qwen: {
      apiKey: 'secret',
      models: [
        {
          id: 'qwen3.6-plus',
          name: 'Qwen 3.6 Plus',
          input: ['text', 'image'],
        },
      ],
    },
  });
});

test('normalizeModelsProvidersForRuntime keeps explicit models for unknown template provider models', () => {
  const providers = {
    qwen: {
      models: [
        { id: 'qwen/custom-vision-preview', name: 'Custom Vision Preview' },
      ],
    },
  };

  const normalized = normalizeModelsProvidersForRuntime({
    providers,
    agents: undefined,
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (providerId === 'qwen' ? { id: 'qwen' } : undefined),
  });

  assert.deepEqual(normalized, {
    qwen: {
      models: [
        {
          id: 'custom-vision-preview',
          name: 'Custom Vision Preview',
          input: ['text'],
        },
      ],
    },
  });
});

test('normalizeModelsProvidersForRuntime preserves explicit models for custom-like providers', () => {
  const providers = {
    custom: {
      models: [
        { id: 'openai/gpt-4o', name: 'GPT-4o' },
      ],
    },
    vllm: {
      models: [
        { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus' },
      ],
    },
    ollama: {
      models: [
        { id: 'llama3.2-vision', name: 'Llama 3.2 Vision' },
      ],
    },
  };

  const normalized = normalizeModelsProvidersForRuntime({
    providers,
    agents: undefined,
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (
      providerId === 'custom' || providerId === 'vllm' || providerId === 'ollama'
        ? { id: providerId }
        : undefined
    ),
  });

  assert.deepEqual(normalized, {
    custom: {
      models: [
        { id: 'openai/gpt-4o', name: 'GPT-4o', input: ['text'] },
      ],
    },
    vllm: {
      models: [
        { id: 'qwen/qwen3.6-plus', name: 'Qwen 3.6 Plus', input: ['text'] },
      ],
    },
    ollama: {
      models: [
        { id: 'llama3.2-vision', name: 'Llama 3.2 Vision', input: ['text'] },
      ],
    },
  });
});

test('normalizeModelsProvidersForRuntime resolves Kimi Coding runtime alias and preserves its models', () => {
  const providers = {
    kimi: {
      apiKey: 'secret',
      models: [
        { id: 'kimi/k2p5', name: 'Kimi Coding K2.5' },
      ],
    },
  };

  const normalized = normalizeModelsProvidersForRuntime({
    providers,
    agents: undefined,
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (providerId === 'kimi-coding' ? { id: 'kimi-coding' } : undefined),
  });

  assert.deepEqual(normalized, {
    'kimi-coding': {
      apiKey: 'secret',
      models: [
        {
          id: 'k2p5',
          name: 'Kimi Coding K2.5',
          input: ['text'],
        },
      ],
    },
  });
});

test('normalizeModelsProvidersForRuntime preserves explicit image capability for custom-like providers', () => {
  const providers = {
    custom: {
      apiKey: '${OPENCLAW_CUSTOM_API_KEY}',
      models: [
        { id: 'local-vision', name: 'Local Vision', supportsImage: true },
      ],
    },
  };

  const normalized = normalizeModelsProvidersForRuntime({
    providers,
    agents: undefined,
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (providerId === 'custom' ? { id: 'custom' } : undefined),
  });

  assert.deepEqual(normalized, {
    custom: {
      apiKey: '${OPENCLAW_CUSTOM_API_KEY}',
      models: [
        { id: 'local-vision', name: 'Local Vision', input: ['text', 'image'] },
      ],
    },
  });
});

test('normalizeModelsProvidersForRuntime preserves schema fields and strips legacy capability metadata', () => {
  const normalized = normalizeModelsProvidersForRuntime({
    providers: {
      custom: {
        models: [
          {
            id: 'media-model',
            name: 'Media Model',
            input: ['audio', 'video'],
            contextWindow: 128_000,
            maxTokens: 8_192,
            compat: { supportsTools: true },
            supportsImage: false,
            modalities: { input: ['audio', 'video'] },
            architecture: { input_modalities: ['audio', 'video'] },
          },
        ],
      },
    },
    agents: undefined,
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (providerId === 'custom' ? { id: 'custom' } : undefined),
  });

  assert.deepEqual(normalized?.custom?.models, [
    {
      id: 'media-model',
      name: 'Media Model',
      input: ['audio', 'video'],
      contextWindow: 128_000,
      maxTokens: 8_192,
      compat: { supportsTools: true },
    },
  ]);
});

test('normalizeModelsProvidersForRuntime fills provider rows missing from enabled agent models', () => {
  const normalized = normalizeModelsProvidersForRuntime({
    providers: {
      qwen: {
        baseUrl: 'https://example.test/v1',
        models: [
          {
            id: 'qwen3.6-plus',
            name: 'Provider Name',
            contextWindow: 128_000,
            input: ['text', 'image'],
          },
        ],
      },
    },
    agents: {
      defaults: {
        models: {
          'qwen/qwen3.6-plus': { alias: 'Agent Alias' },
          'qwen/qwen3-coder-plus': { alias: 'Coder' },
          'openai/gpt-4o': { alias: 'Unrelated' },
        },
      },
    },
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: (providerId) => (providerId === 'qwen' ? { id: 'qwen' } : undefined),
  });

  assert.deepEqual(normalized?.qwen?.models, [
    {
      id: 'qwen3.6-plus',
      name: 'Provider Name',
      input: ['text', 'image'],
      contextWindow: 128_000,
    },
    {
      id: 'qwen3-coder-plus',
      name: 'Coder',
      input: ['text'],
    },
  ]);
});

test('BUG-MP-08 does not turn provider wildcard allowlists into provider model rows', () => {
  const normalized = normalizeModelsProvidersForRuntime({
    providers: { openai: { models: [] } },
    agents: { defaults: { models: { 'openai/*': {} } } },
    generatedProviderCatalog,
    canonicalProviderId,
    stripProviderPrefix,
    canonicalizeModelRef,
    getTemplateById: () => ({ id: 'openai' }),
  });
  assert.deepEqual(normalized?.openai?.models, []);
});

test('normalizeAgentsForRuntime normalizes structured model refs without changing image selection', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      model: { primary: 'qwen/qwen3-coder-plus' },
      imageModel: { primary: 'qwen/qwen3.6-plus' },
    },
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers: undefined,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.equal(getModelPrimary(normalized?.defaults?.model), 'qwen/qwen3-coder-plus');
  assert.equal(getModelPrimary(normalized?.defaults?.imageModel), 'qwen/qwen3.6-plus');
});

test('normalizeAgentsForRuntime preserves an explicit image model when static metadata disagrees', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      model: { primary: 'openai/gpt-4o' },
      imageModel: { primary: 'qwen/qwen3-coder-plus' },
    },
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers: undefined,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.equal(getModelPrimary(normalized?.defaults?.imageModel), 'qwen/qwen3-coder-plus');
});

test('normalizeAgentsForRuntime never clears an explicit image model during generic save normalization', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      model: { primary: 'qwen/qwen3-coder-plus' },
      imageModel: { primary: 'qwen/qwen3-coder-plus' },
    },
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers: undefined,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.equal(getModelPrimary(normalized?.defaults?.imageModel), 'qwen/qwen3-coder-plus');
});

test('normalizeAgentsForRuntime keeps explicit image model for custom provider when config declares image support', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      model: { primary: 'custom/local-vision' },
      imageModel: { primary: 'custom/local-vision' },
    },
  };
  const providers = {
    custom: {
      models: [
        { id: 'local-vision', supportsImage: true },
      ],
    },
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.equal(getModelPrimary(normalized?.defaults?.imageModel), 'custom/local-vision');
});

test('normalizeAgentsForRuntime strips UI-only agent model metadata before writing config', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      models: {
        'qwen/qwen3.6-plus': {
          alias: 'Qwen 3.6 Plus',
          supportsImage: true,
          input: ['text', 'image'],
          params: { temperature: 0.3 },
          streaming: true,
        },
      },
      model: { primary: 'qwen/qwen3.6-plus' },
      imageModel: { primary: 'qwen/qwen3.6-plus' },
    },
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers: undefined,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.deepEqual(normalized?.defaults?.models, {
    'qwen/qwen3.6-plus': {
      alias: 'Qwen 3.6 Plus',
      params: { temperature: 0.3 },
      streaming: true,
    },
  });
});

test('normalizeAgentsForRuntime preserves an unknown custom image model', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      model: { primary: 'custom/local-text' },
      imageModel: { primary: 'custom/local-vision' },
    },
  };
  const providers = {
    custom: {
      models: [
        { id: 'local-text' },
        { id: 'local-vision' },
      ],
    },
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.equal(getModelPrimary(normalized?.defaults?.imageModel), 'custom/local-vision');
});

test('normalizeAgentsForRuntime preserves valid compact string model forms', () => {
  const normalized = normalizeAgentsForRuntime({
    agents: {
      defaults: {
        model: 'custom/text',
        imageModel: 'custom/vision',
        imageGenerationModel: 'custom/image-gen',
        videoGenerationModel: 'custom/video-gen',
      },
    },
    providers: undefined,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.equal(normalized?.defaults?.model, 'custom/text');
  assert.equal(normalized?.defaults?.imageModel, 'custom/vision');
  assert.equal(normalized?.defaults?.imageGenerationModel, 'custom/image-gen');
  assert.equal(normalized?.defaults?.videoGenerationModel, 'custom/video-gen');
});

test('normalizeAgentsForRuntime injects main agent when agents.list misses it', () => {
  const agents: GatewayRuntimeConfig['agents'] = {
    defaults: {
      model: { primary: 'qwen/qwen3.6-plus' },
    },
    list: [
      { id: 'investment', name: 'Investment Agent' },
    ],
  };

  const normalized = normalizeAgentsForRuntime({
    agents,
    providers: undefined,
    generatedProviderCatalog,
    canonicalizeModelRef,
  });

  assert.deepEqual(normalized?.list?.map((agent) => agent.id), ['main', 'investment']);
});
