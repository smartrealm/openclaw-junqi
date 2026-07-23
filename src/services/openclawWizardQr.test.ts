import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractOpenClawWizardQrUrl,
  normalizeOpenClawWizardHttpUrl,
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
