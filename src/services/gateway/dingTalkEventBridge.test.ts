import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DINGTALK_EVENTS_CHANGED_GATEWAY_EVENT,
  getLatestDingTalkEventInvalidation,
  routeDingTalkGatewayEvent,
  subscribeDingTalkEventInvalidations,
} from './dingTalkEventBridge';

const RUNTIME_GENERATION = '11111111-1111-4111-8111-111111111111';
const CONFIGURATION_DIGEST = 'b'.repeat(64);

function event(payload: unknown): unknown {
  return {
    type: 'event',
    event: DINGTALK_EVENTS_CHANGED_GATEWAY_EVENT,
    payload,
  };
}

function validEvent(revision: number, eventType = 'user_todo_task_update'): unknown {
  return event({
    revision,
    eventType,
    runtimeGeneration: RUNTIME_GENERATION,
    configurationDigest: CONFIGURATION_DIGEST,
  });
}

test('钉钉事件通知绑定当前 Gateway 连接并通知订阅者', () => {
  let notifications = 0;
  let fallbackCalls = 0;
  const unsubscribe = subscribeDingTalkEventInvalidations(() => { notifications += 1; });
  try {
    routeDingTalkGatewayEvent(
      validEvent(7),
      'connection-a',
      () => { fallbackCalls += 1; },
    );
  } finally {
    unsubscribe();
  }

  assert.deepEqual(getLatestDingTalkEventInvalidation(), {
    connectionId: 'connection-a',
    runtimeGeneration: RUNTIME_GENERATION,
    configurationDigest: CONFIGURATION_DIGEST,
    revision: 7,
    eventType: 'user_todo_task_update',
  });
  assert.equal(notifications, 1);
  assert.equal(fallbackCalls, 0);
});

test('保留事件的无效载荷失败关闭且不污染通用路由', () => {
  const before = getLatestDingTalkEventInvalidation();
  let notifications = 0;
  let fallbackCalls = 0;
  const unsubscribe = subscribeDingTalkEventInvalidations(() => { notifications += 1; });
  const malformed = [
    null,
    {},
    { revision: 0, eventType: null },
    { revision: 1.5, eventType: null },
    { revision: 2, eventType: '' },
    { revision: 2, eventType: ' user_todo_task_update ' },
    { revision: 3, eventType: 3 },
    { revision: 4, eventType: null, raw: { private: true } },
    { revision: 5, eventType: 'user_todo_task_update' },
    {
      revision: 6,
      eventType: 'user_todo_task_update',
      runtimeGeneration: 'bad',
      configurationDigest: CONFIGURATION_DIGEST,
    },
  ];
  try {
    for (const payload of malformed) {
      assert.doesNotThrow(() => routeDingTalkGatewayEvent(
        event(payload),
        'connection-a',
        () => { fallbackCalls += 1; },
      ));
    }
    routeDingTalkGatewayEvent(validEvent(8), null, () => {
      fallbackCalls += 1;
    });
  } finally {
    unsubscribe();
  }

  assert.equal(getLatestDingTalkEventInvalidation(), before);
  assert.equal(notifications, 0);
  assert.equal(fallbackCalls, 0);
});

test('无关事件继续路由且监听器失败互相隔离', () => {
  const unrelated = { type: 'event', event: 'sessions.changed', payload: {} };
  let fallbackMessage: unknown;
  routeDingTalkGatewayEvent(unrelated, 'connection-a', (message) => {
    fallbackMessage = message;
  });
  assert.equal(fallbackMessage, unrelated);

  let healthyCalls = 0;
  const removeThrowing = subscribeDingTalkEventInvalidations(() => {
    throw new Error('listener failed');
  });
  const removeHealthy = subscribeDingTalkEventInvalidations(() => { healthyCalls += 1; });
  try {
    assert.doesNotThrow(() => routeDingTalkGatewayEvent(
      validEvent(9),
      'connection-b',
      () => {},
    ));
  } finally {
    removeThrowing();
    removeThrowing();
    removeHealthy();
  }
  assert.equal(healthyCalls, 1);
});

test('同一运行代际拒绝重复、倒退和配置摘要漂移但允许新代际从一开始', () => {
  const connectionId = 'connection-generation';
  routeDingTalkGatewayEvent(validEvent(7), connectionId, () => {});
  routeDingTalkGatewayEvent(validEvent(7), connectionId, () => {});
  routeDingTalkGatewayEvent(validEvent(6), connectionId, () => {});
  routeDingTalkGatewayEvent(event({
    revision: 8,
    eventType: 'user_todo_task_update',
    runtimeGeneration: RUNTIME_GENERATION,
    configurationDigest: 'c'.repeat(64),
  }), connectionId, () => {});
  assert.deepEqual(getLatestDingTalkEventInvalidation(), {
    connectionId,
    runtimeGeneration: RUNTIME_GENERATION,
    configurationDigest: CONFIGURATION_DIGEST,
    revision: 7,
    eventType: 'user_todo_task_update',
  });

  const replacementGeneration = '22222222-2222-4222-8222-222222222222';
  routeDingTalkGatewayEvent(event({
    revision: 1,
    eventType: 'user_todo_task_create',
    runtimeGeneration: replacementGeneration,
    configurationDigest: 'c'.repeat(64),
  }), connectionId, () => {});
  assert.deepEqual(getLatestDingTalkEventInvalidation(), {
    connectionId,
    runtimeGeneration: replacementGeneration,
    configurationDigest: 'c'.repeat(64),
    revision: 1,
    eventType: 'user_todo_task_create',
  });
});
