import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getGatewayDeviceIdentityReference,
  resetGatewayDeviceIdentityReferenceForTests,
} from './deviceAuthentication';

type TauriInternals = {
  invoke?: (command: string, args?: unknown) => Promise<unknown>;
};

const tauriWindow = globalThis.window as Window & { __TAURI_INTERNALS__?: TauriInternals };

test('并发设备身份查询只发起一次原生 IPC', async () => {
  resetGatewayDeviceIdentityReferenceForTests();
  const previous = tauriWindow.__TAURI_INTERNALS__;
  let calls = 0;
  tauriWindow.__TAURI_INTERNALS__ = {
    ...previous,
    invoke: async (command) => {
      assert.equal(command, 'get_gateway_device_identity_reference');
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { deviceId: 'device-1', publicKey: 'public-key-1' };
    },
  };

  try {
    const [first, second] = await Promise.all([
      getGatewayDeviceIdentityReference(),
      getGatewayDeviceIdentityReference(),
    ]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
  } finally {
    tauriWindow.__TAURI_INTERNALS__ = previous;
  }
});

test('设备身份查询失败后可以重新发起原生 IPC', async () => {
  resetGatewayDeviceIdentityReferenceForTests();
  const previous = tauriWindow.__TAURI_INTERNALS__;
  let calls = 0;
  tauriWindow.__TAURI_INTERNALS__ = {
    ...previous,
    invoke: async () => {
      calls += 1;
      if (calls === 1) throw new Error('credential denied');
      return { deviceId: 'device-2', publicKey: 'public-key-2' };
    },
  };

  try {
    await assert.rejects(getGatewayDeviceIdentityReference(), /credential denied/);
    assert.deepEqual(await getGatewayDeviceIdentityReference(), {
      deviceId: 'device-2',
      publicKey: 'public-key-2',
    });
    assert.equal(calls, 2);
  } finally {
    tauriWindow.__TAURI_INTERNALS__ = previous;
  }
});
