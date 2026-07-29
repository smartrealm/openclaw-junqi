import assert from 'node:assert/strict';
import test from 'node:test';
import { getProviderDisplayLabel } from './ModelDropdown';
import { formatModelRef } from './modelPresentation';

test('getProviderDisplayLabel uses registry labels for known providers', () => {
  assert.equal(getProviderDisplayLabel('openai'), 'OpenAI');
  assert.equal(getProviderDisplayLabel('google'), 'Google Gemini');
});

test('getProviderDisplayLabel preserves custom provider ids', () => {
  assert.equal(getProviderDisplayLabel('my-vllm'), 'my-vllm');
  assert.equal(getProviderDisplayLabel('minimax-anthropic'), 'minimax-anthropic');
});

test('model ref fallback display is generic and does not special-case catalog ids', () => {
  assert.equal(formatModelRef('openai/gpt-4'), 'gpt-4');
  assert.equal(formatModelRef('future-provider/family/model-v9'), 'family/model-v9');
  assert.equal(formatModelRef(null), '—');
});
