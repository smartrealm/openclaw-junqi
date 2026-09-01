import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseGatewayQuestionEvent,
  subscribeGatewayQuestionEvents,
  publishGatewayQuestionEvent,
} from './questionEventBridge';

test('解析 requested 与 resolved 事件并拒绝无效载荷', () => {
  const requested = parseGatewayQuestionEvent({
    type: 'event',
    event: 'question.requested',
    payload: {
      id: 'question-1',
      questions: [{
        questionId: 'choice',
        header: '选择',
        question: '请选择',
        options: [{ label: 'A' }, { label: 'B' }],
      }],
      createdAtMs: 1,
      expiresAtMs: 2,
      status: 'pending',
    },
  });
  const resolved = parseGatewayQuestionEvent({
    type: 'event',
    event: 'question.resolved',
    payload: { id: 'question-1', status: 'cancelled' },
  });

  assert.equal(requested?.phase, 'requested');
  assert.equal(requested?.question.id, 'question-1');
  assert.deepEqual(resolved, { phase: 'resolved', id: 'question-1', status: 'cancelled' });
  assert.equal(parseGatewayQuestionEvent({
    type: 'event',
    event: 'question.resolved',
    payload: { id: '', status: 'cancelled' },
  }), null);
});

test('主连接问题事件只通知已注册的界面订阅者', () => {
  const received: string[] = [];
  const unsubscribe = subscribeGatewayQuestionEvents((event) => {
    received.push(event.phase);
  });

  publishGatewayQuestionEvent({
    type: 'event',
    event: 'question.resolved',
    payload: { id: 'question-1', status: 'expired' },
  });
  unsubscribe();
  publishGatewayQuestionEvent({
    type: 'event',
    event: 'question.resolved',
    payload: { id: 'question-2', status: 'cancelled' },
  });

  assert.deepEqual(received, ['resolved']);
});
