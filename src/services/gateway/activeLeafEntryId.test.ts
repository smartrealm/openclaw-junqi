import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import {
  isOpenClawActiveLeafChangedError,
  parseOpenClawActiveLeafEntryId,
} from './activeLeafEntryId';

test('只接受 OpenClaw 返回的有效 active leaf 标识', () => {
  assert.equal(parseOpenClawActiveLeafEntryId(' leaf-1 '), 'leaf-1');
  assert.equal(parseOpenClawActiveLeafEntryId(null), null);
  assert.equal(parseOpenClawActiveLeafEntryId('   '), undefined);
  assert.equal(parseOpenClawActiveLeafEntryId({ id: 'leaf-1' }), undefined);
});

test('只将官方 active-leaf-changed 错误标记为需要历史刷新', () => {
  assert.equal(
    isOpenClawActiveLeafChangedError(
      new GatewayRpcError('active branch changed', 'INVALID_REQUEST', { reason: 'active-leaf-changed' }),
    ),
    true,
  );
  assert.equal(
    isOpenClawActiveLeafChangedError(
      new GatewayRpcError('session routing changed', 'INVALID_REQUEST', { reason: 'session-routing-changed' }),
    ),
    false,
  );
  assert.equal(isOpenClawActiveLeafChangedError(new Error('active-leaf-changed')), false);
});
