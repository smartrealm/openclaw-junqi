import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from './Connection';
import { isOpenClawUnknownMethodError } from './GatewayProtocolEvidence';

test('unknown method evidence must use the official code and exact requested method', () => {
  assert.equal(isOpenClawUnknownMethodError(
    new GatewayRpcError('unknown method: sessions.groups.list', 'INVALID_REQUEST'),
    'sessions.groups.list',
  ), true);
  assert.equal(isOpenClawUnknownMethodError(
    new GatewayRpcError('unknown method: sessions.list', 'INVALID_REQUEST'),
    'sessions.groups.list',
  ), false);
  assert.equal(isOpenClawUnknownMethodError(
    new GatewayRpcError('unknown method: sessions.groups.list', 'METHOD_NOT_FOUND'),
    'sessions.groups.list',
  ), false);
  assert.equal(isOpenClawUnknownMethodError(
    new GatewayRpcError('Unknown method: sessions.groups.list', 'INVALID_REQUEST'),
    'sessions.groups.list',
  ), false);
});
