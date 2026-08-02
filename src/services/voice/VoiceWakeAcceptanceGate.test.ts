import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceWakeAcceptanceGate } from './VoiceWakeAcceptanceGate';
import { MAX_VOICE_WAKE_PCM_FRAMES } from './VoiceWakeAudioLimits';

test('wake acceptance buffers current-turn audio and releases it in arrival order', () => {
  const gate = new VoiceWakeAcceptanceGate();
  gate.begin();
  assert.equal(gate.retainPcm({ data: 'first', sampleRateHz: 24_000, channels: 1 }), true);
  assert.equal(gate.retainPcm({ data: 'second', sampleRateHz: 24_000, channels: 1 }), true);
  assert.equal(gate.retainCapture({ wavDataUrl: 'data:audio/wav;base64,AA==', sessionKey: 'agent:main:main' }), true);

  assert.deepEqual(gate.accept(), {
    pcmFrames: [
      { data: 'first', sampleRateHz: 24_000, channels: 1 },
      { data: 'second', sampleRateHz: 24_000, channels: 1 },
    ],
    capture: { wavDataUrl: 'data:audio/wav;base64,AA==', sessionKey: 'agent:main:main' },
  });
  assert.equal(gate.retainPcm({ data: 'late', sampleRateHz: 24_000, channels: 1 }), false);
});

test('a rejected category update discards retained PCM and fallback audio', () => {
  const gate = new VoiceWakeAcceptanceGate();
  gate.begin();
  gate.retainPcm({ data: 'private', sampleRateHz: 24_000, channels: 1 });
  gate.retainCapture({ wavDataUrl: 'data:audio/wav;base64,AA==', sessionKey: 'agent:main:main' });

  gate.reject();
  assert.deepEqual(gate.accept(), { pcmFrames: [], capture: null });
});

test('wake acceptance retains a complete bounded native utterance while Gateway confirms', () => {
  const gate = new VoiceWakeAcceptanceGate();
  gate.begin();
  for (let index = 0; index < MAX_VOICE_WAKE_PCM_FRAMES + 1; index += 1) {
    gate.retainPcm({ data: String(index), sampleRateHz: 24_000, channels: 1 });
  }

  const { pcmFrames } = gate.accept();
  assert.equal(pcmFrames.length, MAX_VOICE_WAKE_PCM_FRAMES);
  assert.equal(pcmFrames[0]?.data, '0');
  assert.equal(pcmFrames.at(-1)?.data, String(MAX_VOICE_WAKE_PCM_FRAMES - 1));
});
