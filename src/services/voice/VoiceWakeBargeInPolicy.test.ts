import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAcceptVoiceWakeDuringOutput } from './VoiceWakeBargeInPolicy';

test('a recognized local wake phrase remains a barge-in signal during assistant output', () => {
  assert.equal(shouldAcceptVoiceWakeDuringOutput('Jarvis', true), true);
});

test('未验证的原生 VAD 输入在助手播放期间保持抑制', () => {
  assert.equal(shouldAcceptVoiceWakeDuringOutput(null, true), false);
  assert.equal(shouldAcceptVoiceWakeDuringOutput('   ', true), false);
  assert.equal(shouldAcceptVoiceWakeDuringOutput(null, false), true);
});
