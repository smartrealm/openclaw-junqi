import assert from 'node:assert/strict';
import test from 'node:test';
import { TalkConversationCoordinator } from './TalkConversationCoordinator';
import type { TalkGatewayEvent } from '@/services/gateway/talkEventBridge';

test('Talk conversation serializes PCM frames on its attested session', async () => {
  const calls: string[] = [];
  const listeners = new Set<(event: TalkGatewayEvent) => void>();
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: 'talk-1', provider: 'relay' }),
      appendAudio: async (_sessionId, audioBase64) => { calls.push(audioBase64); },
      cancelOutput: async () => undefined,
      close: async () => undefined,
      subscribe: (next) => { listeners.add(next); return () => listeners.delete(next); },
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => undefined,
    now: () => 100,
  });
  await coordinator.start('agent:main:main');
  coordinator.appendPcm({ data: 'first', sampleRateHz: 24_000, channels: 1 });
  coordinator.appendPcm({ data: 'second', sampleRateHz: 24_000, channels: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first', 'second']);
  for (const listener of listeners) {
    listener({
      id: 'event-1', sessionId: 'talk-1', type: 'output.audio.started', seq: 1,
      turnId: null, mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult', payload: {},
      audioBase64: null, relayType: null,
    });
  }
  assert.equal(coordinator.getSnapshot().phase, 'speaking');
  assert.equal(coordinator.getSnapshot().sessionKey, 'agent:main:main');
});

test('Talk interruption stops local output before requesting Gateway cancellation', async () => {
  const calls: string[] = [];
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: 'talk-1', provider: 'relay' }),
      appendAudio: async () => undefined,
      cancelOutput: async () => { calls.push('gateway'); },
      close: async () => undefined,
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => { calls.push('local'); },
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => undefined,
  });
  await coordinator.start('agent:main:main');
  await coordinator.interrupt();
  assert.deepEqual(calls, ['local', 'gateway']);
});

test('Talk relay replacement fences delayed audio from the cancelled output turn', async () => {
  const listeners = new Set<(event: TalkGatewayEvent) => void>();
  const playback: string[] = [];
  let createCount = 0;
  let resolveCancellation: (() => void) | undefined;
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: `talk-${++createCount}`, provider: 'relay' }),
      appendAudio: async () => undefined,
      cancelOutput: () => new Promise<void>((resolve) => { resolveCancellation = resolve; }),
      close: async () => undefined,
      subscribe: (next) => { listeners.add(next); return () => listeners.delete(next); },
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: (audioBase64) => { playback.push(audioBase64); },
    finishOutput: () => { playback.push('finish'); },
    stopOutput: () => undefined,
  });
  const emit = (event: TalkGatewayEvent) => {
    for (const listener of listeners) listener(event);
  };
  const output = (
    type: Extract<TalkGatewayEvent['type'], 'output.audio.delta' | 'output.audio.done'>,
    turnId: string,
    seq: number,
    audioBase64: string | null,
  ): TalkGatewayEvent => ({
    id: `event-${seq}`,
    sessionId: 'talk-1',
    type,
    turnId,
    seq,
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    payload: {},
    audioBase64,
    relayType: null,
  });

  await coordinator.start('agent:main:main');
  emit(output('output.audio.delta', 'turn-old', 1, 'first'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(playback, ['first']);

  const replacement = coordinator.start('agent:main:main');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(resolveCancellation);
  emit(output('output.audio.delta', 'turn-old', 2, 'late-old-audio'));
  emit(output('output.audio.done', 'turn-old', 3, null));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(playback, ['first']);

  resolveCancellation();
  await replacement;
  for (const listener of listeners) {
    listener({
      id: 'event-new',
      sessionId: 'talk-2',
      type: 'output.audio.delta',
      turnId: 'turn-new',
      seq: 1,
      mode: 'realtime',
      transport: 'gateway-relay',
      brain: 'agent-consult',
      payload: {},
      audioBase64: 'new-audio',
      relayType: null,
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(playback, ['first', 'new-audio']);
});

test('Talk session replacement fences the previous client and queued audio', async () => {
  const calls: string[] = [];
  const listeners = new Set<(event: TalkGatewayEvent) => void>();
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: 'talk-replaced', provider: 'relay' }),
      appendAudio: async (_sessionId, audioBase64) => { calls.push(`append:${audioBase64}`); },
      cancelOutput: async () => undefined,
      close: async () => { calls.push('close'); },
      subscribe: (next) => { listeners.add(next); return () => listeners.delete(next); },
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => { calls.push('stop'); },
  });

  await coordinator.start('agent:main:main');
  calls.length = 0;
  for (const listener of listeners) {
    listener({
      id: 'replacement-1',
      sessionId: 'talk-replaced',
      type: 'session.replaced',
      seq: 2,
      turnId: null,
      mode: 'realtime',
      transport: 'gateway-relay',
      brain: 'agent-consult',
      payload: {
        handoffId: 'handoff-1',
        roomId: 'room-1',
        previousClientId: 'client-old',
        nextClientId: 'client-new',
      },
      audioBase64: null,
      relayType: null,
    });
  }

  assert.equal(coordinator.getSnapshot().phase, 'error');
  assert.equal(coordinator.getSnapshot().error, 'talk_session_replaced');
  assert.equal(coordinator.getSnapshot().sessionId, null);
  assert.deepEqual(calls, ['stop']);
  coordinator.appendPcm({ data: 'stale', sampleRateHz: 24_000, channels: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['stop']);
  assert.equal(listeners.size, 0);
});

test('Talk replacement cancels Gateway output after local stop and before closing the prior relay', async () => {
  const calls: string[] = [];
  let count = 0;
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: `talk-${++count}`, provider: 'relay' }),
      appendAudio: async () => undefined,
      cancelOutput: async (sessionId) => { calls.push(`cancel:${sessionId}`); },
      close: async (sessionId) => { calls.push(`close:${sessionId}`); },
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => { calls.push('local'); },
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => { calls.push('output'); },
  });
  await coordinator.start('agent:main:main');
  calls.length = 0;
  await coordinator.start('agent:main:main');
  assert.ok(calls.indexOf('local') >= 0);
  assert.ok(calls.indexOf('output') > calls.indexOf('local'));
  assert.ok(calls.indexOf('cancel:talk-1') > calls.indexOf('output'));
  assert.ok(calls.indexOf('close:talk-1') > calls.indexOf('cancel:talk-1'));
});

test('Talk conversation retains bounded PCM while the relay session is connecting', async () => {
  let resolveSession: ((value: { sessionId: string; provider: string }) => void) | undefined;
  const appended: string[] = [];
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: () => new Promise((resolve) => { resolveSession = resolve; }),
      appendAudio: async (_sessionId, audioBase64) => { appended.push(audioBase64); },
      cancelOutput: async () => undefined,
      close: async () => undefined,
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => undefined,
  });
  const start = coordinator.start('agent:main:main');
  // Capture can begin in the same event turn as a verified keyword. It must
  // survive the output cleanup that runs before relay creation.
  coordinator.appendPcm({ data: 'opening', sampleRateHz: 24_000, channels: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(resolveSession);
  resolveSession({ sessionId: 'talk-1', provider: 'relay' });
  await start;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(appended, ['opening']);
});

test('Talk opening can be awaited before choosing the WAV fallback path', async () => {
  let resolveSession: ((value: { sessionId: string; provider: string }) => void) | undefined;
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: () => new Promise((resolve) => { resolveSession = resolve; }),
      appendAudio: async () => undefined,
      cancelOutput: async () => undefined,
      close: async () => undefined,
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => undefined,
  });
  const opening = coordinator.start('agent:main:main');
  const waiting = coordinator.waitForOpening();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(resolveSession);
  resolveSession({ sessionId: 'talk-1', provider: 'relay' });

  assert.equal((await waiting)?.sessionId, 'talk-1');
  assert.equal((await opening).sessionId, 'talk-1');
});

test('stopping an opening relay discards its buffered PCM before any later session', async () => {
  let resolveSession: ((value: { sessionId: string; provider: string }) => void) | undefined;
  const appended: string[] = [];
  let createCount = 0;
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: () => {
        createCount += 1;
        if (createCount === 1) return new Promise((resolve) => { resolveSession = resolve; });
        return Promise.resolve({ sessionId: 'talk-new', provider: 'relay' });
      },
      appendAudio: async (_sessionId, audioBase64) => { appended.push(audioBase64); },
      cancelOutput: async () => undefined,
      close: async () => undefined,
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => undefined,
  });
  const first = coordinator.start('agent:main:main');
  coordinator.appendPcm({ data: 'discard-me', sampleRateHz: 24_000, channels: 1 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(resolveSession);
  await coordinator.stop();
  resolveSession({ sessionId: 'talk-old', provider: 'relay' });
  await first;

  await coordinator.start('agent:main:main');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(appended, []);
});

test('a stale Talk session creation cannot replace a newer trigger', async () => {
  const resolvers: Array<(value: { sessionId: string; provider: string }) => void> = [];
  const closed: string[] = [];
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: () => new Promise((resolve) => resolvers.push(resolve)),
      appendAudio: async () => undefined,
      cancelOutput: async () => undefined,
      close: async (sessionId) => { closed.push(sessionId); },
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: () => undefined,
    finishOutput: () => undefined,
    stopOutput: () => undefined,
  });
  const first = coordinator.start('agent:main:main');
  const second = coordinator.start('agent:main:main');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolvers.length, 2);
  resolvers[1]({ sessionId: 'talk-new', provider: 'relay' });
  await second;
  resolvers[0]({ sessionId: 'talk-old', provider: 'relay' });
  await first;
  assert.equal(coordinator.getSnapshot().sessionId, 'talk-new');
  assert.deepEqual(closed, ['talk-old']);
});

test('Talk output serializes PCM playback and waits for the native queue to drain', async () => {
  const calls: string[] = [];
  const listeners = new Set<(event: TalkGatewayEvent) => void>();
  const resolvers = new Map<string, () => void>();
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: 'talk-1', provider: 'relay' }),
      appendAudio: async () => undefined,
      cancelOutput: async () => undefined,
      close: async () => undefined,
      subscribe: (next) => { listeners.add(next); return () => listeners.delete(next); },
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: (audioBase64) => new Promise<void>((resolve) => {
      calls.push(audioBase64);
      resolvers.set(audioBase64, resolve);
    }),
    finishOutput: () => { calls.push('finish'); },
    stopOutput: () => undefined,
  });
  const emit = (event: TalkGatewayEvent) => {
    for (const listener of listeners) listener(event);
  };
  const outputEvent = (type: TalkGatewayEvent['type'], audioBase64: string | null): TalkGatewayEvent => ({
    id: `event-${type}`, sessionId: 'talk-1', type, seq: 1, turnId: null,
    mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult', payload: {}, audioBase64, relayType: null,
  });

  await coordinator.start('agent:main:main');
  emit(outputEvent('output.audio.delta', 'first'));
  emit(outputEvent('output.audio.delta', 'second'));
  emit(outputEvent('output.audio.done', null));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first']);
  assert.equal(coordinator.getSnapshot().phase, 'speaking');

  const first = resolvers.get('first');
  assert.ok(first);
  first();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first', 'second']);

  const second = resolvers.get('second');
  assert.ok(second);
  second();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first', 'second', 'finish']);
  assert.equal(coordinator.getSnapshot().phase, 'listening');
});

test('stopping Talk output fences PCM that was queued behind an interrupted frame', async () => {
  const calls: string[] = [];
  const listeners = new Set<(event: TalkGatewayEvent) => void>();
  let resolveFirst: (() => void) | undefined;
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: 'talk-1', provider: 'relay' }),
      appendAudio: async () => undefined,
      cancelOutput: async () => undefined,
      close: async () => undefined,
      subscribe: (next) => { listeners.add(next); return () => listeners.delete(next); },
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => undefined,
    playOutput: (audioBase64) => new Promise<void>((resolve) => {
      calls.push(audioBase64);
      if (audioBase64 === 'first') resolveFirst = resolve;
    }),
    finishOutput: () => { calls.push('finish'); },
    stopOutput: () => { calls.push('stop'); },
  });
  const emit = (audioBase64: string) => {
    for (const listener of listeners) {
      listener({
        id: `event-${audioBase64}`, sessionId: 'talk-1', type: 'output.audio.delta', seq: 1,
        turnId: null, mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult', payload: {},
        audioBase64, relayType: null,
      });
    }
  };

  await coordinator.start('agent:main:main');
  calls.length = 0;
  emit('first');
  emit('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first']);
  await coordinator.stop();
  assert.ok(resolveFirst);
  resolveFirst();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first', 'stop']);
});
