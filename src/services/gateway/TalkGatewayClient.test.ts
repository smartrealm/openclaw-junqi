import assert from 'node:assert/strict';
import test from 'node:test';
import { TalkGatewayClient, TalkGatewayUnavailableError } from './TalkGatewayClient';
import type { TalkEventListener } from './talkEventBridge';

function catalog() {
  return {
    speech: {
      ready: true,
      providers: [{
        id: 'relay-provider', configured: true,
        modes: ['realtime'], transports: ['gateway-relay'], brains: ['agent-consult'],
        inputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24000, channels: 1 }],
        supportsBargeIn: true,
      }],
    },
  };
}

function harness(responses: unknown[]) {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new TalkGatewayClient({
    captureConnectionId: () => 'connection-a',
    isConnectionCurrent: () => true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
    subscribe: (_listener: TalkEventListener) => () => undefined,
  });
  return { client, calls };
}

test('Talk client creates only the advertised realtime relay session shape', async () => {
  const { client, calls } = harness([
    catalog(),
    { sessionId: 'talk-1', provider: 'relay-provider', mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult' },
  ]);
  const session = await client.createRealtimeRelay('agent:main:main');
  assert.deepEqual(session, { sessionId: 'talk-1', provider: 'relay-provider' });
  assert.deepEqual(calls.map((call) => call.method), ['talk.catalog', 'talk.session.create']);
  assert.deepEqual(calls[1]?.params, {
    sessionKey: 'agent:main:main', provider: 'relay-provider', mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult',
  });
});

test('Talk client rejects a catalog that is not explicitly ready', async () => {
  const { client } = harness([{ speech: { providers: [] } }]);
  await assert.rejects(client.createRealtimeRelay('agent:main:main'), TalkGatewayUnavailableError);
});

test('Talk client uses the official barge-in cancellation contract', async () => {
  const { client, calls } = harness([{}]);
  await client.cancelOutput('talk-1');
  assert.deepEqual(calls, [{
    method: 'talk.session.cancelOutput',
    params: { sessionId: 'talk-1', reason: 'barge-in' },
    connectionId: 'connection-a',
  }]);
});
