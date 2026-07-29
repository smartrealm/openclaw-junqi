import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupSessionModels,
  modelDisplayName,
  normalizeThinkingLevel,
  thinkingLevelForGateway,
} from './sessionRuntimeDomain';

test('groupSessionModels derives providers from gateway model ids', () => {
  const groups = groupSessionModels([
    { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    { id: 'deepseek/deepseek-reasoner', label: 'DeepSeek Reasoner' },
    { id: 'minimax/MiniMax-M2.7', label: 'MiniMax M2.7' },
  ]);

  assert.deepEqual(groups.map((group) => [group.providerId, group.models.length]), [
    ['deepseek', 2],
    ['minimax', 1],
  ]);
});

test('modelDisplayName prefers catalog metadata without model-specific rules', () => {
  assert.equal(
    modelDisplayName({ id: 'provider/model', label: 'Catalog label', alias: 'Alias' }, 'provider/model'),
    'Alias',
  );
  assert.equal(modelDisplayName(undefined, 'provider/model'), 'model');
});

test('thinking levels normalize to the supported gateway values', () => {
  assert.equal(normalizeThinkingLevel(null), 'auto');
  assert.equal(normalizeThinkingLevel('high'), 'high');
  assert.equal(normalizeThinkingLevel('unexpected'), 'auto');
  assert.equal(thinkingLevelForGateway('auto'), null);
  assert.equal(thinkingLevelForGateway('minimal'), 'minimal');
});
