import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawSessionTranscriptSubscription,
  type OpenClawTranscriptTransport,
} from './SessionTranscriptSubscription';

type Call = {
  method: string;
  params: { key: string; agentId?: string };
};

test('serializes OpenClaw transcript unsubscribe and subscribe when selection changes', async () => {
  const calls: Call[] = [];
  const transport: OpenClawTranscriptTransport = {
    request: async (method, params) => {
      calls.push({ method, params });
      return {};
    },
  };
  const subscription = new OpenClawSessionTranscriptSubscription(transport);

  await subscription.synchronize({ sessionKey: 'agent:main:first', agentId: 'main' });
  await subscription.synchronize({ sessionKey: 'agent:writer:second', agentId: 'writer' });
  await subscription.synchronize(null);

  assert.deepEqual(calls, [
    { method: 'sessions.messages.subscribe', params: { key: 'agent:main:first', agentId: 'main' } },
    { method: 'sessions.messages.unsubscribe', params: { key: 'agent:main:first', agentId: 'main' } },
    { method: 'sessions.messages.subscribe', params: { key: 'agent:writer:second', agentId: 'writer' } },
    { method: 'sessions.messages.unsubscribe', params: { key: 'agent:writer:second', agentId: 'writer' } },
  ]);
});

test('transport reset prevents an old in-flight subscription from attaching to a replacement socket', async () => {
  const calls: Call[] = [];
  let resolveFirst!: () => void;
  const transport: OpenClawTranscriptTransport = {
    request: async (method, params) => {
      calls.push({ method, params });
      if (calls.length === 1) {
        await new Promise<void>((resolve) => { resolveFirst = resolve; });
      }
      return {};
    },
  };
  const subscription = new OpenClawSessionTranscriptSubscription(transport);

  const first = subscription.synchronize({ sessionKey: 'agent:main:stale' });
  subscription.resetTransport();
  resolveFirst();
  await first;

  assert.deepEqual(calls, [
    { method: 'sessions.messages.subscribe', params: { key: 'agent:main:stale' } },
  ]);

  await subscription.synchronize({ sessionKey: 'agent:main:fresh' });
  assert.deepEqual(calls.at(-1), {
    method: 'sessions.messages.subscribe',
    params: { key: 'agent:main:fresh' },
  });
});
