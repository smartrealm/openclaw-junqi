import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENCLAW_SESSIONS_SEARCH_MAX_LIMIT,
  OPENCLAW_SESSIONS_SEARCH_MAX_QUERY_LENGTH,
  OPENCLAW_SESSIONS_SEARCH_MAX_SESSION_KEYS,
  OpenClawSessionSearchClient,
  OpenClawSessionSearchResponseError,
  parseOpenClawSessionSearchResult,
} from './OpenClawSessionSearchClient';

const hit = {
  sessionKey: 'agent:main:main',
  sessionId: 'session-1',
  messageId: 'message-1',
  role: 'assistant',
  timestamp: 1_700_000_000_000,
  snippet: 'The Gateway-owned transcript match.',
  score: 0.91,
};

test('sends the official sessions.search request and preserves native hit fields', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawSessionSearchClient(async <T>(method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return { results: [hit], indexing: true, truncated: true } as T;
  });

  assert.deepEqual(await client.search({
    query: '  deployment  ',
    agentId: ' main ',
    sessionKeys: [' agent:main:main ', 'agent:main:main'],
    limit: 25,
  }), {
    results: [hit],
    indexing: true,
    truncated: true,
  });
  assert.deepEqual(calls, [{
    method: 'sessions.search',
    params: {
      query: 'deployment',
      agentId: 'main',
      sessionKeys: ['agent:main:main'],
      limit: 25,
    },
  }]);
});

test('accepts empty snippets and drops additive response fields', () => {
  assert.deepEqual(parseOpenClawSessionSearchResult({
    results: [{ ...hit, snippet: '', extra: 'ignored' }],
    extra: true,
  }), {
    results: [{ ...hit, snippet: '' }],
  });
});

test('preserves both false and true native indexing flags', () => {
  assert.deepEqual(parseOpenClawSessionSearchResult({
    results: [],
    indexing: false,
    truncated: false,
  }), {
    results: [],
    indexing: false,
    truncated: false,
  });
});

test('rejects malformed response fields and invalid official request bounds', async () => {
  for (const value of [
    { results: [{ ...hit, role: 'tool' }] },
    { results: [{ ...hit, timestamp: 1.5 }] },
    { results: [{ ...hit, timestamp: -1 }] },
    { results: [{ ...hit, score: Number.NaN }] },
    { results: [{ ...hit, snippet: 42 }] },
    { results: [{ ...hit, sessionId: '' }] },
    { results: [], indexing: 'false' },
    { results: [], truncated: 0 },
  ]) {
    assert.throws(() => parseOpenClawSessionSearchResult(value), OpenClawSessionSearchResponseError);
  }

  const client = new OpenClawSessionSearchClient(async <T>() => ({ results: [] }) as T);
  await assert.rejects(client.search({ query: ' ' }));
  await assert.rejects(client.search({ query: 'x'.repeat(OPENCLAW_SESSIONS_SEARCH_MAX_QUERY_LENGTH + 1) }));
  await assert.rejects(client.search({ query: 'x', limit: 0 }));
  await assert.rejects(client.search({ query: 'x', limit: OPENCLAW_SESSIONS_SEARCH_MAX_LIMIT + 1 }));
  await assert.rejects(client.search({ query: 'x', sessionKeys: [] }));
  await assert.rejects(client.search({
    query: 'x',
    sessionKeys: Array.from({ length: OPENCLAW_SESSIONS_SEARCH_MAX_SESSION_KEYS + 1 }, (_, index) => `key:${index}`),
  }));
});
