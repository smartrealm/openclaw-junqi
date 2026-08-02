import assert from 'node:assert/strict';
import test from 'node:test';
import { TalkGatewayClient, TalkGatewayUnavailableError } from './TalkGatewayClient';
import type { TalkEventListener } from './talkEventBridge';

function catalog() {
  return {
    modes: ['realtime', 'stt-tts', 'transcription'],
    transports: ['webrtc', 'provider-websocket', 'gateway-relay', 'managed-room'],
    brains: ['agent-consult', 'direct-tools', 'none'],
    speech: {
      providers: [],
    },
    transcription: {
      ready: false,
      providers: [],
    },
    realtime: {
      ready: true,
      activeProvider: 'relay-provider',
      providers: [{
        id: 'relay-provider', label: 'Relay provider', configured: true,
        modes: ['realtime'], transports: ['gateway-relay'], brains: ['agent-consult'],
        inputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24000, channels: 1 }],
        outputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24000, channels: 1 }],
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
  const { client } = harness([{
    ...catalog(),
    realtime: { ready: false, providers: [] },
  }]);
  await assert.rejects(client.createRealtimeRelay('agent:main:main'), TalkGatewayUnavailableError);
});

test('Talk client rejects a provider without the native output format contract', async () => {
  const unplayableCatalog = catalog();
  unplayableCatalog.realtime.providers[0].outputAudioFormats = [{ encoding: 'pcm16', sampleRateHz: 16000, channels: 1 }];
  const { client } = harness([unplayableCatalog]);
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
