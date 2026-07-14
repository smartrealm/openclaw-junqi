import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractAvailableModelsFromConfig,
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
