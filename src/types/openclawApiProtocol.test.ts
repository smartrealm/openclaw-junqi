import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS,
  normalizeOpenClawApiProtocol,
} from './openclawApiProtocol';

test('BUG-OCA-03 preserves protocols introduced by a newer selected Runtime', () => {
  assert.equal(normalizeOpenClawApiProtocol('future-runtime-adapter'), 'future-runtime-adapter');
});

test('BUG-OCA-03 migrates only the reviewed legacy JunQi protocol', () => {
  assert.equal(
    LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS['openai-codex-responses'],
    'openai-chatgpt-responses',
  );
  assert.equal(
    normalizeOpenClawApiProtocol('openai-codex-responses'),
    'openai-chatgpt-responses',
  );
});

test('BUG-OCA-03 rejects non-string and blank boundary values without maintaining a whitelist', () => {
  assert.equal(normalizeOpenClawApiProtocol(undefined), undefined);
  assert.equal(normalizeOpenClawApiProtocol(null), undefined);
  assert.equal(normalizeOpenClawApiProtocol('  '), undefined);
  assert.equal(normalizeOpenClawApiProtocol(42), undefined);
});
