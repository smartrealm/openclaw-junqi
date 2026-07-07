import test from 'node:test';
import assert from 'node:assert/strict';
import { getProviderDisplayLabel } from './ModelDropdown';

test('getProviderDisplayLabel uses registry labels for known providers', () => {
  assert.equal(getProviderDisplayLabel('openai'), 'OpenAI');
  assert.equal(getProviderDisplayLabel('google'), 'Google Gemini');
});

test('getProviderDisplayLabel preserves custom provider ids', () => {
  assert.equal(getProviderDisplayLabel('my-vllm'), 'my-vllm');
  assert.equal(getProviderDisplayLabel('minimax-anthropic'), 'minimax-anthropic');
});
