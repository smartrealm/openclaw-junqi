import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  FetchDeadlineError,
  FetchResponseError,
  FetchTransportError,
  fetchJsonWithDeadline,
  fetchStatusWithDeadline,
} from './fetch-deadline.mjs';

describe('bounded HTTP adapter', () => {
  test('passes an abort signal and returns a completed response', async () => {
    let signal;
    const response = await fetchJsonWithDeadline('https://example.test', {}, {
      timeoutMs: 100,
      fetchImpl: async (_url, options) => {
        signal = options.signal;
        return new Response('{"status":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
    assert.equal(signal.aborted, false);
  });

  test('rejects a hung request at the deadline and aborts its signal', async () => {
    let signal;
    await assert.rejects(
      fetchJsonWithDeadline('https://example.test/hung', {}, {
        timeoutMs: 10,
        fetchImpl: async (_url, options) => {
          signal = options.signal;
          await new Promise(() => {});
        },
      }),
      (error) => error instanceof FetchDeadlineError && error.code === 'FETCH_TIMEOUT',
    );
    assert.equal(signal.aborted, true);
  });

  test('bounds a response body that never completes', async () => {
    let signal;
    await assert.rejects(
      fetchJsonWithDeadline('https://example.test/hung-body', {}, {
        timeoutMs: 10,
        fetchImpl: async (_url, options) => {
          signal = options.signal;
          return new Response(new ReadableStream({
            start() {},
          }), { status: 200 });
        },
      }),
      (error) => error instanceof FetchDeadlineError && error.code === 'FETCH_TIMEOUT',
    );
    assert.equal(signal.aborted, true);
  });

  test('rejects oversized and malformed JSON responses before handing them to callers', async () => {
    await assert.rejects(
      fetchJsonWithDeadline('https://example.test/large', {}, {
        maxBytes: 4,
        fetchImpl: async () => new Response('12345', { status: 200 }),
      }),
      (error) => error instanceof FetchResponseError && error.code === 'RESPONSE_TOO_LARGE',
    );
    await assert.rejects(
      fetchJsonWithDeadline('https://example.test/invalid', {}, {
        fetchImpl: async () => new Response('{invalid', { status: 200 }),
      }),
      (error) => error instanceof FetchResponseError && error.code === 'INVALID_JSON',
    );
  });

  test('preserves non-JSON error status and retry headers without parsing the body', async () => {
    const response = await fetchJsonWithDeadline('https://example.test/unavailable', {}, {
      fetchImpl: async () => new Response('<html>upstream unavailable</html>', {
        status: 503,
        headers: { 'retry-after': '2' },
      }),
    });
    assert.equal(response.ok, false);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '2');
    assert.equal(response.body, undefined);
  });

  test('optionally reads only a bounded 403/429 error body for provider classification', async () => {
    const response = await fetchJsonWithDeadline('https://example.test/secondary-limit', {}, {
      includeErrorBody: true,
      maxErrorBytes: 128,
      fetchImpl: async () => new Response(JSON.stringify({
        message: 'You have exceeded a secondary rate limit.',
      }), { status: 403 }),
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.message, 'You have exceeded a secondary rate limit.');

    const oversized = await fetchJsonWithDeadline('https://example.test/oversized-error', {}, {
      includeErrorBody: true,
      maxErrorBytes: 8,
      fetchImpl: async () => new Response(JSON.stringify({ message: 'rate limit' }), { status: 403 }),
    });
    assert.equal(oversized.body, undefined);

    const statusResponse = await fetchStatusWithDeadline('https://example.test/status-limit', {}, {
      includeErrorBody: true,
      fetchImpl: async () => new Response(JSON.stringify({ message: 'secondary rate limit' }), { status: 429 }),
    });
    assert.equal(statusResponse.status, 429);
    assert.equal(statusResponse.body.message, 'secondary rate limit');
  });

  test('does not compare decoded bytes with the wire Content-Length of gzip responses', async () => {
    const response = await fetchJsonWithDeadline('https://example.test/gzip', {}, {
      fetchImpl: async () => new Response('{"decoded":true}', {
        status: 200,
        headers: {
          'content-encoding': 'gzip',
          'content-length': '8',
        },
      }),
    });
    assert.deepEqual(response.body, { decoded: true });
  });

  test('classifies connection failures as retryable transport errors without exposing details', async () => {
    const cause = new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    await assert.rejects(
      fetchJsonWithDeadline('https://example.test/reset', {}, {
        fetchImpl: async () => { throw cause; },
      }),
      (error) => error instanceof FetchTransportError
        && error.code === 'FETCH_TRANSPORT_ERROR'
        && error.cause === cause
        && !error.message.includes('ECONNRESET'),
    );
  });
});
