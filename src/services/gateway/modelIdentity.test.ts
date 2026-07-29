import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveGatewaySessionModelId } from './modelIdentity';

test('sessions.list provider and bare model fields form a canonical model id', () => {
  assert.equal(
    resolveGatewaySessionModelId('deepseek', 'deepseek-v4-pro'),
    'deepseek/deepseek-v4-pro',
  );
  assert.equal(
    resolveGatewaySessionModelId('deepseek', 'deepseek/deepseek-v4-pro'),
    'deepseek/deepseek-v4-pro',
  );
  assert.equal(resolveGatewaySessionModelId(undefined, 'openai/gpt-5.6'), 'openai/gpt-5.6');
  assert.equal(resolveGatewaySessionModelId('openai', ''), null);
});

test('Gateway provider identity is preserved instead of applying renderer aliases', () => {
  assert.equal(
    resolveGatewaySessionModelId('modelstudio', 'custom-model'),
    'modelstudio/custom-model',
  );
  assert.equal(
    resolveGatewaySessionModelId('kimi', 'kimi-for-coding'),
    'kimi/kimi-for-coding',
  );
});
