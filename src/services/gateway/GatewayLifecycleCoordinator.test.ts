import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  GatewayLifecycleCoordinator,
  type GatewayEnsureResult,
  type GatewayRestartResult,
} from './GatewayLifecycleCoordinator';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function coordinator(overrides: {
  ensureRunning?: () => Promise<GatewayEnsureResult>;
  restart?: () => Promise<GatewayRestartResult>;
  reconnect?: () => void;
  wait?: (delayMs: number) => Promise<boolean>;
  verifySelectedIdentity?: () => Promise<boolean>;
} = {}) {
  return new GatewayLifecycleCoordinator({
    manager: {
      ensureRunning: overrides.ensureRunning ?? (async () => ({ healthy: true, mode: 'native' })),
      restart: overrides.restart ?? (async () => ({ success: true })),
      reconnect: overrides.reconnect ?? (() => undefined),
    },
    migrationRetry: {
      wait: overrides.wait ?? (async () => true),
      cancel: () => false,
    },
    ...(overrides.verifySelectedIdentity
      ? { verifySelectedIdentity: overrides.verifySelectedIdentity }
      : {}),
  });
}

test('ordinary lifecycle requests share one frontend operation', async () => {
  const pending = deferred<GatewayRestartResult>();
  let calls = 0;
  const lifecycle = coordinator({ restart: () => { calls += 1; return pending.promise; } });

  const first = lifecycle.restart('status-bar');
  const second = lifecycle.restart('top-bar');
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);

  pending.resolve({ success: true });
  assert.equal((await first).success, true);
});

test('a stronger restart requested during recovery is queued instead of being dropped', async () => {
  const pending = deferred<GatewayEnsureResult>();
  const calls: string[] = [];
  const lifecycle = coordinator({
    ensureRunning: () => { calls.push('ensure'); return pending.promise; },
    restart: async () => { calls.push('restart'); return { success: true }; },
  });

  const recovery = lifecycle.recover('dashboard');
  const restart = lifecycle.restart('status-bar');
  pending.resolve({ healthy: true, mode: 'native' });

  assert.equal((await recovery).success, true);
  assert.equal((await restart).success, true);
  assert.deepEqual(calls, ['ensure', 'restart']);
});

test('an unexpected active failure is normalized and a queued restart still runs', async () => {
  const pending = deferred<GatewayRestartResult>();
  const calls: string[] = [];
  const lifecycle = coordinator({
    reconnect: () => { calls.push('reconnect'); throw new Error('unexpected reconnect failure'); },
    restart: () => { calls.push('restart'); return pending.promise; },
  });

  const reconnect = lifecycle.reconnect('dashboard');
  const restart = lifecycle.restart('top-bar');
  assert.equal((await reconnect).success, false);
  pending.resolve({ success: true });
  assert.equal((await restart).success, true);
  assert.deepEqual(calls, ['reconnect', 'restart']);
  assert.equal(lifecycle.running, false);
});

test('recover ensures the selected runtime before using destructive restart', async () => {
  const calls: string[] = [];
  const lifecycle = coordinator({
    ensureRunning: async () => { calls.push('ensure'); return { healthy: false, error: 'not ready' }; },
    restart: async () => { calls.push('restart'); return { success: true }; },
  });

  assert.equal((await lifecycle.recover('dashboard')).success, true);
  assert.deepEqual(calls, ['ensure', 'restart']);
});

test('recover does not restart an already healthy selected runtime', async () => {
  let restartCalls = 0;
  const lifecycle = coordinator({
    ensureRunning: async () => ({ healthy: true, mode: 'system-service' }),
    restart: async () => { restartCalls += 1; return { success: true }; },
  });

  const result = await lifecycle.recover('settings');
  assert.equal(result.success, true);
  assert.equal(result.mode, 'system-service');
  assert.equal(restartCalls, 0);
});

test('restart waits for an active OpenClaw startup migration lease', async () => {
  const future = new Date(Date.now() + 2_000).toISOString();
  const calls: string[] = [];
  const lifecycle = coordinator({
    wait: async (delayMs) => { assert.ok(delayMs > 0); calls.push('wait'); return true; },
    restart: async () => { calls.push('restart'); return { success: true }; },
  });

  const result = await lifecycle.restart('config-manager', `startup migrations are already running; retry after ${future}`);
  assert.equal(result.success, true);
  assert.deepEqual(calls, ['wait', 'restart']);
});

test('migration cancellation publishes a failed terminal progress event', async () => {
  const future = new Date(Date.now() + 2_000).toISOString();
  const lifecycle = coordinator({ wait: async () => false });
  const progress: string[] = [];
  lifecycle.subscribe((event) => progress.push(`${event.status}:${event.progress}:${event.key}`));

  const result = await lifecycle.restart('config-manager', `startup migrations are already running; retry after ${future}`);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /cancelled/);
  assert.equal(progress.at(-1), 'failed:1:gateway.progress.restartFailed');
});

test('progress is monotonic during recovery and migration wait', async () => {
  const future = new Date(Date.now() + 2_000).toISOString();
  const lifecycle = coordinator({
    ensureRunning: async () => ({ healthy: false, error: `startup migrations are already running; retry after ${future}` }),
    wait: async () => true,
  });
  const progress: number[] = [];
  lifecycle.subscribe((event) => progress.push(event.progress));

  assert.equal((await lifecycle.recover('dashboard')).success, true);
  assert.deepEqual(progress, [...progress].sort((left, right) => left - right));
});

test('a failing progress listener cannot change the lifecycle result', async () => {
  const lifecycle = coordinator();
  lifecycle.subscribe(() => { throw new Error('render failed'); });

  assert.equal((await lifecycle.restart('status-bar')).success, true);
});

test('restart returns one structured failure and publishes terminal progress', async () => {
  const lifecycle = coordinator({ restart: async () => ({ success: false, error: 'service denied' }) });
  const progress: string[] = [];
  lifecycle.subscribe((event) => progress.push(`${event.status}:${event.key}`));

  const result = await lifecycle.restart('channels-center');
  assert.deepEqual(result, {
    success: false,
    error: 'service denied',
    action: 'restart',
    source: 'channels-center',
  });
  assert.equal(progress.at(-1), 'failed:gateway.progress.restartFailed');
});

// A healthy port cannot distinguish the selected Gateway from another local
// process bound to the same port. Only the wizard used to check; every other
// restart source reported success without re-attesting identity.
test('a restart that lands on a foreign Gateway is not reported as success', async () => {
  const result = await coordinator({
    restart: async () => ({ success: true }),
    verifySelectedIdentity: async () => false,
  }).restart('config-manager');
  assert.equal(result.success, false);
  assert.match(String(result.error), /does not match the selected runtime/);
});

test('an unreachable identity probe counts as unverified, never as a pass', async () => {
  const result = await coordinator({
    restart: async () => ({ success: true }),
    verifySelectedIdentity: async () => { throw new Error('probe unavailable'); },
  }).restart('channel-config');
  assert.equal(result.success, false);
});

test('a verified restart still succeeds', async () => {
  let probes = 0;
  const result = await coordinator({
    restart: async () => ({ success: true }),
    verifySelectedIdentity: async () => { probes += 1; return true; },
  }).restart('config-manager');
  assert.equal(result.success, true);
  assert.equal(probes, 1);
});

test('a failed restart does not reach the identity probe', async () => {
  let probes = 0;
  const result = await coordinator({
    restart: async () => ({ success: false, error: 'service missing' }),
    verifySelectedIdentity: async () => { probes += 1; return true; },
  }).restart('config-manager');
  assert.equal(result.success, false);
  assert.equal(probes, 0);
});

// HA-04: the coordinator has no Docker branch. That is not necessarily wrong -
// the manager below it owns runtime selection - but it means the coordinator
// must stay runtime-agnostic rather than growing Native-only assumptions.
// These tests fix that boundary; changing the behaviour needs Docker hardware.
test('the coordinator carries runtime failures through without reinterpreting them', async () => {
  for (const error of [
    'Docker daemon is not running',
    'Gateway autostart requires the Native runtime',
  ]) {
    const result = await coordinator({
      restart: async () => ({ success: false, error }),
    }).restart('config-manager');
    assert.equal(result.success, false);
    // The runtime's own diagnostic must survive verbatim: rewriting it into a
    // generic message is how a Docker failure ends up looking like a Native one.
    assert.equal(result.error, error);
  }
});

test('identity verification is asked for regardless of runtime', async () => {
  // The probe resolves the selected runtime itself, so the coordinator must not
  // skip it based on any local guess about which runtime is active.
  let probes = 0;
  await coordinator({
    restart: async () => ({ success: true }),
    verifySelectedIdentity: async () => { probes += 1; return true; },
  }).restart('channel-config');
  await coordinator({
    restart: async () => ({ success: true, method: 'docker' }),
    verifySelectedIdentity: async () => { probes += 1; return true; },
  }).restart('config-manager');
  assert.equal(probes, 2);
});

test('the coordinator holds no runtime-specific branching of its own', () => {
  const source = readFileSync('src/services/gateway/GatewayLifecycleCoordinator.ts', 'utf8');
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  // No runtime name may steer control flow or be used as a display default.
  assert.doesNotMatch(code, /docker/i);
  assert.doesNotMatch(code, /['"`]native['"`]/i);
});

test('an unreported runtime mode is not rendered as Native', async () => {
  const messages: string[] = [];
  const c = coordinator({ ensureRunning: async () => ({ healthy: true }) });
  c.subscribe((progress) => messages.push(progress.message));
  await c.recover('startup');
  assert.ok(messages.some((message) => message.includes('Gateway healthy')));
  assert.ok(!messages.some((message) => /native/i.test(message)));
});
