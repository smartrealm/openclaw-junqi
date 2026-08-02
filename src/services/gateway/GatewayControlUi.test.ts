import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openSelectedGatewayControlUi,
  type GatewayControlUiDependencies,
} from './GatewayControlUi';

function dependencies(
  overrides: Partial<GatewayControlUiDependencies> = {},
): GatewayControlUiDependencies {
  return {
    getStatus: async () => ({ running: true, port: 18789, pid: 1, token: null }),
    probeReady: async () => true,
    open: async () => {},
    ...overrides,
  };
}

test('Control UI opens only after the selected Gateway passes authenticated readiness', async () => {
  let port = 0;
  let opened = false;
  const result = await openSelectedGatewayControlUi(dependencies({
    probeReady: async (value) => {
      port = value;
      return true;
    },
    open: async () => { opened = true; },
  }));

  assert.deepEqual(result, { success: true });
  assert.equal(port, 18789);
  assert.equal(opened, true);
});

test('Control UI never opens for a stopped or unauthenticated runtime', async () => {
  let opened = false;
  const stopped = await openSelectedGatewayControlUi(dependencies({
    getStatus: async () => ({ running: false, port: 18789, pid: null, token: null }),
    open: async () => { opened = true; },
  }));
  const unready = await openSelectedGatewayControlUi(dependencies({
    probeReady: async () => false,
    open: async () => { opened = true; },
  }));

  assert.equal(stopped.success, false);
  assert.equal(unready.success, false);
  assert.equal(opened, false);
});
