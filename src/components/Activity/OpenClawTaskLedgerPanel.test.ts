import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOpenClawTaskFlow, taskDetailVisibility } from './OpenClawTaskLedgerPanel';

test('任务详情仅在用户展开且 Gateway 已返回详情时显示', () => {
  assert.equal(taskDetailVisibility(false, false), 'collapsed');
  assert.equal(taskDetailVisibility(true, false), 'collapsed');
  assert.equal(taskDetailVisibility(false, true), 'collapsed');
  assert.equal(taskDetailVisibility(true, true), 'expanded');
});

test('任务流只按 Gateway 任务状态投影，不创建本地状态', () => {
  const columns = projectOpenClawTaskFlow([
    { id: 'queued', status: 'queued' },
    { id: 'running', status: 'running' },
    { id: 'completed', status: 'completed' },
    { id: 'failed', status: 'failed' },
    { id: 'cancelled', status: 'cancelled' },
    { id: 'timed_out', status: 'timed_out' },
  ]);
  assert.deepEqual(columns.map((column) => [column.id, column.tasks.map((task) => task.id)]), [
    ['queued', ['queued']],
    ['running', ['running']],
    ['completed', ['completed']],
    ['attention', ['failed', 'cancelled', 'timed_out']],
  ]);
});
