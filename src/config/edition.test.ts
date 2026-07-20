import assert from 'node:assert/strict';
import test from 'node:test';
import { getFeatureKeyForPath } from './edition';

test('feature lookup covers every feature-gated deep link outside the primary route list', () => {
  assert.equal(getFeatureKeyForPath('/ai-workspace'), 'agentRun');
  assert.equal(getFeatureKeyForPath('/channels'), 'configManager');
  assert.equal(getFeatureKeyForPath('/kanban'), 'workshop');
  assert.equal(getFeatureKeyForPath('/timeline'), 'workshop');
  assert.equal(getFeatureKeyForPath('/openclaw-commands'), 'tools');
});
