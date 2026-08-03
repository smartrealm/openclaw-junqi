import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cancelTask,
  getTask,
  listTasks,
  parseTasksCancelResult,
  parseTasksGetResult,
  parseTasksListPage,
} from './taskLedger';

const task = {
  id: 'task-1',
  status: 'running',
  kind: 'subagent',
  runtime: 'acp',
  title: 'Research task',
  agentId: 'research',
  runId: 'run-1',
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: 1_754_000_000_000,
  progressSummary: 'Collecting sources',
} as const;

test('decodes task summaries and normalizes protocol timestamps', () => {
  const page = parseTasksListPage({ tasks: [task], nextCursor: '1' });
  assert.equal(page.tasks[0]?.createdAt, Date.parse(task.createdAt));
  assert.equal(page.tasks[0]?.status, 'running');
  assert.equal(page.nextCursor, '1');
});

test('fails closed on unknown task status and malformed timestamp', () => {
  assert.throws(() => parseTasksListPage({ tasks: [{ ...task, status: 'lost' }] }), /status/);
  assert.throws(() => parseTasksListPage({ tasks: [{ ...task, createdAt: 'not-a-date' }] }), /createdAt/);
});

test('builds bounded task list filters and preserves status arrays', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  await listTasks(async (method, params) => {
    calls.push({ method, params });
    return { tasks: [task] };
  }, { status: ['queued', 'running'], limit: 999 });
  assert.deepEqual(calls, [{
    method: 'tasks.list',
    params: { status: ['queued', 'running'], limit: 500 },
  }]);
});

test('uses the official tasks.get envelope and rejects malformed details', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const result = await getTask(async (method, params) => {
    calls.push({ method, params });
    return { task: { ...task, terminalSummary: 'Finished' } };
  }, ' task-1 ');
  assert.equal(result.task.terminalSummary, 'Finished');
  assert.deepEqual(calls, [{ method: 'tasks.get', params: { taskId: 'task-1' } }]);

  await assert.rejects(() => getTask(async () => ({ task }), '  '), /taskId/);
  assert.throws(() => parseTasksGetResult({ task: { ...task, status: 'lost' } }), /status/);
  assert.throws(() => parseTasksGetResult({}), /tasks\.get/);
});

test('requires an explicit task id and validates cancellation result', async () => {
  await assert.rejects(() => cancelTask(async () => ({ found: false, cancelled: false }), '  '), /taskId/);
  const result = parseTasksCancelResult({ found: true, cancelled: true, task: { ...task, status: 'cancelled' } });
  assert.equal(result.task?.status, 'cancelled');

  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  await cancelTask(async (method, params) => {
    calls.push({ method, params });
    return { found: true, cancelled: true };
  }, ' task-1 ');
  assert.deepEqual(calls, [{
    method: 'tasks.cancel',
    params: { taskId: 'task-1', reason: 'junqi_activity_center' },
  }]);
});
