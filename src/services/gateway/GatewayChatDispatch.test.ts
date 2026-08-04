import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchGatewayChatMessage } from './index';
import type { GatewayRequestParams } from './Connection';

test('普通发送不会改写会话推理可见性', async () => {
  const requests: Array<{ method: string; params: GatewayRequestParams }> = [];
  let steerCalls = 0;
  const result = await dispatchGatewayChatMessage(
    {
      isConnected: () => true,
      request: async (method, params) => {
        requests.push({ method, params });
        return { runId: 'run-1' };
      },
    },
    {
      steer: async () => {
        steerCalls += 1;
        throw new Error('普通发送不应调用 sessions.steer');
      },
    },
    {
      message: 'continue the task',
      sessionKey: 'agent:main:desktop',
      clientMessageId: 'message-1',
    },
  );

  assert.deepEqual(result, { runId: 'run-1' });
  assert.equal(steerCalls, 0);
  assert.deepEqual(requests, [{
    method: 'chat.send',
    params: {
      sessionKey: 'agent:main:desktop',
      message: 'continue the task',
      idempotencyKey: 'message-1',
    },
  }]);
});
