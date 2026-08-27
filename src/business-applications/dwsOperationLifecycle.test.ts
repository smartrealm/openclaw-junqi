import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimDwsOperationStart,
  isDwsOperationActive,
  releaseDwsOperationStart,
  resolveDwsDialogDismissAction,
  type DwsOperationStartGuard,
} from './dwsOperationLifecycle';

test('DWS 启动响应返回前拒绝重复启动', () => {
  const guard: DwsOperationStartGuard = { current: false };

  assert.equal(claimDwsOperationStart(guard), true);
  assert.equal(claimDwsOperationStart(guard), false);
  releaseDwsOperationStart(guard);
  assert.equal(claimDwsOperationStart(guard), true);
});

test('启动、运行和取消中共用活动操作门禁', () => {
  assert.equal(isDwsOperationActive('starting'), true);
  assert.equal(isDwsOperationActive('running'), true);
  assert.equal(isDwsOperationActive('cancelling'), true);
  assert.equal(isDwsOperationActive('completed'), false);
  assert.equal(isDwsOperationActive(null), false);
});

test('关闭活动 DWS 弹窗必须请求取消而非静默忽略', () => {
  assert.equal(resolveDwsDialogDismissAction('starting'), 'request-cancel');
  assert.equal(resolveDwsDialogDismissAction('running'), 'request-cancel');
  assert.equal(resolveDwsDialogDismissAction('cancelling'), 'request-cancel');
  assert.equal(resolveDwsDialogDismissAction('cancelled'), 'dismiss');
});
