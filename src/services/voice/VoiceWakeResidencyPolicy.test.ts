import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldKeepVoiceWakeResident } from './VoiceWakeResidencyPolicy';

test('only a verified native wake-word listener keeps the desktop process resident', () => {
  assert.equal(shouldKeepVoiceWakeResident({ listening: true, mode: 'wake_word' }), true);
  assert.equal(shouldKeepVoiceWakeResident({ listening: true, mode: 'dictation' }), false);
  assert.equal(shouldKeepVoiceWakeResident({ listening: false, mode: 'wake_word' }), false);
  assert.equal(shouldKeepVoiceWakeResident(null), false);
});
