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
  } finally {
    manager.destroy();
  }
});
