import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasProviderWildcard,
  setModelCatalogMode,
  setProviderAuthOrder,
  setProviderWildcard,
} from './providerPolicy';

test('BUG-MP-08 writes model catalog mode without replacing providers', () => {
  const config = { models: { providers: { custom: { baseUrl: 'http://localhost:8000' } } } };
  const next = setModelCatalogMode(config, 'replace');
  assert.equal(next.models?.mode, 'replace');
  assert.deepEqual(next.models?.providers, config.models.providers);
});

test('BUG-MP-08 keeps provider wildcard only in agent allowlist', () => {
  const config = { models: { providers: { openai: { models: [] } } }, agents: { defaults: { models: {} } } };
  const next = setProviderWildcard(config, 'OpenAI', true);
  assert.equal(hasProviderWildcard(next, 'openai'), true);
  assert.deepEqual(next.agents?.defaults?.models?.['openai/*'], {});
  assert.deepEqual(next.models?.providers?.openai.models, []);
});

test('BUG-MP-08 auth order is deduplicated and limited to the provider', () => {
  const config = {
    auth: {
      profiles: {
        'openai:a': { provider: 'openai', mode: 'api_key' },
        'openai:b': { provider: 'openai', mode: 'oauth' },
        'anthropic:a': { provider: 'anthropic', mode: 'api_key' },
      },
    },
  };
  const next = setProviderAuthOrder(config, 'openai', ['openai:b', 'anthropic:a', 'openai:b', 'openai:a']);
  assert.deepEqual(next.auth?.order?.openai, ['openai:b', 'openai:a']);
});
