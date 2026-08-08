import assert from 'node:assert/strict';
import test from 'node:test';
import { projectProviderGatewayCatalog } from './providerGatewayCatalog';

test('Provider 编辑页仅投影 Gateway 明确可用的模型目录', () => {
  const models = projectProviderGatewayCatalog({
    models: [
      { provider: 'openai', id: 'gpt-5.6', available: true, alias: '默认', input: ['text', 'image'] },
      { provider: 'openai', id: 'gpt-4o', available: false },
      'openai/不应接受字符串模型',
      { provider: 'anthropic', id: 'claude-sonnet-4-6', available: true },
      { provider: 'qwen', model: '不符合协议字段', available: true },
    ],
  });

  assert.deepEqual(models, [
    { id: 'openai/gpt-5.6', provider: 'openai', alias: '默认', supportsImage: true },
    { id: 'anthropic/claude-sonnet-4-6', provider: 'anthropic' },
  ]);
});
