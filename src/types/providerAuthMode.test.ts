import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTH_MODE_ORDER,
  AUTH_MODE_INFO,
  OAUTH_PROVIDER_TYPES,
  PROVIDER_AUTH_MODES,
  defaultAuthModeFor,
  authModesFor,
  type ProviderAuthMode,
} from './providerAuthMode';

describe('AUTH_MODE_ORDER', () => {
  test('api_key first (most common fallback), local last', () => {
    assert.equal(AUTH_MODE_ORDER[0], 'api_key');
    assert.equal(AUTH_MODE_ORDER[AUTH_MODE_ORDER.length - 1], 'local');
  });

  test('contains all 4 documented modes', () => {
    assert.equal(AUTH_MODE_ORDER.length, 4);
    const set = new Set<ProviderAuthMode>(AUTH_MODE_ORDER);
    for (const m of ['api_key', 'oauth_device', 'oauth_browser', 'local'] as const) {
      assert.ok(set.has(m), `missing ${m}`);
    }
  });
});

describe('AUTH_MODE_INFO capability flags', () => {
  test('api_key: text field, no flows', () => {
    const info = AUTH_MODE_INFO.api_key;
    assert.equal(info.hasApiKeyField, true);
    assert.equal(info.hasBrowserFlow, false);
    assert.equal(info.hasDeviceCode, false);
    assert.equal(info.hasBaseUrl, false);
  });

  test('oauth_browser: triggers browser flow', () => {
    const info = AUTH_MODE_INFO.oauth_browser;
    assert.equal(info.hasApiKeyField, false);
    assert.equal(info.hasBrowserFlow, true);
  });

  test('oauth_device: shows one-time code', () => {
    const info = AUTH_MODE_INFO.oauth_device;
    assert.equal(info.hasDeviceCode, true);
    assert.equal(info.hasBrowserFlow, false);
  });

  test('local: needs baseUrl', () => {
    const info = AUTH_MODE_INFO.local;
    assert.equal(info.hasBaseUrl, true);
    assert.equal(info.hasApiKeyField, false);
  });
});

describe('OAUTH_PROVIDER_TYPES', () => {
  test('contains both MiniMax variants', () => {
    assert.ok(OAUTH_PROVIDER_TYPES.has('minimax-portal'));
    assert.ok(OAUTH_PROVIDER_TYPES.has('minimax-portal-cn'));
  });
  test('does NOT include OpenAI (OpenAI uses oauth_browser but is registered separately)', () => {
    // The JunQi registry marks OpenAI as oauth_browser-eligible in
    // its `supportedAuthModes: ['api_key', 'oauth_browser']`, not via
    // OAUTH_PROVIDER_TYPES. OAUTH_PROVIDER_TYPES is a separate list
    // for "this vendor's entire auth is OAuth-only".
    assert.equal(OAUTH_PROVIDER_TYPES.has('openai'), false);
  });
});

describe('defaultAuthModeFor', () => {
  test('MiniMax variants default to oauth_browser', () => {
    assert.equal(defaultAuthModeFor('minimax-portal'), 'oauth_browser');
    assert.equal(defaultAuthModeFor('minimax-portal-cn'), 'oauth_browser');
  });
  test('Ollama defaults to local', () => {
    assert.equal(defaultAuthModeFor('ollama'), 'local');
  });
  test('unknown providers default to api_key (safe fallback)', () => {
    assert.equal(defaultAuthModeFor('anthropic'), 'api_key');
    assert.equal(defaultAuthModeFor('totally-unknown-vendor'), 'api_key');
  });
});

describe('authModesFor', () => {
  test('OpenAI offers api_key + oauth_browser', () => {
    const modes = authModesFor('openai');
    assert.deepEqual(modes, ['api_key', 'oauth_browser']);
  });
  test('MiniMax only offers oauth_browser', () => {
    assert.deepEqual(authModesFor('minimax-portal'), ['oauth_browser']);
  });
  test('Ollama only offers local', () => {
    assert.deepEqual(authModesFor('ollama'), ['local']);
  });
  test('unknown provider falls back to api_key only', () => {
    assert.deepEqual(authModesFor('mystery-vendor'), ['api_key']);
  });
  test('every entry is a valid AUTH_MODE_ORDER member', () => {
    for (const [, modes] of Object.entries(PROVIDER_AUTH_MODES)) {
      for (const m of modes) {
        assert.ok(AUTH_MODE_ORDER.includes(m as ProviderAuthMode), `bad mode: ${m}`);
      }
    }
  });
});