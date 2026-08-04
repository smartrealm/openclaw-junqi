import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNativeVoiceWakeStartRequest,
  isRequestedVoiceWakeListener,
} from './voiceWakeContract';

test('native voice wake requests preserve the requested mode and listener owner', () => {
  assert.deepEqual(
    createNativeVoiceWakeStartRequest('dictation', { ownerId: ' listener-1 ' }),
    { mode: 'dictation', streamPcm: false, ownerId: 'listener-1' },
  );
  assert.deepEqual(
    createNativeVoiceWakeStartRequest('wake_word', { streamPcm: true, ownerId: 'listener-2' }),
    { mode: 'wake_word', streamPcm: true, ownerId: 'listener-2' },
  );
  assert.throws(
    () => createNativeVoiceWakeStartRequest('dictation', { ownerId: '  ' }),
    /owner is required/,
  );
});

test('native voice wake startup is accepted only for the requested active mode', () => {
  assert.equal(isRequestedVoiceWakeListener({ listening: true, mode: 'wake_word' }, 'wake_word'), true);
  assert.equal(isRequestedVoiceWakeListener({ listening: true, mode: 'dictation' }, 'wake_word'), false);
  assert.equal(isRequestedVoiceWakeListener({ listening: false, mode: 'wake_word' }, 'wake_word'), false);
  assert.equal(isRequestedVoiceWakeListener({ listening: true, mode: null }, 'dictation'), false);
});
