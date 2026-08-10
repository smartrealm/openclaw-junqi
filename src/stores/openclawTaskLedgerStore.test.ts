import assert from 'node:assert/strict';
import test from 'node:test';
import { gateway } from '@/services/gateway';
import { useOpenClawTaskLedgerStore } from './openclawTaskLedgerStore';

const task = (id: string) => ({ id, status: 'running' as const, updatedAt: 1 });

test('keeps the newest native task page when list requests overlap', async () => {
  const originalList = gateway.listTasks;
  let resolveFirst!: (value: Awaited<ReturnType<typeof gateway.listTasks>>) => void;
  let resolveSecond!: (value: Awaited<ReturnType<typeof gateway.listTasks>>) => void;
  let calls = 0;
  gateway.listTasks = async () => new Promise((resolve) => {
    calls += 1;
    if (calls === 1) resolveFirst = resolve;
    else resolveSecond = resolve;
  });
  useOpenClawTaskLedgerStore.setState({ page: null, loading: false, error: null });

  try {
    const first = useOpenClawTaskLedgerStore.getState().refresh(true, true);
    const second = useOpenClawTaskLedgerStore.getState().refresh(true, true);
    resolveSecond({ tasks: [task('newer')], availability: 'available' });
    await second;
    resolveFirst({ tasks: [task('older')], availability: 'available' });
    await first;
    assert.equal(useOpenClawTaskLedgerStore.getState().page?.tasks[0]?.id, 'newer');
  } finally {
    gateway.listTasks = originalList;
  }
});

test('keeps task ledger separate from local state when Gateway disconnects', async () => {
  const originalList = gateway.listTasks;
  let resolveList!: (value: Awaited<ReturnType<typeof gateway.listTasks>>) => void;
  gateway.listTasks = async () => new Promise((resolve) => { resolveList = resolve; });
  useOpenClawTaskLedgerStore.setState({ page: { tasks: [task('before')], availability: 'available' }, loading: false, error: null });

  try {
    const pending = useOpenClawTaskLedgerStore.getState().refresh(true, true);
    await useOpenClawTaskLedgerStore.getState().refresh(false, true);
    resolveList({ tasks: [task('late')], availability: 'available' });
    await pending;
    assert.equal(useOpenClawTaskLedgerStore.getState().page, null);
  } finally {
    gateway.listTasks = originalList;
  }
});

test('loads task detail only through the native Gateway method', async () => {
  const originalGet = gateway.getTask;
  gateway.getTask = async () => ({ ...task('task-1'), prompt: 'official prompt' });
  useOpenClawTaskLedgerStore.setState({ detailsById: {}, detailErrors: {}, detailLoadingId: null });

  try {
    await useOpenClawTaskLedgerStore.getState().loadDetail(true, 'task-1');
    assert.equal(useOpenClawTaskLedgerStore.getState().detailsById['task-1']?.prompt, 'official prompt');
  } finally {
    gateway.getTask = originalGet;
  }
});

test('appends native task cursor pages without duplicating a task id', async () => {
  const originalList = gateway.listTasks;
  gateway.listTasks = async (input = {}) => input.cursor === undefined
    ? { tasks: [task('first')], nextCursor: 'next', availability: 'available' as const }
    : { tasks: [task('first'), task('second')], availability: 'available' as const };
  useOpenClawTaskLedgerStore.setState({ page: null, loading: false, error: null });

  try {
    await useOpenClawTaskLedgerStore.getState().refresh(true, true);
    await useOpenClawTaskLedgerStore.getState().loadMore(true);
    assert.deepEqual(useOpenClawTaskLedgerStore.getState().page?.tasks.map((entry) => entry.id), ['first', 'second']);
  } finally {
    gateway.listTasks = originalList;
  }
});

test('does not claim cancellation when the native Gateway does not confirm it', async () => {
  const originalCancel = gateway.cancelTask;
  gateway.cancelTask = async () => ({ found: true, cancelled: false, reason: 'already terminal' });
  useOpenClawTaskLedgerStore.setState({ cancellingTaskId: null, error: null });

  try {
    await useOpenClawTaskLedgerStore.getState().cancel(true, task('task-1'));
    assert.equal(useOpenClawTaskLedgerStore.getState().error, 'already terminal');
    assert.equal(useOpenClawTaskLedgerStore.getState().cancellingTaskId, null);
  } finally {
    gateway.cancelTask = originalCancel;
  }
});

test('disconnected task actions defer to the shared offline state', async () => {
  useOpenClawTaskLedgerStore.setState({ error: 'stale failure' });

  await useOpenClawTaskLedgerStore.getState().cancel(false, task('task-1'));

  assert.equal(useOpenClawTaskLedgerStore.getState().error, null);
});

test('refreshes only after the native Gateway confirms blocked completion delivery recovery', async () => {
  const originalRetry = gateway.retryTaskDelivery;
  const originalList = gateway.listTasks;
  const originalGetStatus = gateway.getStatus;
  const blocked = { ...task('task-1'), status: 'completed' as const, deliveryStatus: 'failed' as const, terminalOutcome: 'blocked' as const };
  let listCalls = 0;
  gateway.retryTaskDelivery = async () => ({ results: [{ taskId: 'task-1', ok: true }] });
  gateway.listTasks = async () => {
    listCalls += 1;
    return { tasks: [blocked], availability: 'available' as const };
  };
  gateway.getStatus = () => ({ ...originalGetStatus(), connected: true });
  useOpenClawTaskLedgerStore.setState({ retryingTaskId: null, error: null, page: null });

  try {
    await useOpenClawTaskLedgerStore.getState().retryDelivery(true, blocked);
    assert.equal(listCalls, 1);
    assert.equal(useOpenClawTaskLedgerStore.getState().retryingTaskId, null);
    assert.equal(useOpenClawTaskLedgerStore.getState().error, null);
  } finally {
    gateway.retryTaskDelivery = originalRetry;
    gateway.listTasks = originalList;
    gateway.getStatus = originalGetStatus;
  }
});

test('does not claim delivery dismissal when the native Gateway rejects it', async () => {
  const originalDismiss = gateway.dismissTaskDelivery;
  const blocked = { ...task('task-1'), status: 'completed' as const, deliveryStatus: 'failed' as const, terminalOutcome: 'blocked' as const };
  gateway.dismissTaskDelivery = async () => ({ results: [{ taskId: 'task-1', ok: false, reason: 'completion delivery is not blocked' }] });
  useOpenClawTaskLedgerStore.setState({ dismissingTaskId: null, error: null });

  try {
    await useOpenClawTaskLedgerStore.getState().dismissDelivery(true, blocked);
    assert.equal(useOpenClawTaskLedgerStore.getState().error, 'completion delivery is not blocked');
    assert.equal(useOpenClawTaskLedgerStore.getState().dismissingTaskId, null);
  } finally {
    gateway.dismissTaskDelivery = originalDismiss;
  }
});
