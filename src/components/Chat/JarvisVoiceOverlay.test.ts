import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVoiceInputLevel } from './JarvisVoiceOverlay';

test('Jarvis 音量表只映射原生 RMS 并限制在可显示范围', () => {
  assert.equal(normalizeVoiceInputLevel(Number.NaN), 0);
  assert.equal(normalizeVoiceInputLevel(0), 0);
  assert.equal(normalizeVoiceInputLevel(0.001), 0);
  assert.ok(normalizeVoiceInputLevel(0.02) > 0);
  assert.equal(normalizeVoiceInputLevel(1), 1);
  assert.equal(normalizeVoiceInputLevel(2), 1);
});
