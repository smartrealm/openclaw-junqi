import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoArmSessionKey,
  clearAutoArmSession,
  disableVoiceWakeStandby,
  enableVoiceWakeStandby,
  setAutoArmSession,
  subscribeAutoArmPreference,
} from './VoiceWakePreference';

test('standby preference notifies the application runtime on enable and disable', () => {
  localStorage.clear();
  let notifications = 0;
  const unsubscribe = subscribeAutoArmPreference(() => { notifications += 1; });

  setAutoArmSession('agent:main:main');
  assert.equal(autoArmSessionKey(), 'agent:main:main');
  clearAutoArmSession();
  assert.equal(autoArmSessionKey(), null);
  assert.equal(notifications, 2);

  unsubscribe();
  localStorage.clear();
});

test('standby binding publishes only after system autostart confirms enablement', async () => {
  localStorage.clear();
  let resolveEnable!: (status: { enabled: boolean }) => void;
  let notifications = 0;
  const unsubscribe = subscribeAutoArmPreference(() => { notifications += 1; });
  const enabling = enableVoiceWakeStandby('agent:main:main', {
    enable: () => new Promise((resolve) => { resolveEnable = resolve; }),
    disable: async () => ({ enabled: false }),
  });

  await Promise.resolve();
  assert.equal(autoArmSessionKey(), null);
  assert.equal(notifications, 0);
  resolveEnable({ enabled: true });
  await enabling;
  assert.equal(notifications, 1);

  unsubscribe();
  localStorage.clear();
});

test('unconfirmed autostart mutations retain the prior standby binding', async () => {
  localStorage.clear();
  setAutoArmSession('agent:main:existing');

  await assert.rejects(
    enableVoiceWakeStandby('agent:main:next', {
      enable: async () => ({ enabled: false }),
      disable: async () => ({ enabled: false }),
    }),
    /app_autostart_enable_not_confirmed/,
  );
  assert.equal(autoArmSessionKey(), 'agent:main:existing');

  await assert.rejects(
    disableVoiceWakeStandby({
      enable: async () => ({ enabled: true }),
      disable: async () => ({ enabled: true }),
    }),
    /app_autostart_disable_not_confirmed/,
  );
  assert.equal(autoArmSessionKey(), 'agent:main:existing');
  localStorage.clear();
});

test('failed local persistence rolls system autostart back to the prior standby state', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  assert.ok(originalStorage);
  const storage = localStorage;
  const actions: string[] = [];
  const failingWriteStorage: Storage = {
    get length() { return storage.length; },
    clear: () => storage.clear(),
    getItem: (key) => storage.getItem(key),
    key: (index) => storage.key(index),
    removeItem: (key) => storage.removeItem(key),
    setItem: () => { throw new Error('local_write_failed'); },
  };

  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: failingWriteStorage,
    });
    await assert.rejects(
      enableVoiceWakeStandby('agent:main:main', {
        enable: async () => { actions.push('enable'); return { enabled: true }; },
        disable: async () => { actions.push('disable'); return { enabled: false }; },
      }),
      /local_write_failed/,
    );
    assert.deepEqual(actions, ['enable', 'disable']);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', originalStorage);
    localStorage.clear();
  }
});

test('failed local clearing restores system autostart', async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  assert.ok(originalStorage);
  const storage = localStorage;
  const actions: string[] = [];
  const failingClearStorage: Storage = {
    get length() { return storage.length; },
    clear: () => storage.clear(),
    getItem: (key) => storage.getItem(key),
    key: (index) => storage.key(index),
    removeItem: () => { throw new Error('local_clear_failed'); },
    setItem: (key, value) => storage.setItem(key, value),
  };

  try {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: failingClearStorage,
    });
    await assert.rejects(
      disableVoiceWakeStandby({
        enable: async () => { actions.push('enable'); return { enabled: true }; },
        disable: async () => { actions.push('disable'); return { enabled: false }; },
      }),
      /local_clear_failed/,
    );
    assert.deepEqual(actions, ['disable', 'enable']);
  } finally {
    Object.defineProperty(globalThis, 'localStorage', originalStorage);
    localStorage.clear();
  }
});

test('one failed preference subscriber cannot block another runtime owner', () => {
  localStorage.clear();
  let notifications = 0;
  const failing = subscribeAutoArmPreference(() => { throw new Error('listener failure'); });
  const receiving = subscribeAutoArmPreference(() => { notifications += 1; });

  setAutoArmSession('agent:main:main');
  assert.equal(notifications, 1);

  failing();
  receiving();
  localStorage.clear();
});
