import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publishTalkGatewayEvent,
  subscribeTalkGatewayEvents,
  subscribeTalkRelayEvents,
  type TalkRelayEvent,
} from './talkEventBridge';

function canonicalEvent(
  sessionId: string,
  seq: number,
  type = 'output.audio.delta',
  payload: unknown = {},
) {
  return {
    id: `${sessionId}-${seq}`,
    type,
    sessionId,
    turnId: `turn-${seq}`,
    seq,
    timestamp: '2026-08-02T00:00:00.000Z',
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    payload,
  };
}

function audioEvent(sessionId: string, seq: number) {
  return {
    type: 'event',
    event: 'talk.event',
    payload: {
      relaySessionId: sessionId,
      type: 'audio',
      audioBase64: 'AA==',
      talkEvent: canonicalEvent(sessionId, seq),
    },
  };
}

test('Talk 事件桥按会话单调序列仅投递一次规范事件和中继音频', () => {
  const canonicalSequences: number[] = [];
  const relayTypes: string[] = [];
  const unsubscribeCanonical = subscribeTalkGatewayEvents((value) => canonicalSequences.push(value.seq));
  const unsubscribeRelay = subscribeTalkRelayEvents((value) => relayTypes.push(value.type));
  try {
    assert.equal(publishTalkGatewayEvent(audioEvent('talk-event-test-a', 1)), true);
    assert.equal(publishTalkGatewayEvent(audioEvent('talk-event-test-a', 1)), true);
    assert.equal(publishTalkGatewayEvent(audioEvent('talk-event-test-a', 2)), true);
    assert.deepEqual(canonicalSequences, [1, 2]);
    assert.deepEqual(relayTypes, ['audio', 'audio']);
  } finally {
    unsubscribeCanonical();
    unsubscribeRelay();
  }
});

test('Talk 事件桥消费畸形信封且不把它路由为聊天事件', () => {
  assert.equal(publishTalkGatewayEvent({
    type: 'event',
    event: 'talk.event',
    payload: { talkEvent: { sessionId: 'missing-fields' } },
  }), true);
  assert.equal(publishTalkGatewayEvent(audioEvent('talk-event-invalid-seq', 0)), true);
  assert.equal(publishTalkGatewayEvent({ type: 'event', event: 'agent', payload: {} }), false);
});

test('Talk 事件桥严格投影官方中继工具生命周期', () => {
  const received: string[] = [];
  const unsubscribe = subscribeTalkRelayEvents((value) => {
    if ('callId' in value) received.push(`${value.type}:${value.callId}`);
  });
  try {
    assert.equal(publishTalkGatewayEvent({
      type: 'event',
      event: 'talk.event',
      payload: {
        relaySessionId: 'talk-tool-session',
        type: 'toolCall',
        callId: 'call-1',
        name: 'openclaw_agent_consult',
        args: { question: '检查' },
        talkEvent: {
          ...canonicalEvent(
            'talk-tool-session',
            1,
            'tool.call',
            { name: 'openclaw_agent_consult', args: { question: '检查' } },
          ),
          callId: 'call-1',
        },
      },
    }), true);
    assert.equal(publishTalkGatewayEvent({
      type: 'event',
      event: 'talk.event',
      payload: {
        relaySessionId: 'talk-tool-session',
        type: 'toolCallCancelled',
        callId: 'call-1',
      },
    }), true);
    assert.deepEqual(received, ['toolCall:call-1', 'toolCallCancelled:call-1']);
  } finally {
    unsubscribe();
  }
});

test('Talk 事件桥拒绝中继与规范事件身份错配', () => {
  const received: TalkRelayEvent[] = [];
  const canonicalReceived: string[] = [];
  const unsubscribeRelay = subscribeTalkRelayEvents((value) => received.push(value));
  const unsubscribeCanonical = subscribeTalkGatewayEvents((value) => canonicalReceived.push(value.sessionId));
  try {
    publishTalkGatewayEvent({
      type: 'event',
      event: 'talk.event',
      payload: {
        relaySessionId: 'talk-outer-session',
        type: 'audio',
        audioBase64: 'AA==',
        talkEvent: canonicalEvent('talk-inner-session', 1),
      },
    });
    assert.deepEqual(canonicalReceived, []);
    assert.deepEqual(received, [{
      type: 'protocolError',
      relaySessionId: 'talk-outer-session',
      issue: 'identity',
    }]);
  } finally {
    unsubscribeRelay();
    unsubscribeCanonical();
  }
});

test('Talk 事件桥校验播放标记并保留无规范事件的官方 clear', () => {
  const received: TalkRelayEvent[] = [];
  const unsubscribe = subscribeTalkRelayEvents((value) => received.push(value));
  try {
    publishTalkGatewayEvent({
      type: 'event',
      event: 'talk.event',
      payload: {
        relaySessionId: 'talk-media-session',
        type: 'mark',
        markName: 'mark-1',
        talkEvent: canonicalEvent(
          'talk-media-session',
          1,
          'output.audio.done',
          { markName: 'mark-1' },
        ),
      },
    });
    publishTalkGatewayEvent({
      type: 'event',
      event: 'talk.event',
      payload: { relaySessionId: 'talk-media-session', type: 'clear' },
    });
    publishTalkGatewayEvent({
      type: 'event',
      event: 'talk.event',
      payload: {
        relaySessionId: 'talk-media-session',
        type: 'mark',
        markName: 'outer-mark',
        talkEvent: canonicalEvent(
          'talk-media-session',
          2,
          'output.audio.done',
          { markName: 'inner-mark' },
        ),
      },
    });
    assert.deepEqual(received, [
      {
        type: 'mark',
        relaySessionId: 'talk-media-session',
        turnId: 'turn-1',
        markName: 'mark-1',
      },
      { type: 'clear', relaySessionId: 'talk-media-session', turnId: null },
      { type: 'protocolError', relaySessionId: 'talk-media-session', issue: 'mark' },
    ]);
  } finally {
    unsubscribe();
  }
});
