import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTalkCatalog, selectRealtimeRelayProvider } from './talkTypes';

function officialCatalog() {
  return {
    modes: ['realtime', 'stt-tts', 'transcription'],
    transports: ['webrtc', 'provider-websocket', 'gateway-relay', 'managed-room'],
    brains: ['agent-consult', 'direct-tools', 'none'],
    speech: {
      providers: [{ id: 'speech-provider', label: 'Speech', configured: true, modes: ['stt-tts'], brains: ['agent-consult'] }],
    },
    transcription: {
      ready: false,
      providers: [],
    },
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
        inputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24000, channels: 1 }],
        outputAudioFormats: [{ encoding: 'pcm16', sampleRateHz: 24000, channels: 1 }],
        supportsBargeIn: true,
      }],
    },
  };
}

test('decodes the current OpenClaw Talk catalog groups and optional provider fields', () => {
  const decoded = decodeTalkCatalog(officialCatalog());
  assert.ok(decoded);
  assert.equal(decoded.realtime.ready, true);
  assert.equal(decoded.realtime.activeProvider, 'relay-provider');
  assert.equal(decoded.speech.providers[0]?.label, 'Speech');
  assert.deepEqual(selectRealtimeRelayProvider(decoded), decoded.realtime.providers[0]);
});

test('does not treat the legacy speech.ready catalog as a current Talk catalog', () => {
  assert.equal(decodeTalkCatalog({ speech: { ready: true, providers: [] } }), null);
});

test('does not claim native Talk when realtime readiness or native formats are unverified', () => {
  const catalog = officialCatalog();
  catalog.realtime.ready = false;
  const decoded = decodeTalkCatalog(catalog);
  assert.ok(decoded);
  assert.equal(selectRealtimeRelayProvider(decoded), null);

  const malformed = officialCatalog();
  malformed.realtime.providers[0].inputAudioFormats = [{ encoding: 'pcm16', sampleRateHz: 16000, channels: 1 }];
  const malformedDecoded = decodeTalkCatalog(malformed);
  assert.ok(malformedDecoded);
  assert.equal(selectRealtimeRelayProvider(malformedDecoded), null);
});
