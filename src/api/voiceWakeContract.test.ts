import assert from 'node:assert/strict';
import test from 'node:test';
import { isRequestedVoiceWakeListener } from './voiceWakeContract';

test('native voice wake startup is accepted only for the requested active mode', () => {
  assert.equal(isRequestedVoiceWakeListener({ listening: true, mode: 'wake_word' }, 'wake_word'), true);
  assert.equal(isRequestedVoiceWakeListener({ listening: true, mode: 'dictation' }, 'wake_word'), false);
  assert.equal(isRequestedVoiceWakeListener({ listening: false, mode: 'wake_word' }, 'wake_word'), false);
  assert.equal(isRequestedVoiceWakeListener({ listening: true, mode: null }, 'dictation'), false);
});
