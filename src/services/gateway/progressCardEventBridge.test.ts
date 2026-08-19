import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishOpenClawProgressCardEvent,
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
      payload: { sessionKey: '', revision: 4 },
    }), true);
    assert.deepEqual(received, [{ sessionKey: 'agent:main:main', revision: 3 }]);
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
