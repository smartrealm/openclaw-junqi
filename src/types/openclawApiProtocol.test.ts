/**
 * Unit tests for openclawApiProtocol — ported wholesale from JunQi.
 * Covers the contract: any value written into
 * `~/.openclaw/openclaw.json → models.providers.*.api` must be one of
 * the 10 whitelisted values, OR auto-migrate from a legacy name.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_API_PROTOCOLS,
  LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS,
  normalizeOpenClawApiProtocol,
  assertValidApiProtocol,
  InvalidApiProtocolError,
} from './openclawApiProtocol';

describe('OPENCLAW_API_PROTOCOLS whitelist', () => {
  test('has the 10 protocols openclaw accepts', () => {
    assert.equal(OPENCLAW_API_PROTOCOLS.length, 10);
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('openai-completions'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('openai-responses'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('openai-chatgpt-responses'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('anthropic-messages'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('google-generative-ai'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('google-vertex'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('github-copilot'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('bedrock-converse-stream'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('ollama'));
    assert.ok(OPENCLAW_API_PROTOCOLS.includes('azure-openai-responses'));
  });
});

describe('LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS', () => {
  test('migrates openai-codex-responses → openai-chatgpt-responses', () => {
    assert.equal(
      LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS['openai-codex-responses'],
      'openai-chatgpt-responses',
    );
  });
});

describe('normalizeOpenClawApiProtocol', () => {
  test('returns the same value for known protocols', () => {
    for (const p of OPENCLAW_API_PROTOCOLS) {
      assert.equal(normalizeOpenClawApiProtocol(p), p);
    }
  });

  test('migrates legacy openai-codex-responses', () => {
    assert.equal(
      normalizeOpenClawApiProtocol('openai-codex-responses'),
      'openai-chatgpt-responses',
    );
  });

  test('returns undefined for unknown values', () => {
    assert.equal(normalizeOpenClawApiProtocol('gpt-4-via-prompt'), undefined);
    assert.equal(normalizeOpenClawApiProtocol(''), undefined);
  });

  test('returns undefined for non-strings', () => {
    assert.equal(normalizeOpenClawApiProtocol(undefined), undefined);
    assert.equal(normalizeOpenClawApiProtocol(null), undefined);
    assert.equal(normalizeOpenClawApiProtocol(42), undefined);
    assert.equal(normalizeOpenClawApiProtocol({}), undefined);
  });
});

describe('assertValidApiProtocol', () => {
  test('passes for known protocols', () => {
    for (const p of OPENCLAW_API_PROTOCOLS) {
      assert.doesNotThrow(() => assertValidApiProtocol(p));
      assertValidApiProtocol(p, 'my-provider'); // with provider key
    }
  });

  test('throws InvalidApiProtocolError for unknown values', () => {
    try {
      assertValidApiProtocol('gpt-4-via-prompt', 'openai');
      assert.fail('expected throw');
    } catch (err) {
      assert.ok(err instanceof InvalidApiProtocolError);
      assert.equal((err as InvalidApiProtocolError).api, 'gpt-4-via-prompt');
      assert.equal((err as InvalidApiProtocolError).providerKey, 'openai');
      assert.match((err as Error).message, /Invalid OpenClaw api protocol for provider "openai"/);
    }
  });

  test('error message lists all valid protocols', () => {
    try {
      assertValidApiProtocol('bogus');
      assert.fail('expected throw');
    } catch (err) {
      const msg = (err as Error).message;
      for (const p of OPENCLAW_API_PROTOCOLS) {
        assert.ok(msg.includes(p), `error msg should list ${p}`);
      }
    }
  });
});

describe('REGRESSION: legacy migration does NOT silently accept unknown', () => {
  test('unknown strings do NOT pass through normalize', () => {
    // Only KNOWN legacy values should auto-migrate. Unknown strings
    // must return undefined so the gateway gets a clean rejection.
    assert.equal(normalizeOpenClawApiProtocol('something-new'), undefined);
    assert.equal(normalizeOpenClawApiProtocol('openai-completions-fork'), undefined);
  });
});
