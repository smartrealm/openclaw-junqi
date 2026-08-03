import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeGatewayTriggersForModelSelection,
  resolveModelWakeKeywordSelection,
  selectedModelWakeKeywords,
} from './VoiceWakeKeywordSelection';

test('model phrase selection preserves exact local labels after Gateway trim', () => {
  assert.deepEqual(
    selectedModelWakeKeywords(['Jarvis', 'Hello JunQi'], ['jarvis', 'unrelated']),
    [],
  );
  assert.deepEqual(
    selectedModelWakeKeywords(['Jarvis', 'Hello JunQi'], [' Jarvis ', 'unrelated']),
    ['Jarvis'],
  );
  assert.deepEqual(
    resolveModelWakeKeywordSelection(['Jarvis', 'Hello JunQi'], [' Hello JunQi ']),
    ['Hello JunQi'],
  );
  assert.equal(resolveModelWakeKeywordSelection(['Jarvis', 'Hello JunQi'], ['hello junqi']), null);
});

test('model phrase selection rejects empty, duplicated, and unrecognized phrases', () => {
  const labels = ['Jarvis'];
  assert.equal(resolveModelWakeKeywordSelection(labels, []), null);
  assert.equal(resolveModelWakeKeywordSelection(labels, ['Jarvis', 'jarvis']), null);
  assert.equal(resolveModelWakeKeywordSelection(labels, ['arbitrary phrase']), null);
});

test('model phrase selection preserves case variants owned by other models and nodes', () => {
  assert.deepEqual(
    mergeGatewayTriggersForModelSelection(
      ['Jarvis', 'Hello JunQi'],
      ['openclaw', 'other node', 'jarvis', 'Jarvis'],
      ['Hello JunQi'],
    ),
    ['openclaw', 'other node', 'jarvis', 'Hello JunQi'],
  );
});

test('model phrase selection fails closed when preserved Gateway triggers fill the shared capacity', () => {
  assert.equal(
    mergeGatewayTriggersForModelSelection(
      ['Jarvis'],
      Array.from({ length: 32 }, (_, index) => `other-${index}`),
      ['Jarvis'],
    ),
    null,
  );
});
