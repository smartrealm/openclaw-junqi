import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENCLAW_DINGTALK_EVENT_SNAPSHOT_METHOD,
  OpenClawDingTalkEventClient,
  OpenClawDingTalkEventResponseError,
  OpenClawDingTalkEventUnavailableError,
  parseOpenClawDingTalkEventSnapshot,
} from './OpenClawDingTalkEventClient';

function snapshot() {
  return {
    runtimeGeneration: '11111111-1111-4111-8111-111111111111',
    configurationDigest: 'b'.repeat(64),
    configured: true,
    phase: 'running',
    profileRef: 'corp:user',
    subscriptionCount: 2,
    activeConsumerCount: 2,
    readyConsumerCount: 2,
    eventKeys: ['user_todo_task_create', 'user_todo_task_update'],
    contractDigest: 'a'.repeat(64),
    latestSequence: 4,
    oldestSequence: 2,
    droppedCount: 1,
    rejectedCount: 0,
    lastErrorCode: null,
    events: [{
      sequence: 4,
      receivedAt: '2026-09-09T08:00:00.000Z',
      eventType: 'user_todo_task_update',
    }],
  };
}

test('严格解码钉钉事件操作员快照', () => {
  assert.deepEqual(parseOpenClawDingTalkEventSnapshot(snapshot()), snapshot());
  for (const value of [
    { ...snapshot(), extra: true },
    { ...snapshot(), phase: 'ready' },
    { ...snapshot(), runtimeGeneration: 'bad' },
    { ...snapshot(), configurationDigest: 'bad' },
    { ...snapshot(), activeConsumerCount: 3 },
    { ...snapshot(), readyConsumerCount: 3 },
    { ...snapshot(), contractDigest: 'bad' },
    { ...snapshot(), configured: false },
    { ...snapshot(), subscriptionCount: 0, activeConsumerCount: 0, readyConsumerCount: 0 },
    { ...snapshot(), latestSequence: 0 },
    { ...snapshot(), oldestSequence: null },
    { ...snapshot(), eventKeys: ['user_todo_task_update', 'user_todo_task_update'] },
    { ...snapshot(), events: [] },
    { ...snapshot(), events: [{ ...snapshot().events[0], eventType: 'other' }] },
    { ...snapshot(), events: [{ ...snapshot().events[0], payload: { secret: true } }] },
  ]) {
    assert.throws(
      () => parseOpenClawDingTalkEventSnapshot(value),
      OpenClawDingTalkEventResponseError,
    );
  }
  assert.throws(
    () => parseOpenClawDingTalkEventSnapshot(snapshot(), 4),
    OpenClawDingTalkEventResponseError,
  );
});

test('通过当前已核验连接和 operator.read RPC 读取事件快照', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new OpenClawDingTalkEventClient({
    captureConnectionId: () => 'connection-1',
    isConnectionCurrent: (connectionId) => connectionId === 'connection-1',
    async requestFenced(method, params, connectionId) {
      calls.push({ method, params, connectionId });
      return snapshot();
    },
  });
  assert.deepEqual(await client.get(3, 1), snapshot());
  assert.deepEqual(calls, [{
    method: OPENCLAW_DINGTALK_EVENT_SNAPSHOT_METHOD,
    params: { afterSequence: 3, limit: 1 },
    connectionId: 'connection-1',
  }]);
});

test('连接缺失或读取期间变化时不发布事件快照', async () => {
  const unavailable = new OpenClawDingTalkEventClient({
    captureConnectionId: () => null,
    isConnectionCurrent: () => false,
    async requestFenced() {
      throw new Error('不应调用');
    },
  });
  await assert.rejects(() => unavailable.get(), OpenClawDingTalkEventUnavailableError);

  let current = true;
  const changed = new OpenClawDingTalkEventClient({
    captureConnectionId: () => 'connection-1',
    isConnectionCurrent: () => current,
    async requestFenced() {
      current = false;
      return snapshot();
    },
  });
  await assert.rejects(() => changed.get(), OpenClawDingTalkEventUnavailableError);
});
