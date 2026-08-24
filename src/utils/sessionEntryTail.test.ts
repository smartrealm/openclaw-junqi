import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldPositionActiveSessionTail } from './sessionEntryTail';

test('活动会话切换后只在当前时间线已提交时定位尾部', () => {
  assert.equal(shouldPositionActiveSessionTail({
    activeSessionKey: 'agent:main:history',
    positionedSessionKey: null,
    timelineItemCount: 0,
  }), false);
  assert.equal(shouldPositionActiveSessionTail({
    activeSessionKey: 'agent:main:history',
    positionedSessionKey: null,
    timelineItemCount: 12,
  }), true);
});

test('同一活动会话只执行一次入口定位，会话回退后重新执行', () => {
  assert.equal(shouldPositionActiveSessionTail({
    activeSessionKey: 'agent:main:previous',
    positionedSessionKey: 'agent:main:previous',
    timelineItemCount: 8,
  }), false);
  assert.equal(shouldPositionActiveSessionTail({
    activeSessionKey: 'agent:main:previous',
    positionedSessionKey: 'agent:main:deleted',
    timelineItemCount: 8,
  }), true);
});
