import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveModelWakeKeywordSelection,
  selectedModelWakeKeywords,
} from './VoiceWakeKeywordSelection';

test('model phrase selection preserves the exact local labels after Gateway normalization', () => {
  assert.deepEqual(
    selectedModelWakeKeywords(['Jarvis', 'Hello JunQi'], ['jarvis', 'unrelated']),
    ['Jarvis'],
  );
  assert.deepEqual(
    resolveModelWakeKeywordSelection(['Jarvis', 'Hello JunQi'], ['hello junqi']),
    ['Hello JunQi'],
  );
});

test('model phrase selection rejects empty, duplicated, and unrecognized phrases', () => {
  const labels = ['Jarvis'];
  assert.equal(resolveModelWakeKeywordSelection(labels, []), null);
  assert.equal(resolveModelWakeKeywordSelection(labels, ['Jarvis', 'jarvis']), null);
  assert.equal(resolveModelWakeKeywordSelection(labels, ['arbitrary phrase']), null);
});
