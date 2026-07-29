import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getModelFallbacks,
  getModelPrimary,
  normalizeModelReferenceConfig,
  rewriteModelReferenceConfig,
  setModelFallbacks,
  setModelPrimary,
} from './modelReference';

test('model references preserve compact strings until a structured edit is required', () => {
  assert.equal(
    normalizeModelReferenceConfig(' openai/gpt-4o ', (value) => value?.trim()),
    'openai/gpt-4o',
  );
  assert.deepEqual(setModelPrimary('openai/gpt-4o', 'qwen/qwen3.6-plus'), {
    primary: 'qwen/qwen3.6-plus',
  });
});

test('changing a structured primary preserves its fallback chain', () => {
  const next = setModelPrimary(
    { primary: 'openai/gpt-4o', fallbacks: ['qwen/qwen3.6-plus', 'anthropic/claude-sonnet-4-6'] },
    'openai/gpt-5.6',
  );

  assert.equal(getModelPrimary(next), 'openai/gpt-5.6');
  assert.deepEqual(getModelFallbacks(next), [
    'qwen/qwen3.6-plus',
    'anthropic/claude-sonnet-4-6',
  ]);
});

test('primary and fallback routing stay disjoint from every mutation entry point', () => {
  const changedPrimary = setModelPrimary(
    { primary: 'openai/gpt-4o', fallbacks: ['qwen/qwen3.6-plus', 'openai/gpt-5.6'] },
    'qwen/qwen3.6-plus',
  );
  assert.equal(getModelPrimary(changedPrimary), 'qwen/qwen3.6-plus');
  assert.deepEqual(getModelFallbacks(changedPrimary), ['openai/gpt-5.6']);

  const changedFallbacks = setModelFallbacks(
    { primary: 'qwen/qwen3.6-plus', fallbacks: ['openai/gpt-5.6'] },
    ['qwen/qwen3.6-plus', 'openai/gpt-5.6', 'qwen/qwen3.6-plus'],
  );
  assert.deepEqual(getModelFallbacks(changedFallbacks), ['openai/gpt-5.6']);

  const normalized = normalizeModelReferenceConfig(
    {
      primary: 'legacy/primary',
      fallbacks: ['legacy/primary', 'legacy/fallback'],
    },
    (value) => value?.replace('legacy/', 'runtime/'),
  );
  assert.equal(getModelPrimary(normalized), 'runtime/primary');
  assert.deepEqual(getModelFallbacks(normalized), ['runtime/fallback']);
});

test('rewriting a removed model updates primary and fallback references without string spreading', () => {
  const next = rewriteModelReferenceConfig(
    { primary: 'openai/removed', fallbacks: ['openai/removed', 'qwen/keep'] },
    new Set(['openai/removed']),
    'qwen/replacement',
  );

  assert.equal(getModelPrimary(next), 'qwen/replacement');
  assert.deepEqual(getModelFallbacks(next), ['qwen/keep']);
  assert.equal(rewriteModelReferenceConfig('openai/removed', new Set(['openai/removed'])), undefined);
});

test('removing a primary promotes only its configured fallback', () => {
  const next = rewriteModelReferenceConfig(
    {
      primary: 'openai/removed',
      fallbacks: ['openai/removed', 'qwen/first', 'anthropic/second'],
    },
    new Set(['openai/removed']),
  );

  assert.equal(getModelPrimary(next), 'qwen/first');
  assert.deepEqual(getModelFallbacks(next), ['anthropic/second']);
  assert.equal(
    getModelPrimary(rewriteModelReferenceConfig(
      { primary: 'openai/removed' },
      new Set(['openai/removed']),
    )),
    undefined,
  );
});
