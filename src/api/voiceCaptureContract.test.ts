import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeVoiceCaptureCommandResult,
  decodeVoiceCaptureEvent,
  VOICE_CAPTURE_OWNER_ID_MAX_LENGTH,
} from './voiceCaptureContract';

test('原生语音采集命令只接受带所有者围栏的完整响应', () => {
  assert.deepEqual(decodeVoiceCaptureCommandResult({
    ownerId: 'capture-owner',
    listening: true,
    reused: true,
  }), {
    ownerId: 'capture-owner',
    listening: true,
    stopped: null,
    reused: true,
  });
  assert.equal(decodeVoiceCaptureCommandResult({ listening: true }), null);
  assert.equal(decodeVoiceCaptureCommandResult({
    ownerId: 'x'.repeat(VOICE_CAPTURE_OWNER_ID_MAX_LENGTH + 1),
    listening: true,
  }), null);
});

test('原生语音采集事件严格区分语音活动与 PCM 数据', () => {
  assert.deepEqual(decodeVoiceCaptureEvent({
    ownerId: 'capture-owner',
    state: 'speech_started',
  }), {
    ownerId: 'capture-owner',
    state: 'speech_started',
  });
  assert.deepEqual(decodeVoiceCaptureEvent({
    ownerId: 'capture-owner',
    state: 'pcm',
    data: 'AA==',
    encoding: 'pcm16',
    sampleRateHz: 24_000,
    channels: 1,
    inputLevel: 0.125,
  }), {
    ownerId: 'capture-owner',
    state: 'pcm',
    data: 'AA==',
    encoding: 'pcm16',
    sampleRateHz: 24_000,
    channels: 1,
    inputLevel: 0.125,
  });
  assert.equal(decodeVoiceCaptureEvent({
    ownerId: 'capture-owner',
    state: 'pcm',
    data: 'AA==',
    encoding: 'pcm16',
    sampleRateHz: 0,
    channels: 1,
    inputLevel: 0,
  }), null);
  assert.equal(decodeVoiceCaptureEvent({
    ownerId: 'capture-owner',
    state: 'pcm',
    data: 'AA==',
    encoding: 'pcm16',
    sampleRateHz: 24_000,
    channels: 1,
    inputLevel: 1.01,
  }), null);
  assert.equal(decodeVoiceCaptureEvent({
    ownerId: 'capture-owner',
    state: 'captured',
    data: 'data:audio/wav;base64,AA==',
  }), null);
});
