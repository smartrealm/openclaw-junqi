import assert from 'node:assert/strict';
import test from 'node:test';
import { gatewayLifecycleFailureMessage } from './maintenanceGatewayRecovery';

test('维护中心以统一 success 字段判断 Gateway 恢复失败', () => {
  assert.equal(gatewayLifecycleFailureMessage({
    success: false,
    error: 'Runtime identity attestation failed',
    action: 'recover',
    source: 'test',
  }, 'Unknown error'), 'Runtime identity attestation failed');

  assert.equal(gatewayLifecycleFailureMessage({
    success: false,
    action: 'recover',
    source: 'test',
  }, 'Unknown error'), 'Unknown error');

  assert.equal(gatewayLifecycleFailureMessage({
    success: true,
    action: 'recover',
    source: 'test',
  }, 'Unknown error'), null);
});
