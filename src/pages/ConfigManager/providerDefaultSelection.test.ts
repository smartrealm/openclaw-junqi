import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDefaultModelOptions,
  resolveExplicitProviderDefault,
} from './providerDefaultSelection';

test('provider setup changes a default only after an explicit valid selection', () => {
  const models = ['openai/gpt-5.6', 'openai/gpt-5.6-sol'];
  assert.equal(resolveExplicitProviderDefault(models, ''), undefined);
  assert.equal(resolveExplicitProviderDefault(models, 'openai/missing'), undefined);
  assert.equal(resolveExplicitProviderDefault(models, 'openai/gpt-5.6-sol'), 'openai/gpt-5.6-sol');
});

test('an explicit default remains selectable when live catalog metadata is unavailable', () => {
  const models = { 'openai/gpt-5.6': { alias: 'Primary' } };
  assert.deepEqual(
    buildDefaultModelOptions(models, 'custom/offline-model'),
    [
      ['custom/offline-model', undefined],
      ['openai/gpt-5.6', { alias: 'Primary' }],
    ],
  );
  assert.equal(buildDefaultModelOptions(models, 'openai/gpt-5.6').length, 1);
});
