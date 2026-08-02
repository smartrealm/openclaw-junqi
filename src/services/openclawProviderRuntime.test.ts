import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOfficialProviderCatalogLoader,
  normalizeOfficialProviderAuthProfiles,
  normalizeOfficialProviderCatalog,
  providerCatalogModels,
  summarizeOfficialProviderProbe,
} from './openclawProviderRuntime';

test('BUG-MP-03 summarizes nested official probe success', () => {
  const result = summarizeOfficialProviderProbe({
    auth: { providers: [{ provider: 'openai', profiles: [{ status: 'ok', detail: 'reachable' }] }] },
  });
  assert.deepEqual(result, { ok: true, status: 'ok', detail: 'reachable' });
});

test('BUG-MP-03 preserves official failure status and reason code', () => {
  const result = summarizeOfficialProviderProbe({
    probes: [{ status: 'auth', reasonCode: 'missing_credential', detail: 'No credential' }],
  });
  assert.deepEqual(result, {
    ok: false,
    status: 'auth',
    reasonCode: 'missing_credential',
    detail: 'No credential',
  });
});

test('BUG-MP-03 mixed probe rows fail closed instead of accepting a sibling success', () => {
  const result = summarizeOfficialProviderProbe({
    probes: [
      { profile: 'openai:other', status: 'ok' },
      { profile: 'openai:main', status: 'auth', reasonCode: 'expired' },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'auth');
  assert.equal(result.reasonCode, 'expired');
});

test('BUG-MP-04 filters the runtime catalog by canonical provider prefix', () => {
  const rows = providerCatalogModels({
    version: '2026.7.1',
    models: [
      { key: 'openai/gpt-5.6', name: 'GPT-5.6' },
      { key: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5' },
    ],
  }, 'OpenAI');
  assert.deepEqual(rows.map((row) => row.key), ['openai/gpt-5.6']);
});

test('normalizes only valid official provider catalog rows', () => {
  const catalog = normalizeOfficialProviderCatalog({
    version: '2026.8.2',
    models: [
      { key: 'openai/gpt', name: 'GPT', contextWindow: 128000, tags: ['reasoning', 7] },
      { key: 'missing-name' },
      null,
    ],
  });
  assert.deepEqual(catalog, {
    version: '2026.8.2',
    models: [{ key: 'openai/gpt', name: 'GPT', contextWindow: 128000, tags: ['reasoning'] }],
  });
});

test('normalizes only complete official provider authentication profiles', () => {
  assert.deepEqual(normalizeOfficialProviderAuthProfiles({
    profiles: [
      { id: 'openai:default', provider: 'openai', type: 'oauth', label: 'Primary' },
      { id: 'missing-provider', type: 'oauth' },
      { id: 'missing-type', provider: 'openai' },
    ],
  }), [{ id: 'openai:default', provider: 'openai', type: 'oauth', label: 'Primary' }]);
});

test('PROV-01 always reads the catalog from the current runtime', async () => {
  let calls = 0;
  const loadCatalog = createOfficialProviderCatalogLoader(async () => {
    calls += 1;
    return { version: `runtime-${calls}`, models: [] };
  });

  const first = await loadCatalog();
  const second = await loadCatalog();
  assert.equal(calls, 2);
  assert.equal(first.version, 'runtime-1');
  assert.equal(second.version, 'runtime-2');
});
