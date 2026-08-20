import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishOpenClawLegacyProgressPlanEvent,
  publishOpenClawProgressCardEvent,
  subscribeOpenClawLegacyProgressPlanEvents,
  subscribeOpenClawProgressCardEvents,
} from './progressCardEventBridge';

test('只发布结构有效的官方进度卡变更通知', () => {
  const received: Array<{ sessionKey: string; revision: number | null }> = [];
  const unsubscribe = subscribeOpenClawProgressCardEvents((event) => received.push(event));
  try {
    assert.equal(publishOpenClawProgressCardEvent({
      type: 'event',
      event: 'progressCard.changed',
      payload: { sessionKey: 'agent:main:main', revision: 3 },
    }), true);
    assert.equal(publishOpenClawProgressCardEvent({
      type: 'event',
      event: 'progressCard.changed',
      payload: { sessionKey: 'agent:main:main', revision: null },
    }), true);
    assert.equal(publishOpenClawProgressCardEvent({
      type: 'event',
      event: 'progressCard.changed',
      payload: { sessionKey: '', revision: 4 },
    }), true);
    assert.equal(publishOpenClawProgressCardEvent({
      type: 'event',
      event: 'progressCard.changed',
      payload: { sessionKey: 'agent:main:main', revision: 0 },
    }), true);
    assert.equal(publishOpenClawProgressCardEvent({
      type: 'event',
      event: 'progressCard.changed',
      payload: { sessionKey: 'agent:main:main', revision: 1.5 },
    }), true);
    assert.deepEqual(received, [
      { sessionKey: 'agent:main:main', revision: 3 },
      { sessionKey: 'agent:main:main', revision: null },
    ]);
  } finally {
    unsubscribe();
  }
});

test('进度卡事件桥不吞掉无关 Gateway 事件', () => {
  assert.equal(publishOpenClawProgressCardEvent({
    type: 'event',
    event: 'agent',
    payload: {},
  }), false);
});

test('只向订阅者发布已通过协议解码的官方旧计划流', () => {
  const received: Array<{ sessionKey: string; step: string }> = [];
  const unsubscribe = subscribeOpenClawLegacyProgressPlanEvents((event) => {
    received.push({ sessionKey: event.sessionKey, step: event.steps[0]?.step ?? '' });
  });
  try {
    assert.equal(publishOpenClawLegacyProgressPlanEvent({
      runId: 'run-plan',
      seq: 1,
      stream: 'plan',
      ts: 1,
      data: {
        phase: 'update',
        steps: [{ step: '核对协议', status: 'in_progress' }],
      },
    }, 'agent:main:resolved'), true);
    assert.equal(publishOpenClawLegacyProgressPlanEvent({
      runId: 'run-plan',
      seq: 2,
      stream: 'assistant',
      ts: 2,
      data: { text: '正文' },
    }, 'agent:main:resolved'), false);
    assert.deepEqual(received, [{
      sessionKey: 'agent:main:resolved',
      step: '核对协议',
    }]);
  } finally {
    unsubscribe();
  }
});
