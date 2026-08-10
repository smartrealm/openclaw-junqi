import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAgentScopedGatewayModels, loadConfiguredGatewayModels } from './modelLoaders';

test('configured Gateway model loading uses only the official picker view', async () => {
  const calls: Array<[string, unknown]> = [];
  const models = await loadConfiguredGatewayModels(
    async (method, params) => {
      calls.push([method, params]);
      return { models: [{ id: 'openai/gpt-4o', available: true }] };
    },
    (response) => response.models.map((model) => ({
      id: (model as { id: string }).id,
      label: (model as { id: string }).id,
    })),
  );

  assert.deepEqual(calls, [['models.list', { view: 'configured' }]]);
  assert.deepEqual(models, [{ id: 'openai/gpt-4o', label: 'openai/gpt-4o' }]);
});

test('empty, malformed, or failed Gateway model responses do not invent fallback models', async () => {
  let extractCalls = 0;
  const extract = (response: { models: unknown[] }) => {
    extractCalls += 1;
    return response.models.map(() => ({ id: 'must-not-be-used', label: 'must-not-be-used' }));
  };

  assert.deepEqual(await loadConfiguredGatewayModels(async () => ({ models: [] }), extract), []);
  assert.deepEqual(await loadConfiguredGatewayModels(async () => ({ catalog: [] }), extract), []);
  assert.deepEqual(await loadConfiguredGatewayModels(async () => { throw new Error('offline'); }, extract), []);
  assert.equal(extractCalls, 1);
});

test('会话模型目录通过官方 chat.metadata 绑定目标智能体', async () => {
  const calls: Array<[string, unknown]> = [];
  const models = await loadAgentScopedGatewayModels(
    ' legal ',
    async (method, params) => {
      calls.push([method, params]);
      return { models: [{ id: 'provider/legal-model', available: true }] };
    },
    (response) => response.models.map((model) => ({
      id: (model as { id: string }).id,
      label: (model as { id: string }).id,
    })),
  );

  assert.deepEqual(calls, [['chat.metadata', { agentId: 'legal' }]]);
  assert.deepEqual(models, [{ id: 'provider/legal-model', label: 'provider/legal-model' }]);
});

test('智能体模型目录对缺失模型、空智能体和读取失败保持失败关闭', async () => {
  let calls = 0;
  const extract = () => [{ id: 'must-not-be-used', label: 'must-not-be-used' }];

  assert.deepEqual(await loadAgentScopedGatewayModels('', async () => {
    calls += 1;
    return { models: [] };
  }, extract), []);
  assert.deepEqual(await loadAgentScopedGatewayModels('legal', async () => ({ commands: [] }), extract), []);
  assert.deepEqual(await loadAgentScopedGatewayModels('legal', async () => {
    throw new Error('offline');
  }, extract), []);
  assert.equal(calls, 0);
});
