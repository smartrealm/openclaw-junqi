import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAcceptVoiceWakeDuringOutput } from './VoiceWakeBargeInPolicy';

test('a recognized local wake phrase remains a barge-in signal during assistant output', () => {
  assert.equal(shouldAcceptVoiceWakeDuringOutput('Jarvis', true), true);
});

test('unverified VAD or browser input remains suppressed during assistant output', () => {
  assert.equal(shouldAcceptVoiceWakeDuringOutput(null, true), false);
  assert.equal(shouldAcceptVoiceWakeDuringOutput('   ', true), false);
  assert.equal(shouldAcceptVoiceWakeDuringOutput(null, false), true);
});
