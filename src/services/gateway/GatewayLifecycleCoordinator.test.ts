import assert from 'node:assert/strict';
import test from 'node:test';
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
  stop?: () => Promise<GatewayRestartResult>;
  reconnect?: () => void;
  reconnectSelectedRuntime?: () => void;
  captureConnectionId?: () => string | null;
  isConnectionCurrent?: (connectionId: string) => boolean;
  waitForConnection?: (
    previousConnectionId: string | null,
    timeoutMs?: number,
    signal?: AbortSignal,
  ) => Promise<string>;
  wait?: (delayMs: number) => Promise<boolean>;
  verifySelectedIdentity?: (expectedConnectionId: string) => Promise<boolean>;
  finishDirectRecovery?: () => void;
} = {}) {
  return new GatewayLifecycleCoordinator({
    manager: {
      ensureRunning: overrides.ensureRunning ?? (async () => ({ healthy: true, mode: 'native' })),
      restart: overrides.restart ?? (async () => ({ success: true })),
      stop: overrides.stop ?? (async () => ({ success: true })),
      reconnect: overrides.reconnect ?? (() => undefined),
      reconnectSelectedRuntime: overrides.reconnectSelectedRuntime ?? (() => undefined),
      finishDirectRecovery: overrides.finishDirectRecovery ?? (() => undefined),
    },
    connection: {
      captureConnectionId: overrides.captureConnectionId ?? (() => 'old-connection'),
      isConnectionCurrent: overrides.isConnectionCurrent ?? ((connectionId) => connectionId === 'new-connection'),
      waitForConnection: overrides.waitForConnection ?? (async () => 'new-connection'),
    },
    migrationRetry: {
      wait: overrides.wait ?? (async () => true),
      cancel: () => false,
    },
    ...(overrides.verifySelectedIdentity
      ? { verifySelectedIdentity: overrides.verifySelectedIdentity }
      : {}),
    captureRuntimeScope: () => 'selected-runtime',
  });
}

test('ordinary lifecycle requests share one frontend operation', async () => {
  const pending = deferred<GatewayRestartResult>();
  let calls = 0;
  const lifecycle = coordinator({ restart: () => { calls += 1; return pending.promise; } });

  const first = lifecycle.restart('status-bar');
  const second = lifecycle.restart('top-bar');
  assert.equal(first, second);
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(calls, 1);

  pending.resolve({ success: true });
  assert.equal((await first).success, true);
});

test('restart success is withheld until a new attested connection settles', async () => {
  const connection = deferred<string>();
  const previousConnectionIds: Array<string | null> = [];
  const lifecycle = coordinator({
    captureConnectionId: () => 'old-connection',
    waitForConnection: (previousConnectionId) => {
      previousConnectionIds.push(previousConnectionId);
      return connection.promise;
    },
  });

  let completed = false;
  const restart = lifecycle.restart('status-bar').then((result) => {
    completed = true;
    return result;
  });
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(completed, false);
  assert.deepEqual(previousConnectionIds, ['old-connection']);

  connection.resolve('new-connection');
  const result = await restart;
  assert.equal(result.success, true);
  assert.equal(result.connectionId, 'new-connection');
});

test('restart verifies the selected runtime only after the new connection settles', async () => {
  const events: string[] = [];
  const lifecycle = coordinator({
    restart: async () => {
      events.push('restart');
      return { success: true };
    },
    reconnectSelectedRuntime: () => {
      events.push('reconnect-selected-runtime');
    },
    waitForConnection: async () => {
      events.push('connection');
      return 'new-connection';
    },
    verifySelectedIdentity: async (connectionId) => {
      events.push(`identity:${connectionId}`);
      return true;
    },
  });

  assert.equal((await lifecycle.restart('setup')).success, true);
  assert.deepEqual(events, [
    'restart',
    'reconnect-selected-runtime',
    'connection',
    'identity:new-connection',
  ]);
});

test('restart fails when the connection changes while selected runtime identity is probed', async () => {
  let currentConnectionId = 'new-connection';
  const lifecycle = coordinator({
    isConnectionCurrent: (connectionId) => connectionId === currentConnectionId,
    verifySelectedIdentity: async () => {
      currentConnectionId = 'replacement-connection';
      return true;
    },
  });

  const result = await lifecycle.restart('setup');
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /does not match the selected runtime/);
});

test('lifecycle transaction releases setup-only runtime observation after settlement', async () => {
  let releases = 0;
  const lifecycle = coordinator({
    finishDirectRecovery: () => { releases += 1; },
  });

  assert.equal((await lifecycle.reconnect('setup')).success, true);
  assert.equal(releases, 1);
});

test('connection settlement failure makes the unified lifecycle fail', async () => {
  const result = await coordinator({
    waitForConnection: async () => { throw new Error('attested connection timed out'); },
  }).restart('channels-center');

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /attested connection timed out/);
});

test('stop is serialized by the same lifecycle coordinator', async () => {
  const pendingRestart = deferred<GatewayRestartResult>();
  const calls: string[] = [];
  const lifecycle = coordinator({
    restart: () => {
      calls.push('restart');
      return pendingRestart.promise;
    },
    stop: async () => {
      calls.push('stop');
      return { success: true };
    },
  });

  const restart = lifecycle.restart('settings');
  const stop = lifecycle.stop('settings');
  pendingRestart.resolve({ success: true });

  assert.equal((await restart).success, true);
  assert.equal((await stop).success, true);
  assert.deepEqual(calls, ['restart', 'stop']);
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

test('post-handoff reconnect waits for an existing lifecycle and returns its own result', async () => {
  const pending = deferred<GatewayRestartResult>();
  const calls: string[] = [];
  const lifecycle = coordinator({
    restart: () => { calls.push('restart'); return pending.promise; },
    reconnectSelectedRuntime: () => { calls.push('reconnect-selected-runtime'); },
  });

  const restart = lifecycle.restart('wizard-reclaim');
  const reconnect = lifecycle.reconnectSelectedRuntimeAfterCurrent('wizard-completion');
  pending.resolve({ success: true });

  assert.equal((await restart).action, 'restart');
  const result = await reconnect;
  assert.equal(result.success, true);
  assert.equal(result.action, 'reconnect');
  assert.equal(result.source, 'wizard-completion');
  assert.deepEqual(calls, [
    'restart',
    'reconnect-selected-runtime',
    'reconnect-selected-runtime',
  ]);
});

test('post-handoff reconnect forwards the remaining absolute deadline budget', async () => {
  const timeouts: Array<number | undefined> = [];
  const lifecycle = coordinator({
    waitForConnection: async (_previousConnectionId, timeoutMs) => {
      timeouts.push(timeoutMs);
      return 'new-connection';
    },
  });

  const controller = new AbortController();
  const result = await lifecycle.reconnectSelectedRuntimeAfterCurrent('wizard-completion', {
    deadline: Date.now() + 360_000,
    signal: controller.signal,
  });
  assert.equal(result.success, true);
  assert.equal(timeouts.length, 1);
  assert.ok((timeouts[0] ?? 0) > 350_000 && (timeouts[0] ?? 0) <= 360_000);
});

test('post-handoff reconnect includes an existing lifecycle in its timeout budget', async () => {
  const pending = deferred<GatewayRestartResult>();
  const lifecycle = coordinator({ restart: () => pending.promise });

  const restart = lifecycle.restart('existing-restart');
  const controller = new AbortController();
  const reconnect = await lifecycle.reconnectSelectedRuntimeAfterCurrent('wizard-completion', {
    deadline: Date.now() + 5,
    signal: controller.signal,
  });

  assert.equal(reconnect.success, false);
  assert.match(reconnect.error ?? '', /setup handoff deadline/);
  pending.resolve({ success: true });
  await restart;
});

test('setup handoff restart forwards the remaining absolute deadline budget', async () => {
  const timeouts: Array<number | undefined> = [];
  const lifecycle = coordinator({
    waitForConnection: async (_previousConnectionId, timeoutMs) => {
      timeouts.push(timeoutMs);
      return 'new-connection';
    },
  });

  const controller = new AbortController();
  const result = await lifecycle.restartAfterCurrent('wizard-reload-disabled', undefined, {
    deadline: Date.now() + 360_000,
    signal: controller.signal,
  }, 'revision-budget');
  assert.equal(result.success, true);
  assert.equal(timeouts.length, 1);
  assert.ok((timeouts[0] ?? 0) > 350_000 && (timeouts[0] ?? 0) <= 360_000);
});

test('setup handoff restart waits within the same budget before starting a destructive operation', async () => {
  const pending = deferred<GatewayRestartResult>();
  let restartCalls = 0;
  const lifecycle = coordinator({
    ensureRunning: () => new Promise<GatewayEnsureResult>(() => {}),
    restart: () => {
      restartCalls += 1;
      return pending.promise;
    },
  });

  void lifecycle.recover('existing-recovery');
  const controller = new AbortController();
  const result = await lifecycle.restartAfterCurrent(
    'wizard-reload-disabled',
    'reload disabled',
    { deadline: Date.now() + 5, signal: controller.signal },
    'revision-wait',
  );

  assert.equal(result.success, false);
  assert.equal(restartCalls, 0);
});

test('setup handoff migration wait cannot start restart after its absolute deadline', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let restartCalls = 0;
  const controller = new AbortController();
  const lifecycle = coordinator({
    wait: async (delayMs) => {
      assert.ok(delayMs <= 5);
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
      return true;
    },
    restart: async () => {
      restartCalls += 1;
      return { success: true };
    },
  });

  const result = await lifecycle.restartAfterCurrent(
    'wizard-reload-disabled',
    `startup migrations are already running; retry after ${future}`,
    { deadline: Date.now() + 5, signal: controller.signal },
    'revision-migration',
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /setup handoff deadline/);
  assert.equal(restartCalls, 0);
});

test('setup handoff deadline does not cancel an in-flight native restart and suppresses its reconnect', async () => {
  const pendingRestart = deferred<GatewayRestartResult>();
  const controller = new AbortController();
  let reconnects = 0;
  let connectionWaits = 0;
  const lifecycle = coordinator({
    restart: () => pendingRestart.promise,
    reconnectSelectedRuntime: () => { reconnects += 1; },
    waitForConnection: async () => {
      connectionWaits += 1;
      return 'new-connection';
    },
  });

  const resultPromise = lifecycle.restartAfterCurrent(
    'wizard-reload-disabled',
    'reload disabled',
    { deadline: Date.now() + 60_000, signal: controller.signal },
    'revision-abort',
  );
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  controller.abort();

  let settled = false;
  void resultPromise.finally(() => { settled = true; });
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(settled, false);
  assert.equal(lifecycle.running, true);

  pendingRestart.resolve({ success: true });

  const result = await resultPromise;
  assert.equal(result.success, false);
  assert.equal(reconnects, 0);
  assert.equal(connectionWaits, 0);
  assert.equal(lifecycle.running, false);
});

test('handoff idle barrier waits for the active native operation to settle', async () => {
  const pendingRestart = deferred<GatewayRestartResult>();
  const lifecycle = coordinator({ restart: () => pendingRestart.promise });
  const restart = lifecycle.restart('existing-restart');
  const controller = new AbortController();
  const idle = lifecycle.waitForIdle({
    deadline: Date.now() + 60_000,
    signal: controller.signal,
  });

  let settled = false;
  void idle.finally(() => { settled = true; });
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  assert.equal(settled, false);

  pendingRestart.resolve({ success: true });
  assert.deepEqual(await idle, {
    generation: 1,
    restartAttemptGeneration: 1,
    observedRestart: true,
  });
  assert.equal((await restart).success, true);
});

test('handoff idle receipt is invalidated when a lifecycle starts after the barrier', async () => {
  const pendingRestart = deferred<GatewayRestartResult>();
  const lifecycle = coordinator({ restart: () => pendingRestart.promise });
  const controller = new AbortController();
  const receipt = await lifecycle.waitForIdle({
    deadline: Date.now() + 60_000,
    signal: controller.signal,
  });
  assert.ok(receipt);
  assert.equal(lifecycle.isIdleReceiptCurrent(receipt!), true);

  const restart = lifecycle.restart('concurrent-restart');
  assert.equal(lifecycle.isIdleReceiptCurrent(receipt!), false);
  pendingRestart.resolve({ success: true });
  await restart;
});

test('handoff idle barrier records a restart performed inside recovery', async () => {
  const ensured = deferred<GatewayEnsureResult>();
  const restarted = deferred<GatewayRestartResult>();
  const lifecycle = coordinator({
    ensureRunning: () => ensured.promise,
    restart: () => restarted.promise,
  });
  const recovery = lifecycle.recover('dashboard');
  const controller = new AbortController();
  const idle = lifecycle.waitForIdle({
    deadline: Date.now() + 60_000,
    signal: controller.signal,
  });

  ensured.resolve({ healthy: false, error: 'not ready' });
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  restarted.resolve({ success: true });

  assert.deepEqual(await idle, {
    generation: 1,
    restartAttemptGeneration: 1,
    observedRestart: true,
  });
  assert.equal((await recovery).success, true);
});

test('completed historical restart is present in the receipt without being observed by a new barrier', async () => {
  const lifecycle = coordinator();
  assert.equal((await lifecycle.restart('settings')).success, true);

  const controller = new AbortController();
  assert.deepEqual(await lifecycle.waitForIdle({
    deadline: Date.now() + 60_000,
    signal: controller.signal,
  }), {
    generation: 1,
    restartAttemptGeneration: 1,
    observedRestart: false,
  });
});

test('failed native restart still advances the real restart attempt generation', async () => {
  const lifecycle = coordinator({
    restart: async () => ({ success: false, error: 'restart rejected' }),
  });
  assert.equal((await lifecycle.restart('settings')).success, false);

  const controller = new AbortController();
  const receipt = await lifecycle.waitForIdle({
    deadline: Date.now() + 60_000,
    signal: controller.signal,
  });
  assert.equal(receipt?.restartAttemptGeneration, 1);
  assert.equal(receipt?.observedRestart, false);
});

test('setup handoff compensation issues at most one process restart command', async () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  let restartCalls = 0;
  const controller = new AbortController();
  const lifecycle = coordinator({
    wait: async () => true,
    restart: async () => {
      restartCalls += 1;
      return {
        success: false,
        error: `startup migrations are already running; retry after ${future}`,
      };
    },
  });

  const result = await lifecycle.restartAfterCurrent(
    'wizard-reload-disabled',
    'reload disabled',
    { deadline: Date.now() + 60_000, signal: controller.signal },
    'revision-once',
  );

  assert.equal(result.success, false);
  assert.equal(restartCalls, 1);
});

test('setup handoff does not replay compensation for the same runtime revision', async () => {
  let restartCalls = 0;
  const lifecycle = coordinator({
    restart: async () => {
      restartCalls += 1;
      return { success: true };
    },
  });
  const firstController = new AbortController();
  const first = await lifecycle.restartAfterCurrent(
    'wizard-reload-disabled',
    'reload disabled',
    { deadline: Date.now() + 60_000, signal: firstController.signal },
    'same-revision',
  );
  assert.equal(first.success, true);

  const secondController = new AbortController();
  const second = await lifecycle.restartAfterCurrent(
    'wizard-reload-disabled',
    'reload disabled',
    { deadline: Date.now() + 60_000, signal: secondController.signal },
    'same-revision',
  );
  assert.equal(second.success, false);
  assert.match(second.error ?? '', /already attempted/);
  assert.equal(restartCalls, 1);
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

test('an unreported runtime mode is not rendered as Native', async () => {
  const messages: string[] = [];
  const c = coordinator({ ensureRunning: async () => ({ healthy: true }) });
  c.subscribe((progress) => messages.push(progress.message));
  await c.recover('startup');
  assert.ok(messages.some((message) => message.includes('Gateway healthy')));
  assert.ok(!messages.some((message) => /native/i.test(message)));
});
