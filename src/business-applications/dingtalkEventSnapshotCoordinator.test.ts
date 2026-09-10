import assert from 'node:assert/strict';
import test from 'node:test';
import type { DingTalkEventConfiguration } from './dingtalkEventConfiguration';
import {
  assertDingTalkEventSnapshotContext,
  canonicalDingTalkEventConfiguration,
  createDingTalkEventSnapshotReadContext,
  digestDingTalkEventConfiguration,
  DingTalkEventSnapshotContextError,
  DingTalkEventSnapshotRequestCoordinator,
  selectDingTalkEventConfigurationForConnection,
} from './dingtalkEventSnapshotCoordinator';

const RUNTIME_GENERATION = '11111111-1111-4111-8111-111111111111';
const CONFIGURATION_DIGEST = 'cb4f96afd4d5db6d93f4659a234f560fc15b589ca776b62e603e80a743416510';

const configuration: DingTalkEventConfiguration = {
  enabled: true,
  profile: 'corp-a:user-a',
  bufferSize: 100,
  subscriptions: [
    {
      category: 'todo',
      eventKeys: ['user_todo_task_update', 'user_todo_task_create'],
      roleTypes: ['executor'],
    },
    {
      category: 'todo',
      eventKeys: ['user_todo_task_update'],
      roleTypes: ['creator'],
    },
  ],
};

function context(minimumRevision: number | null = 25) {
  const result = createDingTalkEventSnapshotReadContext({
    connectionId: 'connection-a',
    configuration,
    minimumRevision,
    runtimeGeneration: RUNTIME_GENERATION,
    invalidationConfigurationDigest: CONFIGURATION_DIGEST,
  });
  if (!result) throw new Error('测试事件快照上下文无效');
  return result;
}

function snapshot() {
  return {
    runtimeGeneration: RUNTIME_GENERATION,
    configurationDigest: CONFIGURATION_DIGEST,
    configured: true,
    phase: 'running' as const,
    profileRef: 'corp-a:user-a',
    subscriptionCount: 2,
    activeConsumerCount: 2,
    readyConsumerCount: 2,
    eventKeys: ['user_todo_task_create', 'user_todo_task_update'],
    contractDigest: 'a'.repeat(64),
    latestSequence: 26,
    oldestSequence: 12,
    droppedCount: 0,
    rejectedCount: 0,
    lastErrorCode: null,
    events: [{
      sequence: 26,
      receivedAt: '2026-09-09T08:00:00.000Z',
      eventType: 'user_todo_task_update',
    }],
  };
}

test('事件快照读取上下文绑定连接、完整配置、运行代际和通知修订', async () => {
  const current = context();
  assert.equal(current.afterSequence, 5);
  assert.equal(
    canonicalDingTalkEventConfiguration(configuration),
    '["corp-a:user-a",100,[[["user_todo_task_update","user_todo_task_create"],null,null,null,["executor"]],[["user_todo_task_update"],null,null,null,["creator"]]]]',
  );
  assert.equal(current.configurationCanonical, canonicalDingTalkEventConfiguration(configuration));
  assert.equal(
    await digestDingTalkEventConfiguration(current.configurationCanonical),
    CONFIGURATION_DIGEST,
  );
  assert.deepEqual(current.eventKeys, [
    'user_todo_task_create',
    'user_todo_task_update',
  ]);
  assert.equal(createDingTalkEventSnapshotReadContext({
    connectionId: 'connection-a',
    configuration: { ...configuration, enabled: false },
    minimumRevision: null,
    runtimeGeneration: null,
    invalidationConfigurationDigest: null,
  }), null);
  assert.equal(createDingTalkEventSnapshotReadContext({
    connectionId: 'connection-a',
    configuration,
    minimumRevision: 0,
    runtimeGeneration: RUNTIME_GENERATION,
    invalidationConfigurationDigest: CONFIGURATION_DIGEST,
  }), null);
});

test('旧连接读取的配置不能驱动新 Gateway 连接上的事件快照', () => {
  assert.equal(selectDingTalkEventConfigurationForConnection(
    configuration,
    'connection-a',
    'connection-a',
  ), configuration);
  assert.equal(selectDingTalkEventConfigurationForConnection(
    configuration,
    'connection-a',
    'connection-b',
  ), null);
  assert.equal(selectDingTalkEventConfigurationForConnection(
    configuration,
    null,
    'connection-a',
  ), null);
});

test('事件快照只接受当前完整配置、运行代际和已到达修订', () => {
  assert.doesNotThrow(() => assertDingTalkEventSnapshotContext(
    snapshot(),
    context(),
    CONFIGURATION_DIGEST,
  ));
  for (const value of [
    { ...snapshot(), runtimeGeneration: '22222222-2222-4222-8222-222222222222' },
    { ...snapshot(), configurationDigest: 'c'.repeat(64) },
    { ...snapshot(), configured: false },
    { ...snapshot(), profileRef: 'corp-b:user-b' },
    { ...snapshot(), subscriptionCount: 1 },
    { ...snapshot(), eventKeys: ['user_todo_task_update'] },
    { ...snapshot(), latestSequence: 24 },
  ]) {
    assert.throws(
      () => assertDingTalkEventSnapshotContext(value, context(), CONFIGURATION_DIGEST),
      DingTalkEventSnapshotContextError,
    );
  }
});

test('请求协调器拒绝旧连接、旧配置和旧修订的迟到结果', () => {
  const coordinator = new DingTalkEventSnapshotRequestCoordinator();
  const firstContext = context(25);
  const first = coordinator.begin(firstContext);
  assert.equal(coordinator.accepts(first, firstContext), true);

  const newerContext = context(26);
  const second = coordinator.begin(newerContext);
  assert.equal(coordinator.accepts(first, firstContext), false);
  assert.equal(coordinator.accepts(second, firstContext), false);
  assert.equal(coordinator.accepts(second, newerContext), true);

  const changedTargetContext = createDingTalkEventSnapshotReadContext({
    connectionId: 'connection-a',
    configuration: {
      ...configuration,
      subscriptions: [
        { ...configuration.subscriptions[0]!, roleTypes: ['participant'] },
        configuration.subscriptions[1]!,
      ],
    },
    minimumRevision: 26,
    runtimeGeneration: RUNTIME_GENERATION,
    invalidationConfigurationDigest: CONFIGURATION_DIGEST,
  });
  if (!changedTargetContext) throw new Error('变更目标后的测试事件快照上下文无效');
  assert.notEqual(changedTargetContext.key, newerContext.key);
  assert.equal(coordinator.accepts(second, changedTargetContext), false);

  const replacedRuntimeContext = createDingTalkEventSnapshotReadContext({
    connectionId: 'connection-a',
    configuration,
    minimumRevision: 26,
    runtimeGeneration: '22222222-2222-4222-8222-222222222222',
    invalidationConfigurationDigest: CONFIGURATION_DIGEST,
  });
  if (!replacedRuntimeContext) throw new Error('替换运行代际后的测试上下文无效');
  assert.notEqual(replacedRuntimeContext.key, newerContext.key);
  assert.equal(coordinator.accepts(second, replacedRuntimeContext), false);

  coordinator.invalidate();
  assert.equal(coordinator.accepts(second, newerContext), false);
});
