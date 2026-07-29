import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFetchedModelAdditionsToDefaults,
  buildDefaultsWithResolvedModels,
  buildFetchedModelAdditions,
} from './providerDefaults';
import { getModelPrimary } from './modelReference';

test('buildDefaultsWithResolvedModels preserves an explicit primary outside local metadata', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      model: {
        primary: 'openai/removed',
        fallbacks: ['openai/missing', 'openai/gpt-4o', 'qwen/qwen3.6-plus'],
      },
      models: {
        'openai/removed': {},
      },
    },
    models: {
      'qwen/qwen3.6-plus': {},
      'openai/gpt-4o': {},
    },
  });

  assert.equal(getModelPrimary(defaults.model), 'openai/removed');
  assert.deepEqual(
    typeof defaults.model === 'object' ? defaults.model.fallbacks : undefined,
    ['openai/missing', 'openai/gpt-4o', 'qwen/qwen3.6-plus'],
  );
});

test('buildDefaultsWithResolvedModels keeps an absent primary unset when catalog entries appear', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {},
    models: {
      'qwen/qwen3.6-plus': {},
      'openai/gpt-4o': {},
    },
  });

  assert.equal(defaults.model, undefined);
  assert.equal(defaults.imageModel, undefined);
});

test('buildDefaultsWithResolvedModels distinguishes explicit clear from an omitted override', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      model: { primary: 'openai/gpt-4o', fallbacks: ['qwen/qwen3.6-plus'] },
      imageModel: { primary: 'openai/gpt-4o' },
    },
    models: {
      'qwen/qwen3.6-plus': {},
      'openai/gpt-4o': { supportsImage: true, input: ['text', 'image'] },
    },
    primary: null,
    imagePrimary: null,
  });

  assert.equal(getModelPrimary(defaults.model), undefined);
  assert.deepEqual(
    typeof defaults.model === 'object' ? defaults.model.fallbacks : undefined,
    ['qwen/qwen3.6-plus'],
  );
  assert.equal(defaults.imageModel, undefined);
});

test('buildDefaultsWithResolvedModels clears invalid image primary without leaving an empty object', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      imageModel: { primary: 'qwen/text-only' },
    },
    models: {
      'qwen/text-only': { supportsImage: false, input: ['text'] },
    },
  });

  assert.equal(defaults.imageModel, undefined);
});

test('buildDefaultsWithResolvedModels preserves an explicit image model outside the local catalog', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      imageModel: { primary: 'openai/removed' },
    },
    models: {
      'qwen/text-only': { supportsImage: false, input: ['text'] },
      'openai/gpt-4o': { supportsImage: true, input: ['text', 'image'] },
    },
  });

  assert.equal(getModelPrimary(defaults.imageModel), 'openai/removed');
});

test('buildDefaultsWithResolvedModels recognizes provider metadata without choosing an image default', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {},
    models: {
      'custom/text-only': { modalities: { input: ['text'] } } as any,
      'custom/vision': { architecture: { input_modalities: ['text', 'image'] } } as any,
    },
  });

  assert.equal(getModelPrimary(defaults.imageModel), undefined);
});

test('omitted reconciliation preserves explicit text and image models outside the local catalog', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      model: { primary: 'openai/removed' },
      imageModel: { primary: 'openai/removed' },
    },
    models: {},
  });

  assert.equal(getModelPrimary(defaults.model), 'openai/removed');
  assert.equal(getModelPrimary(defaults.imageModel), 'openai/removed');
});

test('buildFetchedModelAdditions skips existing models and duplicate fetched ids', () => {
  const additions = buildFetchedModelAdditions({
    providerId: 'qwen',
    existingModels: {
      'qwen/qwen3.6-plus': { alias: 'existing' },
    },
    fetchedModels: [
      { id: 'qwen3.6-plus', alias: 'duplicate' },
      { id: 'qwen3.6-coder', alias: 'coder' },
      { id: 'qwen/qwen3.6-coder', alias: 'coder again' },
    ],
  });

  assert.deepEqual(additions, [
    { fullRef: 'qwen/qwen3.6-coder', alias: 'coder', supportsImage: undefined },
  ]);
});

test('applyFetchedModelAdditionsToDefaults preserves fetched capabilities without replacing an explicit image model', () => {
  const defaults = applyFetchedModelAdditionsToDefaults({
    defaults: {
      model: { primary: 'openai/removed' },
      imageModel: { primary: 'openai/removed' },
      models: {
        'qwen/text-only': { alias: 'text', supportsImage: false, input: ['text'] },
      },
    },
    additions: [
      { fullRef: 'qwen/vision', alias: 'vision', supportsImage: true },
    ],
  });

  assert.equal(defaults.models?.['qwen/vision']?.alias, 'vision');
  assert.equal(defaults.models?.['qwen/vision']?.supportsImage, true);
  assert.deepEqual(defaults.models?.['qwen/vision']?.input, ['text', 'image']);
  assert.equal(getModelPrimary(defaults.model), 'openai/removed');
  assert.equal(getModelPrimary(defaults.imageModel), 'openai/removed');
});

test('applyFetchedModelAdditionsToDefaults does not turn fetched catalog order into a default', () => {
  const defaults = applyFetchedModelAdditionsToDefaults({
    defaults: {},
    additions: [
      { fullRef: 'qwen/text', alias: 'text', supportsImage: false },
      { fullRef: 'qwen/vision', alias: 'vision', supportsImage: true },
    ],
  });

  assert.equal(defaults.model, undefined);
  assert.equal(defaults.imageModel, undefined);
});
