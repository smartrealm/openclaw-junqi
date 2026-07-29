import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeSetupDiagnostic } from './setupDiagnostic';

test('setup diagnostics redact named credentials, authorization headers, and URL user-info', () => {
  const diagnostic = sanitizeSetupDiagnostic([
    'Authorization: Bearer bearer-secret-value',
    'apiKey="sk-live-secret-value"',
    'refresh_token=refresh-secret-value',
    'https://operator:password-value@example.test/v1',
  ].join(' | '));

  for (const secret of [
    'bearer-secret-value',
    'sk-live-secret-value',
    'refresh-secret-value',
    'operator',
    'password-value',
  ]) {
    assert.doesNotMatch(diagnostic, new RegExp(secret));
  }
  assert.match(diagnostic, /Authorization: \[REDACTED\]/);
  assert.match(diagnostic, /apiKey=\[REDACTED\]/);
  assert.match(diagnostic, /refresh_token=\[REDACTED\]/);
  assert.match(diagnostic, /https:\/\/\[REDACTED\]@example\.test\/v1/);
});

test('setup diagnostics redact common bearer/JWT tokens without hiding actionable context', () => {
  const diagnostic = sanitizeSetupDiagnostic(
    'Provider returned 401 for sk-abcdefghijk12345 and eyJhbGciOiJIUzI1NiJ9.payload.signature at model probe',
  );

  assert.equal(
    diagnostic,
    'Provider returned 401 for [REDACTED] and [REDACTED] at model probe',
  );
});

test('setup diagnostics normalize control characters and apply a bounded length', () => {
  const diagnostic = sanitizeSetupDiagnostic(`line\u0000\n${'x'.repeat(4_000)}`, 128);
  assert.doesNotMatch(diagnostic, /\u0000/);
  assert.equal(diagnostic.length, 128);
});
