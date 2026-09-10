import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DingTalkEventSnapshotContent } from './DingTalkEventSnapshotContent';

test('事件快照状态展示运行证据但不展示业务载荷', () => {
  const html = renderToStaticMarkup(createElement(DingTalkEventSnapshotContent, {
    snapshot: {
      phase: 'running',
      activeConsumerCount: 2,
      readyConsumerCount: 2,
      latestSequence: 9,
      droppedCount: 1,
      rejectedCount: 0,
      lastErrorCode: null,
      events: [{
        sequence: 9,
        receivedAt: '2026-09-09T08:00:00.000Z',
        eventType: 'user_todo_task_update',
      }],
    },
    loading: false,
    error: null,
  }));
  assert.match(html, /user_todo_task_update/u);
  assert.match(html, /2026-09-09T08:00:00\.000Z/u);
  assert.match(html, /9/u);
  assert.doesNotMatch(html, /payload|eventId|profileRef/u);
});

test('事件快照读取失败在状态区域展示', () => {
  const html = renderToStaticMarkup(createElement(DingTalkEventSnapshotContent, {
    snapshot: null,
    loading: false,
    error: 'snapshot unavailable',
  }));
  assert.match(html, /snapshot unavailable/u);
  assert.match(html, /role="alert"/u);
});
