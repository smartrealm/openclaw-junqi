import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveStorageMaintenanceMode } from './storageMaintenancePolicy';

test('initial storage bootstrap uses the native transaction before Gateway is connected', () => {
  assert.equal(resolveStorageMaintenanceMode({
    configured: false,
    forceConfigure: false,
    gatewayConnected: false,
  }), 'native-bootstrap');
});

test('an established layout always retains the collaboration maintenance gate', () => {
  assert.equal(resolveStorageMaintenanceMode({
    configured: true,
    forceConfigure: false,
    gatewayConnected: false,
  }), 'guarded');
  assert.equal(resolveStorageMaintenanceMode({
    configured: false,
    forceConfigure: true,
    gatewayConnected: false,
  }), 'guarded');
  assert.equal(resolveStorageMaintenanceMode({
    configured: false,
    forceConfigure: false,
    gatewayConnected: true,
  }), 'guarded');
});
