import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayConnectionManager } from './GatewayConnectionManager';
import { GatewayState, type GatewayStateSnapshot } from './types';

type DeferredStart = (result: { success: boolean; error?: string }) => void;

function installGatewayBridge(overrides: Record<string, unknown> = {}): () => void {
  const host = window as any;
  const previous = host.aegis;
  host.aegis = {
    gateway: {
      onStatusChanged: () => () => {},
      ...overrides,
    },
  };
  return () => {
    host.aegis = previous;
  };
}

test('BUG-GSC09 ensure rejection commits a visible error instead of retrying forever', async () => {
  const restore = installGatewayBridge({
    ensureRunning: async () => {
      throw new Error('native ensure failed');
    },
  });
  const manager = new GatewayConnectionManager();
  const snapshots: GatewayStateSnapshot[] = [];
  try {
    manager.init();
    manager.onStateChange((snapshot) => snapshots.push(snapshot));

    const result = await manager.ensureRunning();

    assert.equal(result.healthy, false);
    assert.match(result.error, /native ensure failed/);
    assert.equal(snapshots.at(-1)?.state, GatewayState.ERROR);
    assert.equal(snapshots.at(-1)?.retrying, false);
    assert.match(snapshots.at(-1)?.error ?? '', /native ensure failed/);
  } finally {
    manager.destroy();
    restore();
  }
});

test('BUG-GSC09 superseded setup start rejects and a later start can run', async () => {
  const starts: DeferredStart[] = [];
  const restore = installGatewayBridge({
    start: () => new Promise((resolve) => starts.push(resolve)),
  });
  const manager = new GatewayConnectionManager();
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
    restore();
  }
});
