import assert from 'node:assert/strict';
import test from 'node:test';
import { getFeatureKeyForPath } from './edition';

test('功能查找覆盖主路由列表外的所有受支持深层链接', () => {
  assert.equal(getFeatureKeyForPath('/channels'), 'configManager');
  assert.equal(getFeatureKeyForPath('/kanban'), 'workshop');
  assert.equal(getFeatureKeyForPath('/timeline'), 'workshop');
  assert.equal(getFeatureKeyForPath('/openclaw-commands'), 'tools');
});
