import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  assertGitHubReadResponse,
  calculateGitHubRetryDelay,
  GitHubRateLimitBoundError,
  GitHubReadError,
  RetryBudget,
  rateLimitMetadata,
  retryAfterMilliseconds,
  timeoutWithinRetryBudget,
  withGitHubReadRetry,
} from './github-read-retry.mjs';

describe('GitHub read retry policy', () => {
  test('retries only transient reads with bounded exponential delays', async () => {
    const delays = [];
    let calls = 0;
    const result = await withGitHubReadRetry(async () => {
      calls += 1;
      if (calls < 3) throw new GitHubReadError('https://api.example.test', 503, 'unavailable');
      return 'ok';
    }, {
      attempts: 4,
      baseDelayMs: 10,
      maxDelayMs: 25,
      sleep: async (delay) => delays.push(delay),
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
    assert.deepEqual(delays, [10, 20]);
  });

  test('does not retry authorization or schema failures', async () => {
    let calls = 0;
    await assert.rejects(
      withGitHubReadRetry(async () => {
        calls += 1;
        throw new GitHubReadError('https://api.example.test', 403, 'forbidden');
      }, { sleep: async () => assert.fail('sleep must not run') }),
      (error) => error instanceof GitHubReadError && error.status === 403,
    );
    assert.equal(calls, 1);
  });

  test('retries a classified fetch transport failure', async () => {
    let calls = 0;
    const result = await withGitHubReadRetry(async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('transport failed'), { code: 'FETCH_TRANSPORT_ERROR' });
      return 'recovered';
    }, { sleep: async () => {} });
    assert.equal(result, 'recovered');
    assert.equal(calls, 2);
  });

  test('honors Retry-After on a transient non-rate-limit response', async () => {
    const delays = [];
    let calls = 0;
    const result = await withGitHubReadRetry(async () => {
      calls += 1;
      if (calls === 1) throw new GitHubReadError('https://api.example.test', 503, 'maintenance', 3_000);
      return 'recovered';
    }, { sleep: async (delay) => delays.push(delay) });
    assert.equal(result, 'recovered');
    assert.deepEqual(delays, [3_000]);
  });

  test('honors a bounded Retry-After hint', async () => {
    const now = Date.parse('2026-07-18T00:00:00Z');
    assert.equal(retryAfterMilliseconds(new Headers({ 'retry-after': '1.25' }), now), 1_250);
    assert.equal(
      retryAfterMilliseconds(new Headers({ 'retry-after': 'Sat, 18 Jul 2026 00:00:03 GMT' }), now),
      3_000,
    );
    const delays = [];
    let calls = 0;
    await withGitHubReadRetry(async () => {
      calls += 1;
      if (calls === 1) throw new GitHubReadError('https://api.example.test', 429, 'rate limited', 60_000);
      return 'ok';
    }, {
      baseDelayMs: 5,
      maxDelayMs: 20,
      maxRateLimitDelayMs: 60_000,
      sleep: async (delay) => delays.push(delay),
    });
    assert.deepEqual(delays, [60_000]);
  });

  test('fails closed instead of retrying before an oversized rate-limit window', async () => {
    await assert.rejects(
      withGitHubReadRetry(
        async () => {
          throw new GitHubReadError(
            'https://api.example.test',
            429,
            'rate limited',
            120_000,
          );
        },
        {
          maxRateLimitDelayMs: 60_000,
          sleep: async () => assert.fail('must not sleep before an oversized hint'),
        },
      ),
      (error) => error instanceof GitHubRateLimitBoundError
        && error.code === 'GITHUB_RATE_LIMIT_BUDGET_EXCEEDED'
        && error.hintedDelayMs === 120_000,
    );
  });

  test('classifies a rate-limited 403 and honors Retry-After independently of transient backoff', async () => {
    const delays = [];
    let calls = 0;
    const result = await withGitHubReadRetry(async () => {
      calls += 1;
      if (calls === 1) {
        const metadata = rateLimitMetadata(
          new Headers({ 'retry-after': '2.5' }),
          403,
        );
        throw new GitHubReadError(
          'https://api.example.test',
          403,
          'secondary rate limit',
          metadata.retryAfterMs,
          metadata,
        );
      }
      return 'recovered';
    }, {
      baseDelayMs: 10,
      maxDelayMs: 20,
      maxRateLimitDelayMs: 5_000,
      sleep: async (delay) => delays.push(delay),
    });
    assert.equal(result, 'recovered');
    assert.deepEqual(delays, [2_500]);
  });

  test('uses the primary rate-limit reset window and a one-minute fallback', async () => {
    const now = Date.parse('2026-07-18T00:00:00Z');
    const metadata = rateLimitMetadata(new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor((now + 60_000) / 1_000)),
    }), 403, now);
    assert.equal(metadata.rateLimited, true);
    assert.equal(metadata.rateLimitResetAfterMs, 60_000);
    assert.equal(calculateGitHubRetryDelay(
      new GitHubReadError('https://api.example.test', 403, 'quota exhausted', undefined, metadata),
      { attempt: 1 },
    ), 60_000);

    const fallback = rateLimitMetadata(new Headers(), 429, now);
    assert.equal(fallback.rateLimited, true);
    assert.equal(calculateGitHubRetryDelay(
      new GitHubReadError('https://api.example.test', 429, 'rate limited', undefined, fallback),
      { attempt: 1 },
    ), 60_000);
  });

  test('propagates rate-limit metadata from a rejected HTTP response', () => {
    assert.throws(
      () => assertGitHubReadResponse({
        ok: false,
        status: 403,
        headers: new Headers({
          'retry-after': '3',
          'x-ratelimit-remaining': '0',
        }),
      }, 'https://api.example.test'),
      (error) => error instanceof GitHubReadError
        && error.rateLimited === true
        && error.retryAfterMs === 3_000
        && error.rateLimitRemaining === 0,
    );
  });

  test('recognizes a bounded secondary-limit message but not malformed Retry-After', () => {
    assert.equal(rateLimitMetadata(new Headers(), 403, Date.now(), {
      message: 'You have exceeded a secondary rate limit.',
    }).rateLimited, true);
    assert.equal(rateLimitMetadata(new Headers({ 'retry-after': '-1' }), 403).rateLimited, false);
    assert.equal(rateLimitMetadata(new Headers({ 'retry-after': 'nonsense' }), 403).rateLimited, false);
  });

  test('uses the more conservative of Retry-After and the primary reset window', () => {
    const now = Date.parse('2026-07-18T00:00:00Z');
    const metadata = rateLimitMetadata(new Headers({
      'retry-after': '0',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor((now + 60_000) / 1_000)),
    }), 403, now);
    const error = new GitHubReadError('https://api.example.test', 403, 'limited', undefined, metadata);
    assert.equal(calculateGitHubRetryDelay(error, { attempt: 1 }), 60_000);
  });

  test('uses the GitHub response clock when calculating an absolute reset', () => {
    const serverNow = Date.parse('2026-07-18T00:00:00Z');
    const runnerNow = serverNow + (5 * 60_000);
    const metadata = rateLimitMetadata(new Headers({
      date: 'Sat, 18 Jul 2026 00:00:00 GMT',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Math.floor((serverNow + 60_000) / 1_000)),
    }), 403, runnerNow);
    assert.equal(metadata.rateLimitResetAfterMs, 60_000);
  });

  test('enforces a shared retry budget and narrows request deadlines', async () => {
    let now = 1_000;
    const budget = new RetryBudget({
      deadlineAt: 1_500,
      now: () => now,
      sleep: async (delay) => { now += delay; },
    });
    assert.equal(timeoutWithinRetryBudget(30_000, budget), 500);
    await assert.rejects(
      withGitHubReadRetry(async () => {
        throw new GitHubReadError('https://api.example.test', 503, 'unavailable');
      }, { budget, sleep: async () => {} }),
      (error) => error.code === 'GITHUB_RETRY_BUDGET_EXCEEDED',
    );
  });
});
