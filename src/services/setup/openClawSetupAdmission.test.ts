import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayRpcError } from '@/services/gateway/Connection';
import {
  isOpenClawSetupAdmissionBusy,
  OPENCLAW_SETUP_ADMISSION_BUSY_MESSAGE,
} from './openClawSetupAdmission';

test('仅识别 OpenClaw 官方可重试的配置占用错误', () => {
  assert.equal(isOpenClawSetupAdmissionBusy(new GatewayRpcError(
    OPENCLAW_SETUP_ADMISSION_BUSY_MESSAGE,
    'UNAVAILABLE',
    { retryable: true },
  )), true);
  assert.equal(isOpenClawSetupAdmissionBusy(new GatewayRpcError(
    OPENCLAW_SETUP_ADMISSION_BUSY_MESSAGE,
    'UNAVAILABLE',
    { retryable: false },
  )), false);
  assert.equal(isOpenClawSetupAdmissionBusy(new Error('wizard already running')), false);
});
