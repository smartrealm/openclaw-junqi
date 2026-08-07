import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from '@/services/gateway/Connection';
import {
  composerDeliveryOptions,
  shouldRefreshHistoryAfterMessageSendFailure,
} from './useMessageSend';

test('normal Composer delivery leaves busy-session queue selection to OpenClaw', () => {
  assert.deepEqual(composerDeliveryOptions('normal'), {});
});

test('explicit Composer steering retains the native interrupt-and-steer delivery', () => {
  assert.deepEqual(composerDeliveryOptions('steer'), { delivery: 'steer' });
});

test('发送失败只为官方 leaf 冲突或已确认空会话首发读取权威历史', () => {
  const leafChanged = new GatewayRpcError(
    'active leaf changed',
    'INVALID_REQUEST',
    { reason: 'active-leaf-changed' },
  );
  assert.equal(shouldRefreshHistoryAfterMessageSendFailure(leafChanged, false), true);
  assert.equal(shouldRefreshHistoryAfterMessageSendFailure(new Error('network failed'), true), true);
  assert.equal(shouldRefreshHistoryAfterMessageSendFailure(new Error('network failed'), false), false);
});
