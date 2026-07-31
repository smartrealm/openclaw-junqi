import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfiguredModelRows } from './ConfiguredModelDirectory';

test('configured model directory groups model references by their provider namespace', () => {
  const rows = buildConfiguredModelRows({
    'minimax/MiniMax-M2.7': { alias: 'minimax-fast' },
    'deepseek/deepseek-v4-pro': {},
    'deepseek/deepseek-chat': {},
  });

  assert.deepEqual(rows.map(({ providerId, modelId, reference }) => ({ providerId, modelId, reference })), [
    { providerId: 'deepseek', modelId: 'deepseek-chat', reference: 'deepseek/deepseek-chat' },
    { providerId: 'deepseek', modelId: 'deepseek-v4-pro', reference: 'deepseek/deepseek-v4-pro' },
    { providerId: 'minimax', modelId: 'MiniMax-M2.7', reference: 'minimax/MiniMax-M2.7' },
  ]);
});

test('configured model directory keeps malformed references visible instead of dropping them', () => {
  const rows = buildConfiguredModelRows({ 'local-model': {} });

  assert.deepEqual(rows.map(({ providerId, modelId }) => ({ providerId, modelId })), [
    { providerId: 'local-model', modelId: 'local-model' },
  ]);
});
