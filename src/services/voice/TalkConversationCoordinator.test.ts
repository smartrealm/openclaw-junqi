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
    stopOutput: () => undefined,
  });
  await coordinator.start('agent:main:main');
  await coordinator.interrupt();
  assert.deepEqual(calls, ['local', 'gateway']);
});

test('Talk replacement clears native output before closing the prior relay', async () => {
  const calls: string[] = [];
  let count = 0;
  const coordinator = new TalkConversationCoordinator({
    client: {
      createRealtimeRelay: async () => ({ sessionId: `talk-${++count}`, provider: 'relay' }),
      appendAudio: async () => undefined,
      cancelOutput: async () => undefined,
      close: async (sessionId) => { calls.push(`close:${sessionId}`); },
      subscribe: () => () => undefined,
    },
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    interruptLocalOutput: () => { calls.push('local'); },
    playOutput: () => undefined,
    stopOutput: () => { calls.push('output'); },
  });
  await coordinator.start('agent:main:main');
  calls.length = 0;
  await coordinator.start('agent:main:main');
  assert.deepEqual(calls.slice(0, 3), ['local', 'output', 'output']);
  assert.equal(calls.includes('close:talk-1'), true);
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
    stopOutput: () => undefined,
  });
  const start = coordinator.start('agent:main:main');
  coordinator.appendPcm({ data: 'opening', sampleRateHz: 24_000, channels: 1 });
  resolveSession?.({ sessionId: 'talk-1', provider: 'relay' });
  await start;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(appended, ['opening']);
});
