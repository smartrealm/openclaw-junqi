import test from 'node:test';
import assert from 'node:assert/strict';
import { extractWizardUrls } from './wizardQr';

test('extracts Gateway-owned authorization URLs without provider-specific matching', () => {
  assert.deepEqual(extractWizardUrls(
    'QR rendering failed. Authorization URL: https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=test.',
  ), ['https://open-dev.dingtalk.com/openapp/registration/openClaw?user_code=test']);
});

test('deduplicates URLs and ignores non-http content', () => {
  assert.deepEqual(extractWizardUrls(
    'https://example.com/a https://example.com/a file:///tmp/nope',
  ), ['https://example.com/a']);
  assert.deepEqual(extractWizardUrls(null), []);
});
