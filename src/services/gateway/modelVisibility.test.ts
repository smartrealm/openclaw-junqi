import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectInstalledModelVisibility,
  installedSyntheticVisibleModelRefs,
  isModelVisibleForInstalledRuntime,
} from './modelVisibility';

test('pinned runtime keeps explicit primary and fallbacks visible with exact entries', () => {
  const visibility = inspectInstalledModelVisibility({
    agents: {
      defaults: {
        model: {
          primary: 'openai/gpt-5.6',
          fallbacks: ['anthropic/claude-sonnet-4-6'],
        },
        models: { 'qwen/qwen3.6-plus': {} },
      },
    },
  });

  assert.equal(isModelVisibleForInstalledRuntime('openai/gpt-5.6', visibility), true);
  assert.equal(isModelVisibleForInstalledRuntime('anthropic/claude-sonnet-4-6', visibility), true);
  assert.equal(isModelVisibleForInstalledRuntime('google/gemini-2.5-pro', visibility), false);
  assert.deepEqual(installedSyntheticVisibleModelRefs(visibility), [
    'qwen/qwen3.6-plus',
    'anthropic/claude-sonnet-4-6',
    'openai/gpt-5.6',
  ]);
});

test('provider wildcards expose only their provider and do not rescue another primary', () => {
  const visibility = inspectInstalledModelVisibility({
    agents: {
      defaults: {
        model: { primary: 'openai/gpt-5.6' },
        models: { 'qwen/*': {} },
      },
    },
  });

  assert.equal(isModelVisibleForInstalledRuntime('qwen/qwen3.6-plus', visibility), true);
  assert.equal(isModelVisibleForInstalledRuntime('openai/gpt-5.6', visibility), false);
  assert.deepEqual(installedSyntheticVisibleModelRefs(visibility), []);
});

test('an empty configured model map leaves catalog visibility unrestricted', () => {
  const visibility = inspectInstalledModelVisibility({ agents: { defaults: { models: {} } } });
  assert.equal(visibility.hasEntries, false);
  assert.equal(isModelVisibleForInstalledRuntime('custom/anything', visibility), true);
});
