import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionRetryPolicy } from './ConnectionRetryPolicy';

test('retry policy produces one initial attempt and two exponential retries', () => {
  const policy = new ConnectionRetryPolicy(3, 1_000);
  assert.equal(policy.begin(), 1);
  assert.deepEqual(policy.next(), { exhausted: false, nextAttempt: 2, maxAttempts: 3, delayMs: 1_000 });
  assert.equal(policy.beginRetry(), 2);
  assert.deepEqual(policy.next(), { exhausted: false, nextAttempt: 3, maxAttempts: 3, delayMs: 2_000 });
  assert.equal(policy.beginRetry(), 3);
  assert.deepEqual(policy.next(), { exhausted: true, attempt: 3, maxAttempts: 3 });
});

test('retry policy reset starts a fresh recovery round', () => {
  const policy = new ConnectionRetryPolicy(3);
  policy.begin();
  policy.beginRetry();
  policy.reset();
  assert.equal(policy.attempt, 0);
  assert.equal(policy.begin(), 1);
});

test('retry policy caps its backoff delay', () => {
  const policy = new ConnectionRetryPolicy(10, 1_000, 2_500);
  policy.begin();
  policy.beginRetry();
  policy.beginRetry();
  const decision = policy.next();
  assert.equal(decision.exhausted, false);
  if (!decision.exhausted) assert.equal(decision.delayMs, 2_500);
});
