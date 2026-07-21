import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CargoDependencyFetchError,
  cargoNetworkEnvironment,
  fetchLockedCargoDependencies,
  parseCargoFetchOptions,
} from './fetch-cargo-dependencies.mjs';

test('retries a locked target fetch with the shared Cargo network policy', async () => {
  const attempts = [];
  const delays = [];
  await fetchLockedCargoDependencies({
    target: 'x86_64-pc-windows-msvc',
    attempts: 3,
    delayMs: 25,
    environment: {},
    run: async (request) => {
      attempts.push(request);
      if (attempts.length < 3) throw new Error('partial transfer');
    },
    wait: async (delay) => delays.push(delay),
  });

  assert.equal(attempts.length, 3);
  assert.deepEqual(delays, [25, 50]);
  assert.equal(attempts[0].target, 'x86_64-pc-windows-msvc');
  assert.equal(typeof attempts[0].cwd, 'string');
  assert.deepEqual(attempts[0].environment, {
    CARGO_NET_RETRY: '2',
    CARGO_HTTP_TIMEOUT: '120',
    CARGO_HTTP_MULTIPLEXING: 'false',
  });
});

test('fails after the bounded fetch retry budget is exhausted', async () => {
  await assert.rejects(
    fetchLockedCargoDependencies({
      target: 'aarch64-pc-windows-msvc',
      attempts: 2,
      delayMs: 1,
      environment: {},
      run: async () => { throw new Error('network unavailable'); },
      wait: async () => {},
    }),
    (error) => error instanceof CargoDependencyFetchError
      && error.code === 'CARGO_FETCH_FAILED'
      && /after 2 attempts/.test(error.message),
  );
});

test('validates targets and preserves caller-provided Cargo network settings', () => {
  assert.throws(
    () => parseCargoFetchOptions(['--target', '../unsafe']),
    /safe Rust target triple/,
  );
  assert.deepEqual(
    cargoNetworkEnvironment({
      CARGO_NET_RETRY: '5',
      CARGO_HTTP_TIMEOUT: '90',
      CARGO_HTTP_MULTIPLEXING: 'true',
    }),
    {
      CARGO_NET_RETRY: '5',
      CARGO_HTTP_TIMEOUT: '90',
      CARGO_HTTP_MULTIPLEXING: 'true',
    },
  );
});
