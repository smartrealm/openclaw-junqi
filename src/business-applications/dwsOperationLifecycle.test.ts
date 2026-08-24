import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimDwsOperationStart,
  isDwsOperationActive,
  releaseDwsOperationStart,
  type DwsOperationStartGuard,
} from './dwsOperationLifecycle';

test('DWS 启动响应返回前拒绝重复启动', () => {
  const guard: DwsOperationStartGuard = { current: false };

  assert.equal(claimDwsOperationStart(guard), true);
  assert.equal(claimDwsOperationStart(guard), false);
  releaseDwsOperationStart(guard);
  assert.equal(claimDwsOperationStart(guard), true);
});

test('starting 与 running 共用活动操作门禁', () => {
  assert.equal(isDwsOperationActive('starting'), true);
  assert.equal(isDwsOperationActive('running'), true);
  assert.equal(isDwsOperationActive('completed'), false);
  assert.equal(isDwsOperationActive(null), false);
});
