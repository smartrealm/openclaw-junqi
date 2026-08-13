import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayConnectionManager } from './GatewayConnectionManager';
import { GatewayState, type GatewayStateSnapshot } from './types';

type DeferredStart = (result: { success: boolean; error?: string; port?: number }) => void;

test('BUG-GSC09 ensure rejection commits a visible error instead of retrying forever', async () => {
  const manager = new GatewayConnectionManager(undefined, {
    observe: async () => ({ running: false, processAlive: false, ready: false, retrying: false, error: null, logs: { stdout: '', stderr: '' } }),
    subscribe: () => () => {},
    ensure: async () => { throw new Error('native ensure failed'); },
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  });
  const snapshots: GatewayStateSnapshot[] = [];
  try {
    manager.init();
    manager.onStateChange((snapshot) => snapshots.push(snapshot));

    const result = await manager.ensureRunning();

    assert.equal(result.healthy, false);
    assert.match(result.error ?? '', /native ensure failed/);
    assert.equal(snapshots.at(-1)?.state, GatewayState.ERROR);
    assert.equal(snapshots.at(-1)?.retrying, false);
    assert.match(snapshots.at(-1)?.error ?? '', /native ensure failed/);
  } finally {
    manager.destroy();
  }
});

test('BUG-GSC09 superseded setup start rejects and a later start can run', async () => {
  const starts: DeferredStart[] = [];
  const manager = new GatewayConnectionManager({
    connect: async () => undefined,
    start: () => new Promise((resolve) => starts.push(resolve)),
    startDocker: async () => ({ success: true }),
  });
  try {
    manager.init();
    const first = manager.startForSetup();
    const firstRejected = assert.rejects(first, /Gateway lifecycle was reset/);

    manager.reset();
    await firstRejected;

    const second = manager.startForSetup();
    assert.equal(starts.length, 2);
    starts[0]({ success: true });
    starts[1]({ success: false, error: 'second start reached native bridge' });
    await assert.rejects(second, /second start reached native bridge/);
  } finally {
    manager.destroy();
  }
});

test('统一停止入口提交所选运行时停止结果并收敛连接状态', async () => {
  let stops = 0;
  const manager = new GatewayConnectionManager(undefined, {
    observe: async () => ({ running: true, processAlive: true, ready: true, retrying: false, error: null, logs: { stdout: '', stderr: '' } }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => {
      stops += 1;
      return { success: true };
    },
  });
  const snapshots: GatewayStateSnapshot[] = [];
  try {
    manager.init();
    manager.onStateChange((snapshot) => snapshots.push(snapshot));
    const result = await manager.stop();

    assert.equal(result.success, true);
    assert.equal(stops, 1);
    assert.equal(snapshots.at(-1)?.state, GatewayState.DETECTING);
    assert.equal(snapshots.at(-1)?.connected, false);
    assert.equal(snapshots.at(-1)?.error, null);
  } finally {
    manager.destroy();
  }
});

test('首次配置阶段未初始化管理器时仍能主动重连', async () => {
  let connects = 0;
  const manager = new GatewayConnectionManager({
    connect: async () => { connects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  });
  try {
    manager.reconnect();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.equal(connects, 1);
  } finally {
    manager.destroy();
  }
});

test('首次配置交接跨越 Gateway 重启窗口后继续观察所选运行时', async () => {
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  let connects = 0;
  const manager = new GatewayConnectionManager({
    connect: async () => { connects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: false,
      processAlive: false,
      ready: false,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => { runtimeListener = undefined; };
    },
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  });
  try {
    manager.reconnectSelectedRuntime();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(connects, 0);

    runtimeListener?.({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    });
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.equal(connects, 1);
  } finally {
    manager.destroy();
  }
});

test('首次设置启动前断开旧连接并在启动成功后重新连接', async () => {
  const events: string[] = [];
  const manager = new GatewayConnectionManager({
    connect: async (_onHttpUrl, _isCurrent, options) => {
      events.push(`connect:${String(options?.targetRequest?.targetScope)}`);
    },
    start: async () => {
      events.push('start');
      return { success: true, port: 18789 };
    },
    startDocker: async () => ({ success: true }),
  }, undefined, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => { events.push('disconnect'); },
  });
  try {
    manager.init();
    await manager.startForSetup();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.deepEqual(events, ['disconnect', 'start', 'connect:selected-runtime']);
  } finally {
    manager.destroy();
  }
});

test('首次设置等待启动命令完成后才连接所选运行时', async () => {
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  let completeStart: DeferredStart | undefined;
  const targetScopes: Array<string | undefined> = [];
  const manager = new GatewayConnectionManager({
    connect: async (_onHttpUrl, _isCurrent, options) => {
      targetScopes.push(options?.targetRequest?.targetScope);
    },
    start: () => new Promise((resolve) => {
      completeStart = resolve;
    }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: false,
      processAlive: false,
      ready: false,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => undefined;
    },
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
  });
  try {
    manager.init();
    const start = manager.startForSetup();
    runtimeListener?.({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    });
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.deepEqual(targetScopes, []);

    completeStart?.({ success: true, port: 18789 });
    await start;
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.deepEqual(targetScopes, ['selected-runtime']);
  } finally {
    manager.destroy();
  }
});

test('首次设置启动失败后不会把专用目标策略泄漏到普通重连', async () => {
  const targetScopes: Array<string | undefined> = [];
  const manager = new GatewayConnectionManager({
    connect: async (_onHttpUrl, _isCurrent, options) => {
      targetScopes.push(options?.targetRequest?.targetScope);
    },
    start: async () => ({ success: false, error: 'setup start failed' }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
  });
  try {
    await assert.rejects(manager.startForSetup(), /setup start failed/);
    manager.reconnect();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.deepEqual(targetScopes, [undefined]);
  } finally {
    manager.destroy();
  }
});

test('普通重连继续使用显式保存的 Gateway 地址解析规则', async () => {
  const targetScopes: Array<string | undefined> = [];
  const manager = new GatewayConnectionManager({
    connect: async (_onHttpUrl, _isCurrent, options) => {
      targetScopes.push(options?.targetRequest?.targetScope);
    },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
  });
  try {
    manager.reconnect();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.deepEqual(targetScopes, [undefined]);
  } finally {
    manager.destroy();
  }
});

test('官方配置交接重连重新解析当前所选运行时', async () => {
  const targetScopes: Array<string | undefined> = [];
  const manager = new GatewayConnectionManager({
    connect: async (_onHttpUrl, _isCurrent, options) => {
      targetScopes.push(options?.targetRequest?.targetScope);
    },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
  });
  try {
    manager.reconnectSelectedRuntime();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.deepEqual(targetScopes, ['selected-runtime']);
  } finally {
    manager.destroy();
  }
});

test('连接目标解析失败由统一状态机提交错误且不产生未处理拒绝', async () => {
  const snapshots: GatewayStateSnapshot[] = [];
  const manager = new GatewayConnectionManager({
    connect: async () => {
      throw new Error('selected runtime target unavailable');
    },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
  });
  try {
    manager.onStateChange((snapshot) => snapshots.push(snapshot));
    manager.reconnect();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.equal(snapshots.at(-1)?.state, GatewayState.ERROR);
    assert.match(snapshots.at(-1)?.error ?? '', /selected runtime target unavailable/);
    assert.match(snapshots.at(-1)?.connectionAttemptError ?? '', /selected runtime target unavailable/);

    manager.notifyWsClose();
    assert.equal(manager.getStateSnapshot().state, GatewayState.ERROR);
    assert.match(manager.getStateSnapshot().connectionAttemptError ?? '', /selected runtime target unavailable/);
  } finally {
    manager.destroy();
  }
});

test('初始化时保留 Connection 可回放的耗尽终态', () => {
  const manager = new GatewayConnectionManager(undefined, {
    observe: async () => ({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => undefined,
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
    subscribeRetryState: (listener) => {
      listener({
        phase: 'exhausted',
        attempt: 3,
        maxAttempts: 3,
        error: 'stored transport exhaustion',
      });
      return () => undefined;
    },
  });
  try {
    manager.init();

    const snapshot = manager.getStateSnapshot();
    assert.equal(snapshot.state, GatewayState.ERROR);
    assert.equal(snapshot.error, 'stored transport exhaustion');
    assert.equal(snapshot.connectionAttemptError, 'stored transport exhaustion');
  } finally {
    manager.destroy();
  }
});

test('进程观察瞬时错误只保留诊断且不终止当前连接收敛', async () => {
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  const manager = new GatewayConnectionManager(undefined, {
    observe: async () => ({
      running: false,
      processAlive: false,
      ready: false,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => { runtimeListener = undefined; };
    },
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  });
  try {
    manager.init();
    runtimeListener?.({
      running: false,
      processAlive: false,
      ready: false,
      retrying: false,
      error: 'temporary process probe failure',
      logs: { stdout: '', stderr: '' },
    });

    const snapshot = manager.getStateSnapshot();
    assert.equal(snapshot.state, GatewayState.ERROR);
    assert.equal(snapshot.error, 'temporary process probe failure');
    assert.equal(snapshot.connectionAttemptError, null);
  } finally {
    manager.destroy();
  }
});

test('进程管理器等待原生重启完成且不自行触发重连', async () => {
  let finishRestart: ((result: { success: boolean }) => void) | undefined;
  let connects = 0;
  let disconnects = 0;
  const manager = new GatewayConnectionManager({
    connect: async () => { connects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: false,
      processAlive: false,
      ready: false,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: () => () => {},
    ensure: async () => ({ healthy: true }),
    restart: () => new Promise((resolve) => { finishRestart = resolve; }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => { disconnects += 1; },
  });
  try {
    const restart = manager.restart();
    let settled = false;
    void restart.finally(() => { settled = true; });
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(settled, false);

    finishRestart?.({ success: true });

    const result = await restart;
    assert.equal(result.success, true);
    assert.equal(disconnects, 1);
    assert.equal(connects, 0);
  } finally {
    manager.destroy();
  }
});

test('传输层拥有连接轮次后进程健康轮询不得重置退避或耗尽状态', async () => {
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  let retryListener: ((state: import('./Connection').GatewayRetryState) => void) | undefined;
  let connects = 0;
  const ready = {
    running: true,
    processAlive: true,
    ready: true,
    retrying: false,
    error: null,
    logs: { stdout: '', stderr: '' },
  };
  const manager = new GatewayConnectionManager({
    connect: async () => { connects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({ ...ready, running: false, processAlive: false, ready: false }),
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => { runtimeListener = undefined; };
    },
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => {
      retryListener?.({ phase: 'idle', attempt: 0, maxAttempts: 3 });
    },
    subscribeRetryState: (listener) => {
      retryListener = listener;
      listener({ phase: 'idle', attempt: 0, maxAttempts: 3 });
      return () => { retryListener = undefined; };
    },
  });
  try {
    manager.init();
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(connects, 1);

    retryListener?.({ phase: 'attempting', attempt: 1, maxAttempts: 3 });
    manager.notifyWsClose();
    retryListener?.({ phase: 'backoff', attempt: 2, maxAttempts: 3, delayMs: 1_000 });
    runtimeListener?.(ready);
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(connects, 1);
    assert.equal(manager.getStateSnapshot().state, GatewayState.CONNECTING);

    retryListener?.({
      phase: 'exhausted',
      attempt: 3,
      maxAttempts: 3,
      error: 'runtime identity attestation failed',
    });
    runtimeListener?.(ready);
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    const exhausted = manager.getStateSnapshot();
    assert.equal(connects, 1);
    assert.equal(exhausted.state, GatewayState.ERROR);
    assert.equal(exhausted.connectionAttemptError, 'runtime identity attestation failed');
    assert.equal(exhausted.error, 'runtime identity attestation failed');

    manager.retry();
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(connects, 2);
  } finally {
    manager.destroy();
  }
});

test('原生重启期间连接轮次停用且完成后不由进程观察迟到重连', async () => {
  let finishRestart: ((result: { success: boolean }) => void) | undefined;
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  let connects = 0;
  let disconnects = 0;
  const ready = {
    running: true,
    processAlive: true,
    ready: true,
    retrying: false,
    error: null,
    logs: { stdout: '', stderr: '' },
  };
  const manager = new GatewayConnectionManager({
    connect: async () => { connects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({ ...ready, running: false, processAlive: false, ready: false }),
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => { runtimeListener = undefined; };
    },
    ensure: async () => ({ healthy: true }),
    restart: () => new Promise((resolve) => { finishRestart = resolve; }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => { disconnects += 1; },
  });
  try {
    manager.init();
    const restart = manager.restart();
    runtimeListener?.(ready);
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(disconnects, 1);
    assert.equal(connects, 0);

    finishRestart?.({ success: true });
    assert.equal((await restart).success, true);
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(connects, 0);

    manager.reconnectSelectedRuntime();
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(connects, 1);
  } finally {
    manager.destroy();
  }
});

test('直接连接入口已拥有轮次时健康观察不得再发第二个 CONNECT', async () => {
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  let directConnects = 0;
  let observedConnects = 0;
  const transportEvents: string[] = [];
  const manager = new GatewayConnectionManager({
    connect: async () => { observedConnects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ({
      running: false,
      processAlive: false,
      ready: false,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    }),
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => { runtimeListener = undefined; };
    },
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => {
      directConnects += 1;
      transportEvents.push('connect');
    },
    reconnectWithToken: () => undefined,
    disconnect: () => { transportEvents.push('disconnect'); },
  });
  try {
    manager.connect('ws://127.0.0.1:18789', 'token');
    runtimeListener?.({
      running: true,
      processAlive: true,
      ready: true,
      retrying: false,
      error: null,
      logs: { stdout: '', stderr: '' },
    });
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.equal(directConnects, 1);
    assert.equal(observedConnects, 0);
    assert.deepEqual(transportEvents, ['disconnect', 'connect']);
  } finally {
    manager.destroy();
  }
});

test('取消配对通过统一管理器结束传输轮次且健康观察不得自动重连', async () => {
  let runtimeListener: ((status: {
    running: boolean;
    processAlive: boolean;
    ready: boolean;
    retrying: boolean;
    error: string | null;
    logs: { stdout: string; stderr: string };
  }) => void) | undefined;
  let retryListener: ((state: import('./Connection').GatewayRetryState) => void) | undefined;
  let observedConnects = 0;
  let pairingCancellations = 0;
  const ready = {
    running: true,
    processAlive: true,
    ready: true,
    retrying: false,
    error: null,
    logs: { stdout: '', stderr: '' },
  };
  const manager = new GatewayConnectionManager({
    connect: async () => { observedConnects += 1; },
    start: async () => ({ success: true }),
    startDocker: async () => ({ success: true }),
  }, {
    observe: async () => ready,
    subscribe: (listener) => {
      runtimeListener = listener;
      return () => { runtimeListener = undefined; };
    },
    ensure: async () => ({ healthy: true }),
    restart: async () => ({ success: true }),
    stop: async () => ({ success: true }),
  }, {
    connect: () => undefined,
    reconnectWithToken: () => undefined,
    disconnect: () => undefined,
    stopPairingRetry: () => {
      pairingCancellations += 1;
      retryListener?.({ phase: 'backoff', attempt: 1, maxAttempts: 3, delayMs: 1_000 });
      retryListener?.({ phase: 'idle', attempt: 0, maxAttempts: 3 });
    },
    subscribeRetryState: (listener) => {
      retryListener = listener;
      listener({ phase: 'idle', attempt: 0, maxAttempts: 3 });
      return () => { retryListener = undefined; };
    },
  });
  try {
    manager.init();
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(observedConnects, 1);

    retryListener?.({ phase: 'backoff', attempt: 1, maxAttempts: 3, delayMs: 1_000 });
    assert.equal(manager.getStateSnapshot().state, GatewayState.CONNECTING);

    manager.cancelPairing();
    runtimeListener?.(ready);
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));

    assert.equal(pairingCancellations, 1);
    assert.equal(observedConnects, 1);
    assert.equal(manager.getStateSnapshot().state, GatewayState.DETECTING);
    assert.equal(manager.getStateSnapshot().retrying, false);

    manager.retry();
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(observedConnects, 2);
  } finally {
    manager.destroy();
  }
});
