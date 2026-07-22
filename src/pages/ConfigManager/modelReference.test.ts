import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getModelFallbacks,
  getModelPrimary,
  normalizeModelReferenceConfig,
  rewriteModelReferenceConfig,
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

test('rewriting a removed model updates primary and fallback references without string spreading', () => {
  const next = rewriteModelReferenceConfig(
    { primary: 'openai/removed', fallbacks: ['openai/removed', 'qwen/keep'] },
    new Set(['openai/removed']),
    'qwen/replacement',
  );

  assert.equal(getModelPrimary(next), 'qwen/replacement');
  assert.deepEqual(getModelFallbacks(next), ['qwen/replacement', 'qwen/keep']);
  assert.equal(rewriteModelReferenceConfig('openai/removed', new Set(['openai/removed'])), undefined);
});
