import assert from 'node:assert/strict';
import test from 'node:test';
import { initialStorageLocationsVisibility, storageAutoAdvanceCompletion } from './storageSetupModel';

const configured = {
  configured: true,
  openclawRelocationRequired: false,
};

test('已配置且未修改的数据位置直接进入下一阶段', () => {
  assert.deepEqual(storageAutoAdvanceCompletion(configured, false, false), {
    createdFresh: false,
    openclawRelocationRequired: false,
  });
});

test('forced storage recovery cannot continue without submitting a new layout', () => {
  assert.equal(storageAutoAdvanceCompletion(configured, false, true), null);
});

test('an in-progress storage draft must be explicitly submitted', () => {
  assert.equal(storageAutoAdvanceCompletion(configured, true, false), null);
});

test('安装位置首次进入时默认展开并保留会话内的显式折叠选择', () => {
  assert.equal(initialStorageLocationsVisibility(), true);
  assert.equal(initialStorageLocationsVisibility(true), true);
  assert.equal(initialStorageLocationsVisibility(false), false);
});
