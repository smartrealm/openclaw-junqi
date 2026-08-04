import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoArmBinding,
  clearAutoArmSession,
  disableVoiceWakeStandby,
  enableVoiceWakeStandby,
  setAutoArmBinding,
  shouldAutoArmSession,
  subscribeAutoArmPreference,
  type VoiceWakeStandbyBinding,
} from './VoiceWakePreference';

const MAIN_BINDING: VoiceWakeStandbyBinding = {
  sessionKey: 'agent:main:main',
  targetFingerprint: 'target-main',
};

test('standby preference notifies the application runtime on enable and disable', () => {
  localStorage.clear();
  let notifications = 0;
  const unsubscribe = subscribeAutoArmPreference(() => { notifications += 1; });

  setAutoArmBinding(MAIN_BINDING);
  assert.deepEqual(autoArmBinding(), MAIN_BINDING);
  clearAutoArmSession();
  assert.equal(autoArmBinding(), null);
  assert.equal(notifications, 2);

  unsubscribe();
  localStorage.clear();
});

test('standby binding publishes only after system autostart and runtime identity confirm enablement', async () => {
  localStorage.clear();
  let resolveEnable!: (status: { enabled: boolean }) => void;
  let notifications = 0;
  const unsubscribe = subscribeAutoArmPreference(() => { notifications += 1; });
  const enabling = enableVoiceWakeStandby(MAIN_BINDING, {
    enable: () => new Promise((resolve) => { resolveEnable = resolve; }),
    disable: async () => ({ enabled: false }),
  }, () => true);

  await Promise.resolve();
  assert.equal(autoArmBinding(), null);
  assert.equal(notifications, 0);
  resolveEnable({ enabled: true });
  await enabling;
  assert.deepEqual(autoArmBinding(), MAIN_BINDING);
  assert.equal(notifications, 1);

  unsubscribe();
  localStorage.clear();
});

test('legacy binding without a runtime target fails closed', () => {
  localStorage.clear();
  localStorage.setItem('junqi:voice-wake:auto-arm:v1', JSON.stringify({ sessionKey: 'agent:main:main' }));

  assert.equal(autoArmBinding(), null);
  assert.equal(shouldAutoArmSession('agent:main:main', 'target-main'), false);
  localStorage.clear();
});

test('standby binding requires both the session key and verified runtime target', () => {
  localStorage.clear();
  setAutoArmBinding(MAIN_BINDING);

  assert.equal(shouldAutoArmSession('agent:main:main', 'target-main'), true);
  assert.equal(shouldAutoArmSession('agent:main:main', 'target-other'), false);
  assert.equal(shouldAutoArmSession('agent:main:other', 'target-main'), false);
  assert.equal(shouldAutoArmSession('agent:main:main', null), false);
  localStorage.clear();
});

test('unconfirmed autostart mutations retain the prior standby binding', async () => {
  localStorage.clear();
  const existing = { sessionKey: 'agent:main:existing', targetFingerprint: 'target-existing' };
  setAutoArmBinding(existing);

  await assert.rejects(
    enableVoiceWakeStandby({ sessionKey: 'agent:main:next', targetFingerprint: 'target-next' }, {
      enable: async () => ({ enabled: false }),
      disable: async () => ({ enabled: false }),
    }, () => true),
    /app_autostart_enable_not_confirmed/,
  );
  assert.deepEqual(autoArmBinding(), existing);

  await assert.rejects(
    disableVoiceWakeStandby({
      enable: async () => ({ enabled: true }),
      disable: async () => ({ enabled: true }),
    }),
    /app_autostart_disable_not_confirmed/,
  );
  assert.deepEqual(autoArmBinding(), existing);
  localStorage.clear();
});

test('runtime target changes while enabling roll system autostart back', async () => {
  localStorage.clear();
  const actions: string[] = [];
  let bindingCurrent = true;

  await assert.rejects(
    enableVoiceWakeStandby(MAIN_BINDING, {
      enable: async () => {
        actions.push('enable');
        bindingCurrent = false;
        return { enabled: true };
      },
      disable: async () => {
        actions.push('disable');
        return { enabled: false };
      },
    }, () => bindingCurrent),
    /voice_wake_standby_runtime_changed/,
  );
  assert.deepEqual(actions, ['enable', 'disable']);
  assert.equal(autoArmBinding(), null);
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
      enableVoiceWakeStandby(MAIN_BINDING, {
        enable: async () => { actions.push('enable'); return { enabled: true }; },
        disable: async () => { actions.push('disable'); return { enabled: false }; },
      }, () => true),
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

  setAutoArmBinding(MAIN_BINDING);
  assert.equal(notifications, 1);

  failing();
  receiving();
  localStorage.clear();
});
