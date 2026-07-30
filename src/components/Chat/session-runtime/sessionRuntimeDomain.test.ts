import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    { id: 'modelstudio/private-model', label: 'Private model' },
  ]);

  assert.deepEqual(groups.map((group) => [group.providerId, group.models.length]), [
    ['deepseek', 2],
    ['minimax', 1],
    ['modelstudio', 1],
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

test('session runtime picker follows the compact shared provider identity contract', () => {
  const source = readFileSync(new URL('./SessionRuntimeControl.tsx', import.meta.url), 'utf8');
  assert.match(source, /from '@\/components\/shared\/provider-identity'/);
  assert.match(source, /w-\[min\(420px,calc\(100vw-24px\)\)\]/);
  assert.match(source, /grid-cols-\[136px_minmax\(0,1fr\)\]/);
  assert.doesNotMatch(source, /w-\[min\(620px/);
  assert.doesNotMatch(source, /Icon\.provider/);
});
