import test from 'node:test';
import assert from 'node:assert/strict';
import { isFeishuQrSetupMethodStep } from './feishuQrWizardBridge';

test('detects the official Feishu QR capability without depending on display copy', () => {
  assert.equal(isFeishuQrSetupMethodStep({
    id: 'runtime-generated-id',
    type: 'select',
    options: [
      { value: 'manual', label: '手动输入凭据' },
      { value: 'scan', label: '扫描二维码' },
    ],
  }), true);
});

test('leaves changed or unknown Gateway choices to the generic wizard renderer', () => {
  assert.equal(isFeishuQrSetupMethodStep({
    id: 'runtime-generated-id',
    type: 'select',
    options: [
      { value: 'manual', label: 'Manual' },
      { value: 'device-code', label: 'Device code' },
    ],
  }), false);
});
