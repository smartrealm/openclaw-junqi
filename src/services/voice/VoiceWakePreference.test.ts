import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoArmSessionKey,
  clearAutoArmSession,
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
