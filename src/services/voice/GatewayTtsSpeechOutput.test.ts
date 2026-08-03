import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayTtsSpeechOutput } from './GatewayTtsSpeechOutput';

test('rejects Gateway TTS audio without an explicit MIME type before local playback', async () => {
  const output = new GatewayTtsSpeechOutput({
    speak: async () => ({
      audioBase64: 'YXVkaW8=',
      provider: 'gateway-tts',
      outputFormat: null,
      mimeType: null,
      fileExtension: null,
    }),
  });

  await assert.rejects(
    output.speak('请播放', new AbortController().signal),
    /playable MIME type/,
  );
});

test('forwards local abort to Gateway TTS and does not create a playback fallback', async () => {
  let receivedSignal: AbortSignal | null = null;
  const output = new GatewayTtsSpeechOutput({
    speak: async ({ signal }) => {
      receivedSignal = signal;
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve({
          audioBase64: 'YXVkaW8=',
          provider: 'gateway-tts',
          outputFormat: null,
          mimeType: 'audio/mpeg',
          fileExtension: null,
        }), { once: true });
      });
    },
  });
  const controller = new AbortController();
  const playback = output.speak('停止前的内容', controller.signal);
  controller.abort();

  await playback;
  assert.equal(receivedSignal, controller.signal);
});
