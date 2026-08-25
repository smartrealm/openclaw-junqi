import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dispatchGatewayChatMessage,
} from './index';
import type { GatewayRequestParams } from './Connection';

test('普通发送不会改写会话推理可见性或队列策略', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  const result = await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'run-1' };
      },
    },
    {
      message: 'continue the task',
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-1',
    },
  );

  assert.deepEqual(result, { runId: 'run-1' });
  assert.deepEqual(requests, [{
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:desktop',
      message: 'continue the task',
      idempotencyKey: 'message-1',
    },
  }]);
});

test('普通发送将已验证的 transcript leaf 原样交给 OpenClaw', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'run-leaf' };
      },
    },
    {
      message: 'keep this on the displayed branch',
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-leaf',
      expectedLeafEntryId: 'leaf-current',
    },
  );

  assert.deepEqual(requests, [{
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:desktop',
      expectedLeafEntryId: 'leaf-current',
      message: 'keep this on the displayed branch',
      idempotencyKey: 'message-leaf',
    },
  }]);
});

test('转向发送使用 chat.send 的官方 queueMode 且不携带 leaf 围栏', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  const result = await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'run-2' };
      },
    },
    {
      message: 'redirect the active run',
      attachments: [{ type: 'file', content: 'payload' }],
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-2',
      expectedLeafEntryId: 'leaf-must-not-be-sent',
      queueMode: 'steer',
    },
  );

  assert.deepEqual(result, { runId: 'run-2' });
  assert.deepEqual(requests, [{
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:desktop',
      queueMode: 'steer',
      message: 'redirect the active run',
      idempotencyKey: 'message-2',
      attachments: [{ type: 'file', content: 'payload' }],
    },
  }]);
});
