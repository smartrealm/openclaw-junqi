import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VoiceWakeGatewayClient,
  VoiceWakeGatewayUnavailableError,
} from './VoiceWakeGatewayClient';
import type { VoiceWakeGatewayEventListener } from './voiceWakeEventBridge';
import type { VoiceWakeRoutingConfig } from '@/types/voiceWake';

function clientWith(
  responses: unknown[],
  options: { connectionId?: string | null; current?: boolean } = {},
) {
  const calls: Array<{ method: string; params: Record<string, unknown>; connectionId: string }> = [];
  const client = new VoiceWakeGatewayClient({
    captureConnectionId: () => options.connectionId === undefined ? 'connection-a' : options.connectionId,
    isConnectionCurrent: () => options.current ?? true,
    requestFenced: async (method, params, connectionId) => {
      calls.push({ method, params, connectionId });
      return responses.shift();
    },
    subscribe: (_listener: VoiceWakeGatewayEventListener) => () => undefined,
  });
  return { client, calls };
}

const routing: VoiceWakeRoutingConfig = {
  version: 1,
  defaultTarget: { mode: 'current' },
  routes: [{ trigger: 'junqi', target: { sessionKey: 'agent:main:main' } }],
  updatedAtMs: 100,
};

test('唤醒词读写始终绑定同一个可信 Gateway 连接', async () => {
  const { client, calls } = clientWith([
    { triggers: ['junqi'] },
    { triggers: ['JARVIS', '你好'] },
  ]);
  assert.deepEqual(await client.getTriggers(), { triggers: ['junqi'] });
  assert.deepEqual(await client.setTriggers(['JARVIS', '你好']), { triggers: ['JARVIS', '你好'] });
  assert.deepEqual(calls, [
    { method: 'voicewake.get', params: {}, connectionId: 'connection-a' },
    {
      method: 'voicewake.set',
      params: { triggers: ['JARVIS', '你好'] },
      connectionId: 'connection-a',
    },
  ]);
});

test('唤醒路由只通过官方保留的方法读取', async () => {
  const { client, calls } = clientWith([{ config: routing }]);
  assert.deepEqual(await client.getRouting(), routing);
  assert.deepEqual(calls, [
    { method: 'voicewake.routing.get', params: {}, connectionId: 'connection-a' },
  ]);
});

test('客户端拒绝畸形响应、缺失连接和请求期间的身份变化', async () => {
  await assert.rejects(
    clientWith([{ triggers: [42] }]).client.getTriggers(),
    (error: unknown) => {
      assert.ok(error instanceof VoiceWakeGatewayUnavailableError);
      assert.equal(error.reason, 'invalid_response');
      return true;
    },
  );
  await assert.rejects(
    clientWith([{ triggers: ['junqi'] }], { connectionId: null }).client.getTriggers(),
    (error: unknown) => {
      assert.ok(error instanceof VoiceWakeGatewayUnavailableError);
      assert.equal(error.reason, 'connection_unavailable');
      return true;
    },
  );
  await assert.rejects(
    clientWith([{ triggers: ['junqi'] }], { current: false }).client.getTriggers(),
    (error: unknown) => {
      assert.ok(error instanceof VoiceWakeGatewayUnavailableError);
      assert.equal(error.reason, 'connection_changed');
      return true;
    },
  );
});
