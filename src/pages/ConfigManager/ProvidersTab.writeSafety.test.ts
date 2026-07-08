import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyFetchedModelAdditionsToDefaults,
  buildDefaultsWithResolvedModels,
  buildFetchedModelAdditions,
} from './providerDefaults';

test('buildDefaultsWithResolvedModels falls back when primary model was removed', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      model: { primary: 'openai/removed' },
      models: {
        'openai/removed': {},
      },
    },
    models: {
      'qwen/qwen3.6-plus': {},
      'openai/gpt-4o': {},
    },
  });

  assert.equal(defaults.model?.primary, 'qwen/qwen3.6-plus');
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

test('buildDefaultsWithResolvedModels picks first image-capable model when current image primary is gone', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      imageModel: { primary: 'openai/removed' },
    },
    models: {
      'qwen/text-only': { supportsImage: false, input: ['text'] },
      'openai/gpt-4o': { supportsImage: true, input: ['text', 'image'] },
    },
  });

  assert.equal(defaults.imageModel?.primary, 'openai/gpt-4o');
});

test('buildDefaultsWithResolvedModels recognizes provider metadata image modalities', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {},
    models: {
      'custom/text-only': { modalities: { input: ['text'] } } as any,
      'custom/vision': { architecture: { input_modalities: ['text', 'image'] } } as any,
    },
  });

  assert.equal(defaults.imageModel?.primary, 'custom/vision');
});

test('buildDefaultsWithResolvedModels removes primary configs when no models remain', () => {
  const defaults = buildDefaultsWithResolvedModels({
    defaults: {
      model: { primary: 'openai/removed' },
      imageModel: { primary: 'openai/removed' },
    },
    models: {},
  });

  assert.equal(defaults.model, undefined);
  assert.equal(defaults.imageModel, undefined);
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

test('applyFetchedModelAdditionsToDefaults preserves fetched model capabilities and resolves defaults', () => {
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
  assert.equal(defaults.model?.primary, 'qwen/text-only');
  assert.equal(defaults.imageModel?.primary, 'qwen/vision');
});
