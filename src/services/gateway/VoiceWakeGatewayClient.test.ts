import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VoiceWakeGatewayClient,
  VoiceWakeGatewayUnavailableError,
} from './VoiceWakeGatewayClient';
import type { VoiceWakeGatewayEventListener } from './voiceWakeEventBridge';

function clientWith(
  response: unknown,
  options: { connectionId?: string | null; current?: boolean } = {},
) {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new VoiceWakeGatewayClient({
    captureConnectionId: () => options.connectionId === undefined ? 'connection-a' : options.connectionId,
    isConnectionCurrent: () => options.current ?? true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return response;
    },
    subscribe: (_listener: VoiceWakeGatewayEventListener) => () => undefined,
  });
  return { client, calls };
}

test('voice wake client fences trigger reads to the attested Gateway connection', async () => {
  const { client, calls } = clientWith({ triggers: ['junqi'] });
  const snapshot = await client.getTriggers();

  assert.deepEqual(snapshot, { triggers: ['junqi'] });
  assert.deepEqual(calls, [{ method: 'voicewake.get', params: {}, connectionId: 'connection-a' }]);
});

test('voice wake client synchronizes only the supplied trigger list', async () => {
  const { client, calls } = clientWith({ triggers: ['JARVIS', '你好'] });
  const snapshot = await client.setTriggers(['JARVIS', '你好']);

  assert.deepEqual(snapshot, { triggers: ['JARVIS', '你好'] });
  assert.deepEqual(calls, [{
    method: 'voicewake.set',
    params: { triggers: ['JARVIS', '你好'] },
    connectionId: 'connection-a',
  }]);
});

test('voice wake client rejects malformed Gateway payloads instead of defaulting', async () => {
  const { client } = clientWith({ triggers: [42] });
  await assert.rejects(client.getTriggers(), VoiceWakeGatewayUnavailableError);
});

test('voice wake client rejects an empty trigger list that an official Gateway snapshot cannot emit', async () => {
  const { client } = clientWith({ triggers: [] });
  await assert.rejects(client.getTriggers(), VoiceWakeGatewayUnavailableError);
});

test('voice wake client rejects a connection that changes during a request', async () => {
  const { client } = clientWith({ triggers: ['junqi'] }, { current: false });
  await assert.rejects(client.getTriggers(), VoiceWakeGatewayUnavailableError);
});

test('voice wake client decodes routing only when its exact wire contract is present', async () => {
  const response = {
    config: {
      version: 1,
      defaultTarget: { mode: 'current' },
      routes: [{ trigger: 'junqi', target: { sessionKey: 'agent:main:main' } }],
      updatedAtMs: 100,
    },
  };
  const { client } = clientWith(response);
  const routing = await client.getRouting();

  assert.deepEqual(routing.defaultTarget, { mode: 'current' });
  assert.deepEqual(routing.routes[0]?.target, { sessionKey: 'agent:main:main' });
});

test('voice wake client rejects an ambiguous route target instead of choosing a target arbitrarily', async () => {
  const { client } = clientWith({
    config: {
      version: 1,
      defaultTarget: { mode: 'current', agentId: 'main' },
      routes: [],
      updatedAtMs: 100,
    },
  });

  await assert.rejects(client.getRouting(), VoiceWakeGatewayUnavailableError);
});
