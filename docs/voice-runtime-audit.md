# Voice Runtime End-to-End Audit

Date: 2026-07-21

Status: complete; BUG-01 through BUG-24 fixed and validated

Scope: Gateway stream callbacks, sentence extraction, browser recognition, native VAD, manual recording, external audio playback, session routing, and barge-in controls.

## Critical findings

### BUG-01 - CRITICAL - A stopped VAD worker can mark a replacement worker stopped

**Location**: `src-tauri/src/commands/voice_wake.rs:318`

```rust
if let Some(ref mut st) = *guard {
    st.running = false;
}
```

**Problem**: `voice_wake_stop` removes the global state before the worker has necessarily exited. If listening is restarted immediately, the old worker's unconditional cleanup mutates the new worker's state.

**Impact**:

- `voice_wake_status` can report `false` while the replacement capture thread is live.
- A later start can create a second microphone stream.

**Fix proposal**: assign every worker a monotonically increasing ID, join stale workers before replacement, and only let a worker finalize the matching global state.

### BUG-02 - CRITICAL - Stale recognition callbacks can submit text after stop or to an old session

**Location**: `src/hooks/useVoiceWake.ts:88`

```ts
rec.onresult = (event) => {
  onWakeDetected?.();
  onTranscript(transcript);
};
rec.onend = () => {
  recognitionRef.current = null;
  restartTimerRef.current = setTimeout(() => startBrowserRecognition(), 180);
};
```

**Problem**: result/error/end callbacks do not verify that `rec` is still the owned recognizer. They also capture the session callbacks from recognizer creation time. Native capture callbacks are allowed to overlap asynchronous sends.

**Impact**:

- A final result can be inserted after the user turned voice input off.
- Switching sessions while listening can route a transcript to the previous session.
- Two captured WAVs can race `isSending` and Gateway message state.

**Fix proposal**: add recognizer identity guards, keep current callbacks/session in refs, ignore stale native events, and serialize captured-WAV delivery.

### BUG-03 - CRITICAL - Quick Chat speaks events from sessions it does not own

**Location**: `src/pages/QuickChatRoot.tsx:21`

```ts
if (message.role === 'assistant') {
  voiceRuntime.speakMessage(sessionKey, message.content, message.mediaUrl);
}
```

**Problem**: Quick Chat listens to Gateway callbacks without comparing the event session to its own session. The root and page do not share an explicit generated quick-chat owner key.

**Impact**:

- Replies generated in the main window can be spoken by the Quick Chat window.
- Voice state and stop controls can refer to an unrelated conversation.

**Fix proposal**: generate the quick-chat owner key in the root, pass it to the page, and gate callbacks on that exact key without mutating the main chat tab state.

### BUG-04 - CRITICAL - Interrupting one session invalidates queued speech for every session

**Location**: `src/services/voice/VoiceRuntime.ts:208`

```ts
this.generation += 1;
this.stopSyntheticPlayback();
this.current = null;
```

**Problem**: speech items from every session share one generation. A session-scoped interrupt increments it but leaves other sessions' queued items tagged with the old value; `pump` silently discards them.

**Impact**:

- Valid queued replies disappear after an unrelated session is interrupted.
- The store can retain a nonzero queue with no playback progress.

**Fix proposal**: when canceling the current synthesizer, rebase surviving queue items to the new generation and immediately resume the queue.

## Medium findings

### BUG-05 - MEDIUM - Streaming text can split decimals and speak unfinished control blocks

**Location**: `src/services/voice/sentenceSplitter.ts:45`, `src/services/voice/VoiceRuntime.ts:117`

```ts
if (next === undefined || /\s/.test(next)) return index + 1;
const delta = deriveDelta(next.rawText, content);
next.splitter.feed(delta).map(sanitizeSpeechText);
```

**Problem**: a period at the end of a partial chunk is treated as a sentence boundary, so `v1.` can be spoken before `2` arrives. Sanitization occurs after raw text has already been split, allowing punctuation inside an unfinished code/artifact/directive block to be emitted.

**Impact**:

- Version numbers and decimals are spoken as separate sentences.
- Code or hidden control markup can leak into TTS.

**Fix proposal**: defer terminal ASCII periods until more text/final flush, and derive streaming deltas from cumulative sanitized speech text that suppresses unmatched control blocks.

### BUG-06 - MEDIUM - External TTS media bypasses coordination and historical audio auto-plays

**Location**: `src/services/voice/VoiceRuntime.ts:178`, `src/components/Chat/AudioPlayer.tsx:153`

```ts
// The existing AudioPlayer owns MEDIA: playback.
if (useSettingsStore.getState().audioAutoPlay && !playing) {
  audio.play();
}
```

**Problem**: every rendered audio element auto-plays when the setting is enabled, including history and user recordings. External playback never enters `VoiceStore`, so pet/island/stop controls cannot observe it and multiple players can overlap.

**Impact**:

- Opening history can unexpectedly start old recordings.
- External TTS is absent from voice status and global stop behavior.

**Fix proposal**: let `VoiceRuntime` issue one pending media request, let only the matching assistant player claim it, and report play/pause/end back to the runtime.

### BUG-07 - MEDIUM - Text send and Escape do not consistently barge into voice output

**Location**: `src/components/Chat/MessageInput.tsx:479`, `src/components/Chat/MessageInput.tsx:640`, `src/pages/QuickChatPage.tsx:117`

**Problem**: Escape only aborts while the AI is marked typing, and ordinary text sends do not stop a reply that is still being spoken after streaming has ended. Quick Chat has the same gap.

**Impact**:

- The previous answer speaks over the next user request.
- Escape can recall/delete the last exchange instead of stopping active audio.

**Fix proposal**: make voice output part of the Escape priority branch and interrupt the owned session immediately before every non-queued send.

### BUG-08 - MEDIUM - Voice persistence opens Finder and large audio reads overflow argument limits

**Location**: `src/api/tauri-adapter.ts:813`

```ts
await invoke('open_folder', { path: voiceDir });
const b64 = btoa(String.fromCharCode(...bytes));
```

**Problem**: `open_folder` is being used as a directory creator and visibly opens Explorer/Finder for every saved recording. Spreading a large `Uint8Array` into `fromCharCode` exceeds JavaScript's argument limit.

**Impact**:

- Recording sends cause an unrelated OS window to appear.
- Normal-sized TTS files can fail to load and display a false media error.

**Fix proposal**: create the directory with recursive filesystem `mkdir` and use a chunked byte-to-base64 helper shared by file and voice reads.

### BUG-09 - MEDIUM - Manual recording has no native fallback and native stop races WAV finalization

**Location**: `src/components/Chat/VoiceRecorder.tsx:196`, `src-tauri/src/commands/voice.rs:123`

```ts
const stream = await navigator.mediaDevices.getUserMedia(...);
```

```rust
let _ = rec.stop_tx.send(());
std::thread::sleep(Duration::from_millis(200));
```

**Problem**: the UI only uses browser `MediaRecorder` although a native recorder exists for WebViews where browser capture fails. The native command guesses that 200 ms is enough for the worker to finalize instead of joining it.

**Impact**:

- Manual voice input is unavailable on affected desktop WebViews.
- A slow recording worker can return a missing or incomplete WAV.

**Fix proposal**: type and use the native adapter as a fallback, add a recorder startup handshake, and join the worker before reading its file.

### BUG-10 - MEDIUM - Native VAD clips utterance starts and rejects unsigned input devices

**Location**: `src-tauri/src/commands/voice_wake.rs:107`, `src-tauri/src/commands/voice_wake.rs:253`

**Problem**: samples are retained only after the 250 ms speech trigger, so the first syllable is discarded. Only `I16` and `F32` capture formats are accepted even though CPAL can select `U16`.

**Impact**:

- Short words and initial consonants are clipped before they reach OpenClaw.
- Voice input fails outright on devices whose default format is unsigned PCM.

**Fix proposal**: keep a bounded pre-roll ring buffer and normalize `U16` samples into signed PCM for RMS and WAV capture.

### BUG-11 - MEDIUM - Starting one external player clears another session's pending media

**Location**: `src/services/voice/VoiceRuntime.ts`, `src/components/Chat/AudioPlayer.tsx`

**Problem**: external TTS requests are session-scoped, but starting one claimed player used the global external-stop path with its default `clearPending=true`. A player in session A could therefore delete an unrendered pending request for session B. The interrupt listener also treated a session-specific event as global when an audio element had no owner (for example, a history/user recording).

**Impact**:

- A background or Quick Chat response can lose its only auto-play opportunity.
- Stopping one session can pause unrelated historical audio.

**Fix**: preserve pending requests for other sessions while replacing the active physical player, and require an owner match for session-specific interrupt events.

### BUG-12 - CRITICAL - VAD startup and command-stop events can describe the wrong worker

**Location**: `src-tauri/src/commands/voice_wake.rs:203`

**Problem**: a worker can fail before the parent stores its `WakeState`, leaving a dead worker marked as running and dropping the startup error. Separately, `voice_wake_stop` emits an unscoped `stopped` event after releasing the global state; a replacement worker can start before that event arrives and be stopped in the renderer by the stale event.

**Impact**:

- The UI can show listening forever after a missing microphone or stream setup failure.
- A rapid stop/start sequence can disable the replacement listener.

**Fix**: add a startup handshake before reporting success and emit the command-level stopped event only while no replacement state exists, under the same lock used for replacement.

### BUG-13 - MEDIUM - Manual recorder start can outlive its component

**Location**: `src/components/Chat/VoiceRecorder.tsx:221`

**Problem**: `getUserMedia`, `AudioContext`, and the native start command are asynchronous. Strict-mode remounts, a disabled transition, or closing the recorder during any await can let an old start finish after cleanup and create a second browser/native capture.

**Impact**:

- Two microphone streams can be active at once.
- An unmounted recorder can keep the native recorder running.

**Fix**: serialize start attempts, invalidate an attempt on cleanup, stop late-created streams/native recordings, and finalize browser chunks before releasing capture resources.

### BUG-14 - MEDIUM - Native wake captures can be delivered to a newly selected session

**Location**: `src/hooks/useVoiceWake.ts:75`

**Problem**: the native event queue stores only a WAV string and drains it through the latest callback ref. If the user switches sessions while a capture is queued, the old utterance can be sent using the new session's callback closure.

**Impact**:

- Audio recorded for one conversation can be attached to another conversation.

**Fix**: tag each queued capture with its owning session and callback snapshot, and drop it when the active session has changed before delivery.

### BUG-15 - HIGH - Concurrent native recorder starts can overwrite the global worker slot

**Location**: `src-tauri/src/commands/voice.rs:21`

**Problem**: `voice_start_recording` stopped the previous recorder before opening a new worker, but released the global mutex before installing the new `ActiveRecording`. Two callers could both observe an empty slot, start separate workers, and then overwrite each other's handle when they finally stored their result.

**Impact**:

- One microphone worker can remain alive with no stop handle.
- A later stop command may stop only the most recently stored worker while the leaked stream continues.

**Fix**: serialize replacement and installation under the recorder mutex, joining any racing previous worker before writing the new slot.

### BUG-16 - HIGH - Native VAD can capture JunQi's own spoken reply

**Location**: `src/hooks/useVoiceWake.ts:249`

**Problem**: the native CPAL fallback has no acoustic echo cancellation or wake-word model. When automatic speech output is active, energy VAD can classify speaker playback as a new user utterance, invoke barge-in, and send the captured reply audio back to Gateway.

**Impact**:

- JunQi can interrupt itself and create a voice-message feedback loop.

**Fix**: for the raw native VAD backend only, mark and suppress the entire detected/captured utterance while the same session owns queued or speaking output. Browser system recognition remains available for platform-managed barge-in.

### BUG-17 - MEDIUM - Tool-segment transitions can concatenate or drop an unfinished spoken tail

**Location**: `src/App.tsx:626`, `src/services/voice/VoiceRuntime.ts:125`

**Problem**: Gateway keeps one run ID across assistant text segments separated by tool calls, while each segment has its own message ID. VoiceRuntime used only the run ID and therefore treated a reset segment as a cumulative continuation. If the prior segment lacked sentence punctuation, its splitter buffer could be joined directly to the next segment or overwritten.

**Impact**:

- Tool-using replies can be spoken as malformed joined text or omit a short pre-tool sentence.

**Fix**: route the stable per-segment message ID into VoiceRuntime and flush the previous segment's sanitized tail before installing a different stream identity.

## Compatibility follow-up findings

### BUG-18 - CRITICAL - Voice ownership and stop controls are isolated per WebView

**Location**: `src/main.tsx:89`, `src/services/voice/VoiceRuntime.ts:387`, `src/pages/QuickChatRoot.tsx:21`

**Problem**: the main and Quick Chat roots instantiate independent JavaScript singletons. Voice interruption uses a DOM `window` event, so it cannot reach another WebView. Settings changes also update only the current settings-store instance.

**Impact**:

- Main and Quick Chat can speak concurrently.
- Main-window stop/disconnect/settings actions cannot reliably stop Quick Chat output.

**Fix**: added ordered Tauri claim/release/stop controls, cross-WebView remote-output state, and shared-storage synchronization for voice settings. User barge-in and global stop controls now reach companion WebViews without event loops.

### BUG-19 - MEDIUM - Legacy audio auto-play preference was reused for synthetic TTS

**Location**: `src/services/voice/VoiceRuntime.ts:59`, `src/pages/SettingsPage.tsx:700`

**Problem**: `aegis-audio-autoplay` originally controlled audio media playback. Reusing it for system synthesis changes the meaning of an existing persisted preference.

**Impact**:

- A legacy `true` value can unexpectedly make every assistant text response speak.
- Media auto-play and synthetic speech cannot be configured independently.

**Fix**: introduced `voiceAutoSpeak` under a new storage key, retained `audioAutoPlay` for live assistant media, and defaulted synthetic TTS to disabled.

### BUG-20 - MEDIUM - Quick Chat persists transient sessions as main chat tabs

**Location**: `src/pages/QuickChatPage.tsx:84`, `src/stores/chatStore.ts:1105`

**Problem**: Quick Chat calls `setActiveSession(sessionKey)`. That method appends unknown keys to `openTabs` and persists them to `aegis-open-tabs`; startup validation accepts any non-empty string.

**Impact**:

- Opening Quick Chat leaves `quickchat:*` ghost keys in main chat navigation preferences.
- Repeated Quick Chat windows can accumulate stale persisted tabs.

**Fix**: passed one immutable owner key from QuickChatRoot to QuickChatPage and removed use of the main chat active-tab API.

### BUG-21 - MEDIUM - Voice transport and cleanup assume a local Gateway

**Location**: `src/components/Chat/MessageInput.tsx:163`, `src/api/tauri-adapter.ts:823`

**Problem**: a successful local save causes chat to send the absolute local path instead of the audio attachment. Docker or external Gateway processes may not see that path. The declared voice `cleanupSession` hook is not implemented by the Tauri adapter.

**Impact**:

- Captured voice can be unreadable outside the native local runtime.
- Session deletion/reset leaves locally saved voice recordings behind.

**Fix**: Gateway now always receives a portable audio attachment; local persistence is optional, and successful session reset/deletion invokes session-scoped voice cleanup.

### BUG-22 - MEDIUM - Voice presentation outranks business attention states

**Location**: `src/dynamic-island/DynamicIsland.tsx:177`, `src/pet/pet-states.ts:194`

**Problem**: voice activity is checked before notifications, input-required/failed tasks, and tool activity in compact status derivation.

**Impact**:

- A spoken reply can mask an approval, failure, or active tool status.

**Fix**: retained resource-drop and direct voice-input feedback while restoring notice, attention, and tool states above passive playback.

### BUG-23 - CRITICAL - Remote playback state is invisible to local capture and controls

**Location**: `src/stores/voiceStore.ts`, `src/services/voice/VoiceRuntime.ts`, `src/hooks/useVoiceWake.ts`, `src/dynamic-island/DynamicIslandRuntime.tsx`

**Problem**: ordered claims stopped competing output but did not expose the winning remote output to the other WebView. A main-window native listener, stop control, pet, or Dynamic Island could therefore treat Quick Chat playback as idle.

**Impact**:

- Native VAD can capture companion-window speaker output as user input.
- Main-window status and barge-in controls can miss active Quick Chat audio.
- An out-of-order release/stop event can leave stale remote playback visible.

**Fix**: stored remote ownership separately from local input phase, propagated normal releases, made stop/release controls ordered tombstones, exposed remote output to all status/control surfaces, and made direct user input broadcast a global barge-in.

### BUG-24 - HIGH - Sanitized voice directories can collide across sessions

**Location**: `src/api/tauri-adapter.ts`

**Problem**: replacing every unsupported session-key character with `_` maps distinct keys such as colon- and slash-based variants to the same local directory.

**Impact**:

- Resetting or deleting one session can remove another session's retained recordings.

**Fix**: replaced lossy sanitization with injective UTF-8 base64url path encoding, bounded each path component, and added a terminal component so no encoded session directory can be an ancestor of another.

## Verified but deferred

- Picovoice/Porcupine fields remain explicitly labeled as reserved. Implementing a real wake-word model requires a provider choice and model/license assets, so this audit does not silently pretend that energy VAD is keyword detection.
- Native VAD still sends captured WAV to OpenClaw rather than doing local Whisper transcription. That boundary remains intentionally pluggable.

Historical validation snapshot for BUG-01 through BUG-17:

- Frontend suite: 943 passed; script suite: 30 passed.
- Rust library suite: 479 passed, 2 ignored.
- `pnpm lint`, `pnpm build`, targeted `rustfmt --check`, and `git diff --check`: passed.

Compatibility closeout validation for BUG-18 through BUG-24:

- Focused voice compatibility suite: 28 passed.
- Full frontend suite: 955 passed; script suite: 30 passed.
- Rust library suite: 479 passed, 2 ignored.
- `pnpm lint`, `pnpm build`, targeted `rustfmt --check`, locale JSON parsing, and `git diff --check`: passed.
