import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGatewayRescueChatRequest,
  gatewayRescueTargetKey,
  type GatewayRescueTarget,
} from '@/runtime/gatewayRescue';

test('gateway rescue target identity is the authoritative OpenClaw model reference', () => {
  const target: GatewayRescueTarget = {
    providerId: 'vllm',
    modelId: 'gpt-5.6-sol',
    modelRef: 'vllm/gpt-5.6-sol',
    source: 'primary',
  };
  assert.equal(gatewayRescueTargetKey(target), 'vllm/gpt-5.6-sol');
});

test('gateway rescue IPC never accepts provider credentials from the renderer', () => {
  const request = createGatewayRescueChatRequest(
    {
      providerId: 'vllm',
      modelId: 'gpt-5.6-sol',
      modelRef: 'vllm/gpt-5.6-sol',
      source: 'primary',
    },
    [{ role: 'user', content: '诊断 Gateway' }],
    { error: '连接失败' },
  );

  assert.deepEqual(Object.keys(request).sort(), ['context', 'messages', 'modelRef']);
  assert.equal(request.modelRef, 'vllm/gpt-5.6-sol');
});
