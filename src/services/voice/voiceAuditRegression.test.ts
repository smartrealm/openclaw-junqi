import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bytesToBase64, voiceSessionDirectory } from '@/services/chat/voiceStoragePath';
import { shouldAcceptVoiceWakeDuringOutput } from './VoiceWakeBargeInPolicy';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('BUG-02 recognition callbacks enforce recognizer ownership and FIFO capture delivery', () => {
  const source = read('../../hooks/useVoiceWake.ts');
  assert.match(source, /recognitionRef\.current !== rec/);
  assert.match(source, /callbacksRef\.current/);
  assert.match(source, /captureQueueRef\.current\.push/);
  assert.match(source, /await capture\.onCaptureFallback/);
});

test('BUG-03 Quick Chat gates Gateway voice events to its owned session', () => {
  const root = read('../../pages/QuickChatRoot.tsx');
  const page = read('../../pages/QuickChatPage.tsx');
  assert.match(root, /isOwnedQuickChatSession/);
  assert.match(root, /sessionKey\.startsWith\('quickchat:'\)/);
  assert.match(root, /if \(!explicitKey\) return/);
  assert.match(root, /<QuickChatPage sessionKey=\{sessionKey\}/);
  assert.doesNotMatch(page, /setActiveSession\(/);
});

test('BUG-06 AudioPlayer claims runtime media instead of global auto-play', () => {
  const player = read('../../components/Chat/AudioPlayer.tsx');
  assert.match(player, /claimExternalPlayback/);
  assert.match(player, /trackVoiceOutput/);
  assert.match(player, /if \(owner && owner !== sessionKey\) return/);
  assert.doesNotMatch(player, /useSettingsStore\.getState\(\)\.audioAutoPlay/);
});

test('AudioPlayer does not retain an unreachable replay implementation', () => {
  const player = read('../../components/Chat/AudioPlayer.tsx');
  assert.doesNotMatch(player, /const replay =/);
  assert.doesNotMatch(player, /RotateCcw/);
});

test('BUG-07 all direct chat send paths interrupt voice first', () => {
  const input = read('../../components/Chat/MessageInput.tsx');
  const composerVoice = read('../../components/Chat/message-input/useComposerVoice.ts');
  const runtime = read('../../runtime/JarvisVoiceRuntime.tsx');
  const chat = read('../../components/Chat/ChatView.tsx');
  const quick = read('../../pages/QuickChatPage.tsx');
  assert.match(input, /useComposerInterruption\(\{/);
  assert.match(input, /useJarvisVoiceRuntime\(\)/);
  assert.match(runtime, /<VoiceWakeOverlay/);
  assert.match(runtime, /useComposerVoice\(\{/);
  const voiceSend = composerVoice.slice(
    composerVoice.indexOf('const sendVoice'),
    composerVoice.indexOf('const stopAssistant'),
  );
  assert.ok(
    voiceSend.indexOf('voiceRuntime.interruptGlobally(sessionKey)')
      < voiceSend.indexOf('await chatSendCoordinator.send'),
  );
  assert.match(chat, /voiceRuntime\.interruptGlobally\(activeSessionKey\)/);
  assert.match(quick, /voiceRuntime\.interruptGlobally\(sessionKey\)/);
});

test('BUG-08 chunked base64 encoding handles large audio buffers', () => {
  const bytes = Uint8Array.from({ length: 180_000 }, (_, index) => index % 251);
  const expected = Buffer.from(bytes).toString('base64');
  assert.equal(bytesToBase64(bytes), expected);
  const files = read('../../services/chat/voiceFileRuntime.ts');
  assert.match(files, /await mkdir\(directory, \{ recursive: true \}\)/);
  assert.doesNotMatch(files, /open_folder/);
});

test('BUG-09 manual recorder exposes native fallback and deterministic stop', () => {
  const recorder = read('../../components/Chat/VoiceRecorder.tsx');
  const native = read('../../../src-tauri/src/commands/voice.rs');
  assert.match(recorder, /voiceFileRuntime\.startRecording\(\)/);
  assert.match(recorder, /voiceFileRuntime\.stopRecording\(\)/);
  assert.match(native, /recv_timeout\(Duration::from_secs\(3\)\)/);
  assert.match(native, /worker\n\s*\.join\(\)/);
  assert.doesNotMatch(native, /sleep\(std::time::Duration::from_millis\(200\)\)/);
});

test('BUG-12 VAD startup is handshaken and stale stop events are suppressed', () => {
  const native = read('../../../src-tauri/src/commands/voice_wake.rs');
  assert.match(native, /recv_timeout\(Duration::from_secs\(3\)\)/);
  assert.match(native, /should_emit_command_stop/);
  assert.match(native, /run_capture_loop\([\s\S]*app_for_thread,[\s\S]*cmd_rx,[\s\S]*worker_id,[\s\S]*mode,[\s\S]*stream_pcm,[\s\S]*ready_tx/);
});

test('BUG-13 recorder invalidates stale starts and finalizes browser chunks before cleanup', () => {
  const recorder = read('../../components/Chat/VoiceRecorder.tsx');
  assert.match(recorder, /startAttemptRef/);
  assert.match(recorder, /startingRef/);
  assert.match(recorder, /nativeStopPromiseRef/);
  assert.match(recorder, /recorder\.onstop = finish/);
});

test('BUG-14 native captures retain their originating session', () => {
  const wake = read('../../hooks/useVoiceWake.ts');
  assert.match(wake, /interface QueuedCapture/);
  assert.match(wake, /capture\.sessionKey !== callbacksRef\.current\.sessionKey/);
  assert.match(wake, /onCaptureFallback: callbacksRef\.current\.onCaptureFallback/);
});

test('BUG-15 native recorder holds one slot across replacement and installation', () => {
  const native = read('../../../src-tauri/src/commands/voice.rs');
  assert.match(native, /let mut recorder_slot = RECORDER\.lock\(\)/);
  assert.match(native, /stop_and_discard_recording\(previous\)/);
  assert.match(native, /\*recorder_slot = Some\(rec\)/);
});

test('BUG-16 preserves KWS barge-in while suppressing unverified feedback', () => {
  assert.equal(shouldAcceptVoiceWakeDuringOutput('Jarvis', true), true);
  assert.equal(shouldAcceptVoiceWakeDuringOutput(null, true), false);
});

test('BUG-17 Gateway message ids own voice stream segments', () => {
  const app = read('../../App.tsx');
  const quick = read('../../pages/QuickChatRoot.tsx');
  assert.match(app, /consumeStream\(sessionKey, content, messageId/);
  assert.match(app, /finishStream\(sessionKey, content,[\s\S]*messageId/);
  assert.match(quick, /consumeStream\(eventSessionKey, content, messageId/);
});

test('BUG-20 Quick Chat ownership never writes main tab state', () => {
  const root = read('../../pages/QuickChatRoot.tsx');
  const page = read('../../pages/QuickChatPage.tsx');
  assert.match(root, /isOwnedQuickChatSession\(eventSessionKey, sessionKey\)/);
  assert.doesNotMatch(`${root}\n${page}`, /setActiveSession\(/);
  assert.doesNotMatch(`${root}\n${page}`, /aegis-open-tabs/);
});

test('BUG-21 voice sends portable attachments and cleanup scopes the directory', () => {
  const composerVoice = read('../../components/Chat/message-input/useComposerVoice.ts');
  const files = read('../../services/chat/voiceFileRuntime.ts');
  assert.match(composerVoice, /toGatewayAttachments\(\[createPreparedAttachment\(\{[\s\S]*fileName,[\s\S]*mimeType,[\s\S]*base64,/);
  assert.doesNotMatch(composerVoice, /\[voice\] \$\{savedPath\}/);
  const hostilePath = voiceSessionDirectory('/app/data/', 'agent:main/../../main');
  const formerlyCollidingPath = voiceSessionDirectory('/app/data/', 'agent_main_______main');
  assert.match(hostilePath, /^\/app\/data\/voice\/v1\/[a-zA-Z0-9_\/-]+\/_$/);
  assert.equal(hostilePath.includes('..'), false);
  assert.notEqual(hostilePath, formerlyCollidingPath);
  const exactChunkPath = voiceSessionDirectory('/app/data/', 'a'.repeat(90));
  const extendedPath = voiceSessionDirectory('/app/data/', `${'a'.repeat(90)}b`);
  assert.equal(extendedPath.startsWith(`${exactChunkPath}/`), false);
  assert.match(files, /async cleanupSession[\s\S]*remove\(directory, \{ recursive: true \}\)/);
});

test('BUG-23 remote output is visible to controls, status surfaces, and native feedback suppression', () => {
  const input = read('../../components/Chat/MessageInput.tsx');
  const composerVoice = read('../../components/Chat/message-input/useComposerVoice.ts');
  const interruption = read('../../components/Chat/message-input/useComposerInterruption.ts');
  const quick = read('../../pages/QuickChatPage.tsx');
  const island = read('../../dynamic-island/DynamicIslandRuntime.tsx');
  const pet = read('../../pet/usePetStateEmitter.ts');
  assert.match(composerVoice, /const remoteOutput = useVoiceStore/);
  assert.match(composerVoice, /const outputActive = remoteOutput !== null/);
  assert.match(input, /voiceOutputActive=\{voice\.outputActive\}/);
  assert.match(interruption, /interruptGlobally\(activeSessionKey\)/);
  assert.match(quick, /state\.remoteOutput !== null/);
  assert.match(island, /remoteVoiceOutput \? 'speaking' : localVoicePhase/);
  assert.match(pet, /voice\.remoteOutput !== null/);
});

test('BUG-22 attention and tool states retain priority over passive playback', () => {
  const island = read('../../dynamic-island/DynamicIsland.tsx');
  const pet = read('../../pet/pet-states.ts');
  assert.ok(island.indexOf('if (snapshot.notice)') < island.indexOf("snapshot.voicePhase === 'speaking'"));
  assert.ok(island.indexOf('if (attentionCount === 1)') < island.indexOf("snapshot.voicePhase === 'speaking'"));
  assert.ok(pet.indexOf('if (i.tool)') < pet.indexOf('if (i.voiceSpeaking)'));
  assert.ok(pet.indexOf('if (i.voiceListening)') < pet.indexOf('if (i.tool)'));
});
