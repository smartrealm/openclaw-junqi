import assert from 'node:assert/strict';
import test from 'node:test';

import {
  continueOpenClawWizardQrAuthorization,
  extractOpenClawWizardQrUrl,
  isOpenClawWizardQrAuthorizationContinuation,
  isOpenClawWizardQrMessage,
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

// Reproduces openclaw@2026.7.1-2 noteChannelPrimer()
// (dist/onboard-channels-BsIvPxyr.js): a plain note whose docs link precedes
// channel blurbs that merely name QR logins.
const CHANNEL_PRIMER_NOTE = [
  '入站 DM 安全默认使用配对：未知发送者会先获得配对码。',
  '批准配对：openclaw pairing approve <channel> <code>',
  '开放/公开 DM 需要 dmPolicy="open"，并且 allowFrom=["*"]。',
  '文档：https://docs.openclaw.ai/channels/pairing',
  '',
  'Weixin: Personal WeChat messaging via QR-code login.',
  'Zalo Personal: 通过二维码登录接入 Zalo 个人账号。',
  'Zalo ClawBot: Personal Zalo assistant bot via QR-code login — owner-bound, no setup.',
].join('\n');

test('does not treat the channel primer note as a scan step or render its docs link', () => {
  assert.equal(isOpenClawWizardQrMessage(CHANNEL_PRIMER_NOTE), false);
  assert.equal(extractOpenClawWizardQrUrl(CHANNEL_PRIMER_NOTE), null);
  assert.equal(resolveOpenClawWizardQrUrl(CHANNEL_PRIMER_NOTE), null);
});

// Verbatim scan prompts from every channel plugin that logs in by QR, so
// tightening the hint cannot silently break a real scan step. Sources:
// @tencent-weixin/openclaw-weixin 2.4.6, @openclaw/whatsapp 2026.7.1,
// @openclaw/zalouser 2026.7.1, openclaw 2026.7.1-2 dist/i18n (feishu/signal).
test('still recognizes every channel plugin prompt that tells the user to scan', () => {
  for (const prompt of [
    '用手机微信扫描以下二维码，以继续连接：',
    '二维码已显示，请用手机微信扫描。',
    'Open the WhatsApp app, go to Linked Devices, then scan this QR:',
    'QR already active. Scan it with the Zalo app.',
    'Scan the QR with Lark/Feishu on your phone.',
    '请用手机上的 Lark/飞书扫描二维码。',
    '請用手機上的 Lark/飛書掃描 QR code。',
    'Scan QR in Signal -> Linked Devices',
  ]) {
    assert.equal(isOpenClawWizardQrMessage(prompt), true, prompt);
  }
  assert.equal(
    resolveOpenClawWizardQrUrl('Scan this QR code.', 'https://auth.third-party.example/device'),
    'https://auth.third-party.example/device',
  );
});

// @dingtalk-real-ai/dingtalk-connector 0.8.24 src/onboarding.ts
// tryScanAuthorizeDingtalk(): one note carries the scan prompt, the device
// authorization URL, and the polling cue that starts the wizard's own wait.
test('keeps the DingTalk scan note driving URL extraction and polling hand-off', () => {
  const note = [
    'Scan with DingTalk to configure your bot (请使用钉钉扫码，配置机器人):',
    '[QR rendering unavailable, please open the link below]',
    'Authorization URL: https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=abc',
    'In the authorization page, you can create a new bot or bind an existing bot.',
    'Waiting for authorization result...',
  ].join('\n');

  const url = resolveOpenClawWizardQrUrl(note);
  assert.equal(url, 'https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=abc');
  assert.equal(shouldAutoAdvanceOpenClawWizardQr(note, url ?? undefined), true);
});

// Expiry/failure notices name a QR without asking for one to be scanned; they
// must not turn the step into a scan prompt or start terminal QR capture.
test('leaves channel plugin QR failure notices as plain notes', () => {
  for (const notice of [
    '二维码已过期，请重新生成。',
    '二维码多次失效，连接流程已停止。请稍后再试。',
    'QR login expired. Start again to generate a fresh QR code.',
    'QR login was declined on the phone.',
    'Failed to initialize Zalo QR login.',
  ]) {
    assert.equal(isOpenClawWizardQrMessage(notice), false, notice);
  }
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
