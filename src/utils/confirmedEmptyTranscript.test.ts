import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasConfirmedEmptyTranscript,
  shouldLoadActiveSessionHistory,
  shouldWarmUpHistoryBeforeFirstSend,
} from './confirmedEmptyTranscript';

const EMPTY_SESSION = {
  key: 'agent:architect:session-1',
  sessionId: 'session-1',
  agentId: 'architect',
  activeLeafEntryId: null,
} as const;

test('已确认的空 transcript 必须同时绑定会话 key、sessionId 和 agentId', () => {
  assert.equal(hasConfirmedEmptyTranscript(EMPTY_SESSION), true);
  assert.equal(hasConfirmedEmptyTranscript({ ...EMPTY_SESSION, agentId: '  ' }), false);
  assert.equal(hasConfirmedEmptyTranscript({ ...EMPTY_SESSION, sessionId: undefined }), false);
  assert.equal(hasConfirmedEmptyTranscript({ ...EMPTY_SESSION, activeLeafEntryId: undefined }), false);
  assert.equal(hasConfirmedEmptyTranscript({ ...EMPTY_SESSION, activeLeafEntryId: 'leaf-1' }), false);
});

test('已确认空会话不读取首屏历史且首发不预热，未知 transcript 保持原有读取策略', () => {
  assert.equal(shouldLoadActiveSessionHistory({
    previousSessionKey: 'agent:architect:session-1',
    activeSessionKey: 'agent:architect:session-1',
    messageCount: 0,
    confirmedEmptyTranscript: true,
  }), false);
  assert.equal(shouldWarmUpHistoryBeforeFirstSend({
    messageCount: 0,
    confirmedEmptyTranscript: true,
  }), false);
  assert.equal(shouldLoadActiveSessionHistory({
    previousSessionKey: 'agent:main:previous',
    activeSessionKey: 'agent:architect:session-1',
    messageCount: 0,
    confirmedEmptyTranscript: false,
  }), true);
  assert.equal(shouldWarmUpHistoryBeforeFirstSend({
    messageCount: 0,
    confirmedEmptyTranscript: false,
  }), true);
});
