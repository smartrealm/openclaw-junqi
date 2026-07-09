import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProviderAddition } from './ProvidersTab';

test('applyProviderAddition normalizes provider ids, profile keys, model ids, and custom secrets', () => {
  const next = applyProviderAddition(
    {},
    ' My-VLLM : Work ',
    {
      provider: ' My-VLLM ',
      mode: 'api_key',
      apiKey: ' local-secret ',
    },
    [' model-a ', 'My-VLLM/model-a', '/model-b/'],
    {
      baseUrl: ' http://localhost:8000/v1 ',
      api: 'openai-completions',
      textPrimaryModel: ' model-a ',
    },
  );

  assert.equal(next.auth?.profiles?.['my-vllm:Work']?.provider, 'my-vllm');
  assert.equal(next.auth?.profiles?.['my-vllm:Work']?.apiKey, undefined);
  assert.equal(next.env?.vars?.MY_VLLM_API_KEY, 'local-secret');
  assert.equal(next.models?.providers?.['my-vllm']?.apiKey, '${MY_VLLM_API_KEY}');
  assert.equal(next.models?.providers?.['my-vllm']?.baseUrl, 'http://localhost:8000/v1');
  assert.deepEqual(
    next.models?.providers?.['my-vllm']?.models?.map((model: any) => model.id),
    ['model-a', 'model-b'],
  );
  assert.deepEqual(Object.keys(next.agents?.defaults?.models ?? {}), [
    'my-vllm/model-a',
    'my-vllm/model-b',
  ]);
  assert.equal(next.agents?.defaults?.model?.primary, 'my-vllm/model-a');
});
