import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./useComposerVoice.ts', import.meta.url), 'utf8');

test('native VAD capture becomes a confirmation draft before the ordinary attachment sender runs', () => {
  const fallbackStart = source.indexOf('onCaptureFallback: async (wavDataUrl) =>');
  const fallbackEnd = source.indexOf('onWakeDetected:', fallbackStart);
  assert.ok(fallbackStart >= 0);
  assert.ok(fallbackEnd > fallbackStart);

  const fallback = source.slice(fallbackStart, fallbackEnd);
  assert.match(fallback, /voiceModeCoordinator\.acceptAudioCapture/);
  assert.match(fallback, /pendingAudioCapturesRef\.current\.set/);
  assert.doesNotMatch(fallback, /sendVoice\(|chatSendCoordinator/);
  assert.match(source, /const draft = voiceModeCoordinator\.getDraft\(turnId, context\)/);
  assert.match(source, /await sendVoice\(base64, 'audio\/wav'/);
});

test('voice stop releases the registered capture owner even when the mode state was already cleared', () => {
  assert.match(source, /voiceModeCoordinator\.stopAndReleaseCapture\(\)/);
  assert.match(source, /voiceModeCoordinator\.subscribeCaptureStop\(\(\) => voiceWake\.stop\(\)\)/);
});

test('voice mode cleanup releases only its owned turn when the composer unmounts', () => {
  assert.match(source, /stopOwnedTurnAndReleaseCapture\(turnId, context\)/);
  assert.match(source, /useEffect\(\(\) => \(\) => \{/);
  assert.match(source, /pendingAudioCapturesRef\.current\.clear\(\)/);
});

test('dictation and confirmation fence the attested Gateway identity around async work', () => {
  const dictationStart = source.indexOf('const startDictation = useCallback(async () =>');
  const dictationEnd = source.indexOf('const requestWakeWord', dictationStart);
  const dictation = source.slice(dictationStart, dictationEnd);
  assert.match(source, /gateway\.isConnectionCurrent\(expected\.connectionId\)/);
  assert.match(dictation, /await voiceWake\.stop\(\);[\s\S]*isCurrentVoiceContext\(context\)/);
  assert.match(dictation, /await stopAssistant\(\);[\s\S]*isCurrentVoiceContext\(context\)/);
  assert.match(dictation, /await voiceWake\.start\(\);[\s\S]*stopOwnedTurnAndReleaseCapture\(snapshot\.turnId, context\)/);

  const confirmStart = source.indexOf('const confirmVoiceDraft = useCallback(async () =>');
  const confirmEnd = source.indexOf('const discardVoiceDraft', confirmStart);
  const confirm = source.slice(confirmStart, confirmEnd);
  assert.match(confirm, /isCurrentVoiceContext\(context\)/);
  assert.match(confirm, /invalidateOwnedTurn\(turnId, context, 'gateway_unavailable'\)/);
  assert.ok(confirm.indexOf('isCurrentVoiceContext(context)') < confirm.indexOf('getDraft(turnId, context)'));
});

test('voice-triggered interruption keeps a pending Gateway send in the native Stop path', () => {
  const stopStart = source.indexOf('const stopAssistant = useCallback(async () =>');
  const stopEnd = source.indexOf('const voiceWake = useVoiceWake', stopStart);
  const stopAssistant = source.slice(stopStart, stopEnd);
  assert.match(stopAssistant, /selectSessionRequestActive\(useChatStore\.getState\(\), activeSessionKey\)/);
  assert.match(stopAssistant, /gateway\.abortChat\(activeSessionKey, activeSessionId\)/);
});
