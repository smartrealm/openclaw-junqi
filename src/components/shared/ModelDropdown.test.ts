import assert from 'node:assert/strict';
import test from 'node:test';
import { formatModelRef } from './modelPresentation';
import { providerDisplayLabel } from './provider-identity';

test('providerDisplayLabel preserves official provider names', () => {
  assert.equal(providerDisplayLabel('openai'), 'OpenAI');
  assert.equal(providerDisplayLabel('google'), 'Google');
});

test('providerDisplayLabel derives readable custom provider names', () => {
  assert.equal(providerDisplayLabel('my-vllm'), 'My Vllm');
  assert.equal(providerDisplayLabel('minimax-anthropic'), 'Minimax Anthropic');
});

test('model ref fallback display is generic and does not special-case catalog ids', () => {
  assert.equal(formatModelRef('openai/gpt-4'), 'gpt-4');
  assert.equal(formatModelRef('future-provider/family/model-v9'), 'family/model-v9');
  assert.equal(formatModelRef(null), '—');
});
