import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawMemorySearchClient,
  OpenClawMemorySearchResponseError,
  parseOpenClawMemorySearchResponse,
} from './OpenClawMemorySearchClient';

function result(overrides: Record<string, unknown> = {}) {
  return {
    path: 'memory/2026-08-03.md',
    startLine: 4,
    endLine: 8,
    score: 0.91,
    vectorScore: 0.88,
    textScore: 0.94,
    snippet: 'A Gateway-owned memory result.',
    source: 'memory',
    citation: 'memory/2026-08-03.md:4-8',
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'writer',
    provider: 'local',
    searchMode: 'hybrid',
    results: [result()],
    ...overrides,
  };
}

test('sends the official memory.search request and decodes the response', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = new OpenClawMemorySearchClient(async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push({ method, params });
    return response({ results: [result({ source: 'sessions' })] }) as T;
  });

  assert.deepEqual(await client.search({
    query: '  release notes  ',
    maxResults: 20.9,
    minScore: 0.4,
    agentId: ' writer ',
  }), response({ results: [result({ source: 'sessions' })] }));
  assert.deepEqual(calls, [{
    method: 'memory.search',
    params: {
      query: 'release notes',
      maxResults: 20,
      minScore: 0.4,
      agentId: 'writer',
    },
  }]);
});

test('preserves official optional stale metadata and ignores additive fields', () => {
  assert.deepEqual(parseOpenClawMemorySearchResponse(response({
    stale: true,
    warning: 'Index is stale',
    action: 'retry',
    futureField: { accepted: true },
  })), {
    ...response(),
    stale: true,
    warning: 'Index is stale',
    action: 'retry',
  });
});

test('rejects malformed known response fields and invalid request values', async () => {
  for (const value of [
    response({ agentId: '' }),
    response({ provider: '' }),
    response({ searchMode: 'vector' }),
    response({ results: {} }),
    response({ results: [result({ source: 'workspace' })] }),
    response({ results: [result({ score: Number.NaN })] }),
    response({ stale: false }),
    response({ warning: '' }),
  ]) {
    assert.throws(() => parseOpenClawMemorySearchResponse(value), OpenClawMemorySearchResponseError);
  }

  const client = new OpenClawMemorySearchClient(async <T>(): Promise<T> => response() as T);
  await assert.rejects(client.search({ query: ' ' }));
  await assert.rejects(client.search({ query: 'x', maxResults: Number.POSITIVE_INFINITY }));
  await assert.rejects(client.search({ query: 'x', minScore: Number.NaN }));
  await assert.rejects(client.search({ query: 'x', agentId: ' ' }));
});

test('mirrors the Gateway maxResults bounds while keeping the default parameter absent', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = new OpenClawMemorySearchClient(async <T>(_method: string, params: Record<string, unknown>): Promise<T> => {
    calls.push(params);
    return response() as T;
  });
  await client.search({ query: 'low', maxResults: 0 });
  await client.search({ query: 'high', maxResults: 99 });
  await client.search({ query: 'default' });
  assert.deepEqual(calls, [
    { query: 'low', maxResults: 1 },
    { query: 'high', maxResults: 50 },
    { query: 'default' },
  ]);
});
