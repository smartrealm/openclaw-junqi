import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_OPERATOR_SCOPES,
  GatewayConnectionPolicy,
} from './GatewayConnectionPolicy';

test('Gateway 连接策略保留官方附件上限', () => {
  const policy = GatewayConnectionPolicy.parse({
    maxPayload: 25 * 1024 * 1024,
    maxBufferedBytes: 50 * 1024 * 1024,
    tickIntervalMs: 15_000,
    attachments: {
      maxBytes: 20 * 1024 * 1024,
      maxImageBytes: 6 * 1024 * 1024,
    },
  });

  assert.ok(policy);
  assert.deepEqual(policy.attachmentPolicy(), {
    maxPayload: 25 * 1024 * 1024,
    maxBytes: 20 * 1024 * 1024,
    maxImageBytes: 6 * 1024 * 1024,
  });
});

test('旧 Gateway 缺少附件字段时只保留帧上限', () => {
  const policy = GatewayConnectionPolicy.parse({
    maxPayload: 25 * 1024 * 1024,
    maxBufferedBytes: 50 * 1024 * 1024,
    tickIntervalMs: 15_000,
  });

  assert.ok(policy);
  assert.deepEqual(policy.attachmentPolicy(), { maxPayload: 25 * 1024 * 1024 });
});

test('Gateway 连接策略拒绝不完整的附件字段', () => {
  assert.equal(GatewayConnectionPolicy.parse({
    maxPayload: 1024,
    maxBufferedBytes: 2048,
    tickIntervalMs: 1000,
    attachments: { maxBytes: 512 },
  }), null);
});

test('日常连接显式声明 Talk 权限', () => {
  assert.deepEqual(DAILY_OPERATOR_SCOPES, [
    'operator.read',
    'operator.write',
    'operator.talk',
  ]);
});
