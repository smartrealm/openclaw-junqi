import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { bytesToBase64, voiceSessionDirectory } from '@/api/tauri-adapter';

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

test('BUG-07 all direct chat send paths interrupt voice first', () => {
  const input = read('../../components/Chat/MessageInput.tsx');
  const chat = read('../../components/Chat/ChatView.tsx');
  const quick = read('../../pages/QuickChatPage.tsx');
  assert.match(input, /if \(st\.isTyping \|\| voiceActive\)/);
  assert.match(input, /Not queuing[\s\S]*voiceRuntime\.interruptGlobally\(activeSessionKey\)/);
  assert.match(chat, /voiceRuntime\.interruptGlobally\(activeSessionKey\)/);
  assert.match(quick, /voiceRuntime\.interruptGlobally\(sessionKey\)/);
});

test('BUG-08 chunked base64 encoding handles large audio buffers', () => {
  const bytes = Uint8Array.from({ length: 180_000 }, (_, index) => index % 251);
  const expected = Buffer.from(bytes).toString('base64');
  assert.equal(bytesToBase64(bytes), expected);
  const adapter = read('../../api/tauri-adapter.ts');
  assert.match(adapter, /mkdir\(voiceDir, \{ recursive: true \}\)/);
  assert.doesNotMatch(adapter, /invoke\("open_folder", \{ path: voiceDir \}\)/);
});

test('BUG-09 manual recorder exposes native fallback and deterministic stop', () => {
  const recorder = read('../../components/Chat/VoiceRecorder.tsx');
  const native = read('../../../src-tauri/src/commands/voice.rs');
  assert.match(recorder, /voice\?\.startRecording/);
  assert.match(recorder, /voice\?\.stopRecording/);
  assert.match(native, /recv_timeout\(Duration::from_secs\(3\)\)/);
  assert.match(native, /worker\n\s*\.join\(\)/);
  assert.doesNotMatch(native, /sleep\(std::time::Duration::from_millis\(200\)\)/);
});

test('BUG-12 VAD startup is handshaken and stale stop events are suppressed', () => {
  const native = read('../../../src-tauri/src/commands/voice_wake.rs');
  assert.match(native, /recv_timeout\(Duration::from_secs\(3\)\)/);
  assert.match(native, /should_emit_command_stop/);
  assert.match(native, /run_vad_loop\(app_for_thread, cmd_rx, worker_id, ready_tx\)/);
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

test('BUG-16 native VAD suppresses assistant playback feedback', () => {
  const wake = read('../../hooks/useVoiceWake.ts');
  const input = read('../../components/Chat/MessageInput.tsx');
  assert.match(wake, /isVoiceOutputActive/);
  assert.match(wake, /voice\.remoteOutput !== null/);
  assert.match(wake, /suppressNativeCaptureRef\.current = isVoiceOutputActive/);
  assert.match(wake, /if \(suppressNativeCaptureRef\.current\) \{[\s\S]*return;/);
  assert.match(wake, /voiceRuntime\.interruptAll\(\);\s+setError\(null\)/);
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
  const input = read('../../components/Chat/MessageInput.tsx');
  const adapter = read('../../api/tauri-adapter.ts');
  assert.match(input, /\[\{ type: 'base64', mimeType, content: base64, fileName: filename \}\]/);
  assert.doesNotMatch(input, /\[voice\] \$\{savedPath\}/);
  const hostilePath = voiceSessionDirectory('/app/data/', 'agent:main/../../main');
  const formerlyCollidingPath = voiceSessionDirectory('/app/data/', 'agent_main_______main');
  assert.match(hostilePath, /^\/app\/data\/voice\/v1\/[a-zA-Z0-9_\/-]+\/_$/);
  assert.equal(hostilePath.includes('..'), false);
  assert.notEqual(hostilePath, formerlyCollidingPath);
  const exactChunkPath = voiceSessionDirectory('/app/data/', 'a'.repeat(90));
  const extendedPath = voiceSessionDirectory('/app/data/', `${'a'.repeat(90)}b`);
  assert.equal(extendedPath.startsWith(`${exactChunkPath}/`), false);
  assert.match(adapter, /cleanupSession:[\s\S]*remove\(voiceDir, \{ recursive: true \}\)/);
});

test('BUG-23 remote output is visible to controls, status surfaces, and native feedback suppression', () => {
  const input = read('../../components/Chat/MessageInput.tsx');
  const quick = read('../../pages/QuickChatPage.tsx');
  const island = read('../../dynamic-island/DynamicIslandRuntime.tsx');
  const pet = read('../../pet/usePetStateEmitter.ts');
  assert.match(input, /remoteVoiceOutput !== null/);
  assert.match(input, /const voiceActive = voice\.remoteOutput !== null/);
  assert.match(input, /interruptGlobally\(activeSessionKey\)/);
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
