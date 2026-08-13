import assert from 'node:assert/strict';
import test from 'node:test';
import { initialStorageLocationsVisibility } from './storageSetupModel';

test('安装位置首次进入时默认展开并保留会话内的显式折叠选择', () => {
  assert.equal(initialStorageLocationsVisibility(), true);
  assert.equal(initialStorageLocationsVisibility(true), true);
  assert.equal(initialStorageLocationsVisibility(false), false);
});
