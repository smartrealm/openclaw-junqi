import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTalkCatalog,
  decodeTalkAgentControlInput,
  decodeTalkEvent,
  decodeTalkSession,
  selectRealtimeRelayConfiguration,
} from './talkTypes';

function officialCatalog(inputSampleRateHz = 24_000, outputSampleRateHz = 24_000) {
  return {
    modes: ['realtime', 'stt-tts', 'transcription'],
    transports: ['webrtc', 'provider-websocket', 'gateway-relay', 'managed-room'],
    brains: ['agent-consult', 'direct-tools', 'none'],
    speech: {
      providers: [{ id: 'speech-provider', label: 'Speech', configured: true, modes: ['stt-tts'], brains: ['agent-consult'] }],
    },
    transcription: { ready: false, providers: [] },
    realtime: {
      ready: true,
      activeProvider: 'relay-provider',
      providers: [{
        id: 'relay-provider',
        label: 'Relay provider',
        configured: true,
        modes: ['realtime'],
        transports: ['gateway-relay'],
        brains: ['agent-consult'],
        inputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: inputSampleRateHz, channels: 1 }],
        outputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: outputSampleRateHz, channels: 2 }],
        supportsBargeIn: true,
        supportsToolCalls: true,
      }],
    },
  };
}

test('Talk 目录按 Gateway 声明选择可中断的原生 PCM 中继', () => {
  const decoded = decodeTalkCatalog(officialCatalog(16_000, 48_000));
  assert.ok(decoded);
  const selection = selectRealtimeRelayConfiguration(decoded);
  assert.ok(selection);
  assert.equal(selection.provider.id, 'relay-provider');
  assert.deepEqual(selection.inputAudioFormat, { encoding: 'pcm16', sampleRateHz: 16_000, channels: 1 });
  assert.deepEqual(selection.outputAudioFormat, { encoding: 'pcm16', sampleRateHz: 48_000, channels: 2 });
});

test('Talk 目录未就绪或没有兼容的原生格式时保持不可用', () => {
  const unready = officialCatalog();
  unready.realtime.ready = false;
  const decodedUnready = decodeTalkCatalog(unready);
  assert.ok(decodedUnready);
  assert.equal(selectRealtimeRelayConfiguration(decodedUnready), null);

  const unsupported = officialCatalog();
  unsupported.realtime.providers[0].inputAudioFormats = [{ encoding: 'pcm16', sampleRateHz: 24_000, channels: 2 }];
  const decodedUnsupported = decodeTalkCatalog(unsupported);
  assert.ok(decodedUnsupported);
  assert.equal(selectRealtimeRelayConfiguration(decodedUnsupported), null);

  const withoutTools = officialCatalog();
  withoutTools.realtime.providers[0].supportsToolCalls = false;
  const decodedWithoutTools = decodeTalkCatalog(withoutTools);
  assert.ok(decodedWithoutTools);
  assert.equal(selectRealtimeRelayConfiguration(decodedWithoutTools), null);
});

test('Talk 会话采用创建响应中的实际音频格式并与目录交叉核对', () => {
  const catalog = decodeTalkCatalog(officialCatalog(16_000, 48_000));
  assert.ok(catalog);
  const selection = selectRealtimeRelayConfiguration(catalog);
  assert.ok(selection);
  const session = decodeTalkSession({
    sessionId: 'talk-1',
    provider: 'relay-provider',
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    audio: {
      inputEncoding: 'pcm16',
      inputSampleRateHz: 16_000,
      outputEncoding: 'pcm16',
      outputSampleRateHz: 48_000,
    },
  }, selection);
  assert.deepEqual(session, {
    sessionId: 'talk-1',
    provider: 'relay-provider',
    inputAudioFormat: { encoding: 'pcm16', sampleRateHz: 16_000, channels: 1 },
    outputAudioFormat: { encoding: 'pcm16', sampleRateHz: 48_000, channels: 2 },
  });
  assert.equal(decodeTalkSession({
    sessionId: 'talk-1',
    provider: 'relay-provider',
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    audio: {
      inputEncoding: 'pcm16',
      inputSampleRateHz: 24_000,
      outputEncoding: 'pcm16',
      outputSampleRateHz: 48_000,
    },
  }, selection), null);
});

test('Talk 事件只接受带完整关联标识的官方事件信封', () => {
  const base = {
    id: 'talk-event-1',
    type: 'output.audio.delta',
    sessionId: 'talk-session-1',
    turnId: 'talk-turn-1',
    seq: 1,
    timestamp: '2026-08-04T00:00:00.000Z',
    mode: 'realtime',
    transport: 'gateway-relay',
    brain: 'agent-consult',
    payload: {},
  };
  assert.ok(decodeTalkEvent({ ...base, callId: 'call-1', final: false }));
  assert.equal(decodeTalkEvent({ ...base, callId: 'call-1', final: false })?.callId, 'call-1');
  assert.equal(decodeTalkEvent({ ...base, callId: 'call-1', final: false })?.final, false);
  assert.equal(decodeTalkEvent({ ...base, seq: 0 }), null);
  assert.equal(decodeTalkEvent({ ...base, timestamp: '' }), null);
  assert.equal(decodeTalkEvent({ ...base, turnId: undefined }), null);
  assert.equal(decodeTalkEvent({
    ...base,
    type: 'capture.started',
    turnId: undefined,
    captureId: undefined,
  }), null);
  assert.ok(decodeTalkEvent({
    ...base,
    type: 'capture.started',
    turnId: undefined,
    captureId: 'capture-1',
  }));
});

test('Talk 控制参数只投影官方文本和控制模式', () => {
  assert.deepEqual(decodeTalkAgentControlInput({ text: '继续检查', mode: 'steer' }), {
    text: '继续检查',
    mode: 'steer',
  });
  assert.deepEqual(decodeTalkAgentControlInput('{"message":"报告状态","mode":"status"}'), {
    text: '报告状态',
    mode: 'status',
  });
  assert.deepEqual(decodeTalkAgentControlInput('直接停止'), { text: '直接停止' });
  assert.equal(decodeTalkAgentControlInput({ mode: 'cancel' }), null);
});
