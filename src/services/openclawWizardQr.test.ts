import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continueOpenClawWizardQrAuthorization,
  extractOpenClawWizardQrUrl,
  isOpenClawWizardQrAuthorizationContinuation,
  normalizeOpenClawWizardHttpUrl,
  resolveOpenClawWizardQrUrl,
  shouldAutoAdvanceOpenClawWizardQr,
} from './openclawWizardQr';

test('extracts a browser-safe URL only from QR-related official wizard text', () => {
  assert.equal(
    extractOpenClawWizardQrUrl('Scan the QR code, then visit https://accounts.example.test/verify?code=abc.'),
    'https://accounts.example.test/verify?code=abc',
  );
  assert.equal(
    extractOpenClawWizardQrUrl('Authorization URL: https://accounts.example.test/verify'),
    null,
  );
});

test('rejects unsafe or unsupported wizard URLs', () => {
  assert.equal(normalizeOpenClawWizardHttpUrl('javascript:alert(1)'), null);
  assert.equal(normalizeOpenClawWizardHttpUrl('https://user:secret@example.test/verify'), null);
  assert.equal(normalizeOpenClawWizardHttpUrl('https://example.test/verify'), 'https://example.test/verify');
});

test('auto-advances any safe QR note that explicitly starts plugin authorization polling', () => {
  const url = 'https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=abc';
  assert.equal(shouldAutoAdvanceOpenClawWizardQr('Waiting for authorization result...', url), true);
  assert.equal(shouldAutoAdvanceOpenClawWizardQr('QR rendering failed in current terminal.', url), false);
  assert.equal(shouldAutoAdvanceOpenClawWizardQr(
    'Waiting for authorization result...',
    'https://example.test/openapp/registration/openClaw',
  ), true);
  assert.equal(shouldAutoAdvanceOpenClawWizardQr(
    'Waiting for authorization result...',
    'javascript:alert(1)',
  ), false);
  assert.equal(shouldAutoAdvanceOpenClawWizardQr(
    '正在等待授權結果...',
    'https://open.feishu.cn/device',
  ), true);
});

test('resolves QR URLs from structured plugin fields without a channel allowlist', () => {
  assert.equal(
    resolveOpenClawWizardQrUrl(
      'Scan this QR code and wait for authorization status.',
      'https://auth.third-party.example/device',
    ),
    'https://auth.third-party.example/device',
  );
  assert.equal(
    resolveOpenClawWizardQrUrl(
      'Open this link to authorize.',
      'https://auth.third-party.example/device',
    ),
    null,
  );
  assert.equal(
    resolveOpenClawWizardQrUrl(
      'Scan this QR code.',
      'javascript:alert(1)',
    ),
    null,
  );
});

test('BUG-ONB-42 recognizes only the immediate affirmative QR URL continuation', () => {
  assert.equal(isOpenClawWizardQrAuthorizationContinuation({
    type: 'confirm',
    message: 'QR display failed. Continue with URL authorization?',
    initialValue: true,
  }), true);
  assert.equal(isOpenClawWizardQrAuthorizationContinuation({
    type: 'confirm',
    message: '是否继续使用浏览器链接授权？',
    initialValue: true,
  }), true);
  assert.equal(isOpenClawWizardQrAuthorizationContinuation({
    type: 'confirm',
    message: 'Continue with URL authorization?',
    initialValue: false,
  }), false);
  assert.equal(isOpenClawWizardQrAuthorizationContinuation({
    type: 'confirm',
    message: 'Allow this bot to respond in every group?',
    initialValue: true,
  }), false);
  assert.equal(isOpenClawWizardQrAuthorizationContinuation({
    type: 'note',
    message: 'Continue with URL authorization?',
    initialValue: true,
  }), false);
});

test('BUG-ONB-42 submits one recognized continuation and leaves unrelated confirms untouched', async () => {
  const calls: Array<{ stepId: string; value: true }> = [];
  const submit = async (stepId: string, value: true) => {
    calls.push({ stepId, value });
  };

  assert.equal(await continueOpenClawWizardQrAuthorization({
    id: 'continue-url-auth',
    type: 'confirm',
    message: 'QR display failed. Continue with URL authorization?',
    initialValue: true,
  }, submit), true);
  assert.deepEqual(calls, [{ stepId: 'continue-url-auth', value: true }]);

  assert.equal(await continueOpenClawWizardQrAuthorization({
    id: 'group-policy',
    type: 'confirm',
    message: 'Allow this bot to respond in every group?',
    initialValue: true,
  }, submit), false);
  assert.deepEqual(calls, [{ stepId: 'continue-url-auth', value: true }]);
});
