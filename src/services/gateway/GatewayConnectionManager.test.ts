import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayConnectionManager } from './GatewayConnectionManager';
import { GatewayState, type GatewayStateSnapshot } from './types';

type DeferredStart = (result: { success: boolean; error?: string }) => void;

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
