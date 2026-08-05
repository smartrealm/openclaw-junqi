import test from 'node:test';
import assert from 'node:assert/strict';
import { extractAvailableModelsFromGatewayResult } from './modelCatalog';

test('Gateway model parser keeps only explicitly available current-runtime models', () => {
  const models = extractAvailableModelsFromGatewayResult({
    models: [
      { provider: 'openai', id: 'gpt-4o', name: 'GPT-4o', alias: 'fast', available: true, input: ['text', 'image'] },
      { provider: 'qwen', id: 'qwen3.6-plus', available: false },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' },
      'openai/gpt-5.6',
      { provider: 'openai', model: 'not-an-official-entry', available: true },
    ],
  });

  assert.deepEqual(models, [
    { id: 'openai/gpt-4o', label: 'GPT-4o', alias: 'fast', supportsImage: true },
  ]);
});

test('Gateway model parser fails closed for a malformed catalog envelope', () => {
  assert.deepEqual(extractAvailableModelsFromGatewayResult({ models: {} }), []);
  assert.deepEqual(extractAvailableModelsFromGatewayResult([]), []);
});
