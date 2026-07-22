import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayModelsListLoader, ModelLoaderChain } from './modelLoaders';

test('gateway model loader asks OpenClaw for the configured runtime view before fallback loaders', async () => {
  const calls: Array<[string, unknown]> = [];
  const primary = new GatewayModelsListLoader(async (method, params) => {
    calls.push([method, params]);
    return { models: [{ id: 'openai/gpt-4o' }] };
  });
  const chain = new ModelLoaderChain([
    primary,
    {
      name: 'fallback',
      async load() {
        throw new Error('fallback should not run when OpenClaw returned configured models');
      },
    },
  ]);

  const models = await chain.load({
    hasProviders: () => true,
    extractModels: () => [],
    extractRuntimeModels: (result) => (result as { models: Array<{ id: string }> }).models.map((model) => ({
      id: model.id,
      label: model.id,
    })),
  });

  assert.deepEqual(calls, [['models.list', { view: 'configured' }]]);
  assert.deepEqual(models, [{ id: 'openai/gpt-4o', label: 'openai/gpt-4o' }]);
});
