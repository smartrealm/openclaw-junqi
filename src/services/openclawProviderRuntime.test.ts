import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
