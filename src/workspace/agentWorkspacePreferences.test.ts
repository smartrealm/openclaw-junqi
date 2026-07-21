import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readAttentionBadge,
  readTaskDisplayWindow,
  writeAttentionBadge,
  writeTaskDisplayWindow,
} from './agentWorkspacePreferences';

test('AI workspace preferences use JunQi storage keys', () => {
  localStorage.clear();
  assert.equal(readTaskDisplayWindow(), 3);
  writeTaskDisplayWindow('all');
  assert.equal(localStorage.getItem('junqi:taskDisplayWindow'), 'all');
});

test('attention badge defaults on and persists the JunQi toggle', () => {
  localStorage.clear();
  assert.equal(readAttentionBadge(), true);
  writeAttentionBadge(false);
  assert.equal(readAttentionBadge(), false);
  assert.equal(localStorage.getItem('junqi:attentionBadge'), '0');
});
