import assert from 'node:assert/strict';
import test from 'node:test';
import { composerDeliveryOptions } from './useMessageSend';

test('normal Composer delivery leaves busy-session queue selection to OpenClaw', () => {
  assert.deepEqual(composerDeliveryOptions('normal'), {});
});

test('explicit Composer steering retains the native interrupt-and-steer delivery', () => {
  assert.deepEqual(composerDeliveryOptions('steer'), { delivery: 'steer' });
});
