import assert from 'node:assert/strict';
import test from 'node:test';
import { taskDetailVisibility } from './OpenClawTaskLedgerPanel';

test('任务详情仅在用户展开且 Gateway 已返回详情时显示', () => {
  assert.equal(taskDetailVisibility(false, false), 'collapsed');
  assert.equal(taskDetailVisibility(true, false), 'collapsed');
  assert.equal(taskDetailVisibility(false, true), 'collapsed');
  assert.equal(taskDetailVisibility(true, true), 'expanded');
});
