import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAvailableModelsFromConfig,
  extractAvailableModelsFromGatewayResult,
  hasConfiguredModelProviders,
} from './modelCatalog';

test('extractAvailableModelsFromConfig reads explicit agent default models first', () => {
  const models = extractAvailableModelsFromConfig({
    agents: {
      defaults: {
        models: {
          'openai/gpt-4o': { alias: 'fast' },
        },
      },
    },
  });

  assert.deepEqual(models, [
    { id: 'openai/gpt-4o', label: 'openai/gpt-4o', alias: 'fast' },
  ]);
});

test('extractAvailableModelsFromConfig reads provider explicit models and scopes bare ids', () => {
  const models = extractAvailableModelsFromConfig({
    models: {
      providers: {
        qwen: {
          models: [
            { id: 'qwen3.6-plus', name: 'Qwen Plus' },
            { id: 'qwen/qwen3-coder-plus' },
          ],
        },
      },
    },
  });

  assert.equal(models[0]?.id, 'qwen/qwen3.6-plus');
  assert.equal(models[0]?.label, 'Qwen Plus');
  assert.ok(models.some((model) => model.id === 'qwen/qwen3-coder-plus'));
});

test('explicit custom provider keys retain ownership of their model refs', () => {
  const models = extractAvailableModelsFromConfig({
    models: {
      providers: {
        modelstudio: {
          api: 'openai-completions',
          models: [{ id: 'private-model', name: 'Private model' }],
        },
      },
    },
  });

  assert.deepEqual(models, [{
    id: 'modelstudio/private-model',
    label: 'Private model',
  }]);
});

test('extractAvailableModelsFromConfig fills template provider models from generated catalog when runtime models are empty', () => {
  const models = extractAvailableModelsFromConfig({
    models: {
      providers: {
        openai: { models: [] },
      },
    },
  });

  assert.ok(models.some((model) => model.id === 'openai/gpt-5.6'));
  assert.ok(models.some((model) => model.id === 'openai/gpt-5.6-sol'));
  assert.equal(models.find((model) => model.id === 'openai/gpt-5.6')?.supportsImage, true);
});

test('extractAvailableModelsFromConfig preserves provider model image capability metadata', () => {
  const models = extractAvailableModelsFromConfig({
    models: {
      providers: {
        custom: {
          models: [
            { id: 'local-vision', input: ['text', 'image'] },
            { id: 'local-text', input: ['text'] },
            { id: 'modalities-vision', modalities: { input: ['text', 'image'] } },
            { id: 'architecture-vision', architecture: { input_modalities: ['text', 'image'] } },
          ],
        },
      },
    },
  });

  assert.equal(models.find((model) => model.id === 'custom/local-vision')?.supportsImage, true);
  assert.equal(models.find((model) => model.id === 'custom/local-text')?.supportsImage, false);
  assert.equal(models.find((model) => model.id === 'custom/modalities-vision')?.supportsImage, true);
  assert.equal(models.find((model) => model.id === 'custom/architecture-vision')?.supportsImage, true);
});

test('extractAvailableModelsFromConfig preserves explicit aliases over generated catalog aliases', () => {
  const models = extractAvailableModelsFromConfig({
    agents: {
      defaults: {
        models: {
          'openai/gpt-4o': { alias: 'mine' },
        },
      },
    },
    models: {
      providers: {
        openai: { models: [] },
      },
    },
  });

  assert.equal(models.find((model) => model.id === 'openai/gpt-4o')?.alias, 'mine');
});

test('hasConfiguredModelProviders detects auth profile provider aliases', () => {
  assert.equal(hasConfiguredModelProviders({
    auth: {
      profiles: {
        'modelstudio:main': { mode: 'api_key' },
      },
    },
  }), true);
});

test('replace mode exposes only explicit provider model declarations', () => {
  const models = extractAvailableModelsFromConfig({
    agents: {
      defaults: {
        models: {
          'openai/gpt-4o': { alias: 'fast' },
        },
      },
    },
    models: {
      mode: 'replace',
      providers: {
        openai: {
          models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
        },
      },
    },
  });

  assert.deepEqual(models, [
    { id: 'openai/gpt-4o', label: 'GPT-4o', alias: 'fast' },
  ]);
  assert.equal(models.some((model) => model.id === 'openai/gpt-5.6'), false);
});

test('pinned configured-model visibility filters provider rows and preserves explicit routing', () => {
  const models = extractAvailableModelsFromConfig({
    agents: {
      defaults: {
        model: {
          primary: 'openai/gpt-5.6',
          fallbacks: ['anthropic/claude-sonnet-4-6'],
        },
        models: {
          'qwen/qwen3.6-plus': { alias: 'preferred' },
        },
      },
    },
    models: {
      mode: 'replace',
      providers: {
        openai: { models: [{ id: 'gpt-4o' }] },
        qwen: { models: [{ id: 'qwen3.6-plus' }] },
        anthropic: { models: [{ id: 'claude-sonnet-4-6' }] },
      },
    },
  });

  assert.deepEqual(models.map((model) => model.id), [
    'qwen/qwen3.6-plus',
    'anthropic/claude-sonnet-4-6',
    'openai/gpt-5.6',
  ]);
});

test('provider wildcard visibility keeps only matching configured provider rows', () => {
  const models = extractAvailableModelsFromConfig({
    agents: { defaults: { models: { 'qwen/*': {} } } },
    models: {
      mode: 'replace',
      providers: {
        openai: { models: [{ id: 'gpt-4o' }] },
        qwen: { models: [{ id: 'qwen3.6-plus' }] },
      },
    },
  });

  assert.deepEqual(models.map((model) => model.id), ['qwen/qwen3.6-plus']);
});

test('gateway models.list parser keeps only available runtime models and scopes provider ids', () => {
  const models = extractAvailableModelsFromGatewayResult({
    models: [
      { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', alias: 'fast', input: ['text', 'image'] },
      { provider: 'qwen', id: 'qwen3.6-plus', available: false },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' },
    ],
  });

  assert.deepEqual(models, [
    { id: 'openai/gpt-4o', label: 'GPT-4o', alias: 'fast', supportsImage: true },
    { id: 'anthropic/claude-sonnet-4-6', label: 'Sonnet' },
  ]);
});
