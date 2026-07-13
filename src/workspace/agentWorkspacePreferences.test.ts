import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readAttentionBadge,
  readTaskDisplayWindow,
  writeAttentionBadge,
  writeTaskDisplayWindow,
} from './agentWorkspacePreferences';

test('AI workspace preferences use Nezha storage keys and migrate the old task window', () => {
  localStorage.clear();
  localStorage.setItem('junqi:agent-workspace:task-display-window', '15');
  assert.equal(readTaskDisplayWindow(), 15);
  writeTaskDisplayWindow('all');
  assert.equal(localStorage.getItem('nezha:taskDisplayWindow'), 'all');
  assert.equal(localStorage.getItem('junqi:agent-workspace:task-display-window'), null);
});

test('attention badge defaults on and persists the Nezha toggle', () => {
  localStorage.clear();
  assert.equal(readAttentionBadge(), true);
  writeAttentionBadge(false);
  assert.equal(readAttentionBadge(), false);
  assert.equal(localStorage.getItem('nezha:attentionBadge'), '0');
});
