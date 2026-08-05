import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OpenClawTtsClient,
  OpenClawTtsResponseError,
} from './OpenClawTtsClient';

test('sends only the official tts.speak text field and forwards local abort', async () => {
  const calls: Array<{ method: string; params: Record<string, unknown>; signal?: AbortSignal }> = [];
  const controller = new AbortController();
  const client = new OpenClawTtsClient(async (method, params, options) => {
    calls.push({ method, params, signal: options?.signal });
    return {
      audioBase64: 'YXVkaW8=',
      provider: 'gateway-tts',
      mimeType: 'audio/mpeg',
    };
  });

  const clip = await client.speak({ text: '  请播放这一句  ', signal: controller.signal });

  assert.deepEqual(calls, [{
    method: 'tts.speak',
    params: { text: '  请播放这一句  ' },
    signal: controller.signal,
  }]);
  assert.deepEqual(clip, {
    audioBase64: 'YXVkaW8=',
    provider: 'gateway-tts',
    outputFormat: null,
    mimeType: 'audio/mpeg',
    fileExtension: null,
  });
});

test('rejects blank text before making a Gateway request', async () => {
  const client = new OpenClawTtsClient(async () => {
    throw new Error('The request must not be sent');
  });

  await assert.rejects(client.speak({ text: '   ' }), /requires non-empty text/);
});

test('rejects malformed required and optional OpenClaw TTS fields without defaults', async () => {
  const invalidPayloads: unknown[] = [
    { provider: 'gateway-tts', mimeType: 'audio/mpeg' },
    { audioBase64: 'YXVkaW8=', provider: '' },
    { audioBase64: 'YXVkaW8=', provider: 'gateway-tts', mimeType: 42 },
    { audioBase64: 'YXVkaW8=', provider: 'gateway-tts', outputFormat: '' },
  ];

  for (const response of invalidPayloads) {
    const client = new OpenClawTtsClient(async () => response);
    await assert.rejects(client.speak({ text: '请播放' }), OpenClawTtsResponseError);
  }
});
