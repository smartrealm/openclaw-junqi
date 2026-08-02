import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoArmSessionKey,
  clearAutoArmSession,
  setAutoArmSession,
  shouldAutoArmSession,
} from './VoiceWakePreference';

test('voice wake auto-arm preference is scoped to one session key', () => {
  clearAutoArmSession();
  setAutoArmSession('agent:primary:main');

  assert.equal(autoArmSessionKey(), 'agent:primary:main');
  assert.equal(shouldAutoArmSession('agent:primary:main'), true);
  assert.equal(shouldAutoArmSession('agent:other:main'), false);

  clearAutoArmSession();
  assert.equal(autoArmSessionKey(), null);
});
