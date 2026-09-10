import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyStorageSetupError,
  initialStorageLocationsVisibility,
  storageSubmissionPresentation,
} from './storageSetupModel';

test('安装位置首次进入时默认展开并保留会话内的显式折叠选择', () => {
  assert.equal(initialStorageLocationsVisibility(), true);
  assert.equal(initialStorageLocationsVisibility(true), true);
  assert.equal(initialStorageLocationsVisibility(false), false);
});

test('提交存储位置时保留当前表单并锁定交互', () => {
  assert.deepEqual(storageSubmissionPresentation(false, true), {
    contentIdentity: 'storage:form',
    locked: false,
    loading: false,
    action: 'continue',
  });
  assert.deepEqual(storageSubmissionPresentation(true, true), {
    contentIdentity: 'storage:form',
    locked: true,
    loading: true,
    action: 'confirm-current',
  });
  assert.deepEqual(storageSubmissionPresentation(true, false), {
    contentIdentity: 'storage:form',
    locked: true,
    loading: true,
    action: 'prepare-new',
  });
});

test('把 OpenClaw 核验失败与普通存储错误分开呈现', () => {
  assert.equal(
    classifyStorageSetupError('OpenClaw is not available to verify the selected official Gateway service; storage changes were not started'),
    'openclaw-unavailable',
  );
  assert.equal(classifyStorageSetupError('permission denied'), 'generic');
});
