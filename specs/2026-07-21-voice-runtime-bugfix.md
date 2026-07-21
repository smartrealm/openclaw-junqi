# Voice Runtime Bugfix Specification

Date: 2026-07-21

Status: BUG-01 through BUG-24 fixed and validated

Validation: focused voice compatibility `28 passed`; full frontend `955 passed`, scripts `30 passed`; Rust library `479 passed, 2 ignored`; lint, build, rustfmt, locale JSON, and diff checks passed.

### BUG-01 - VAD worker generation ownership

**Current**: every exiting worker marks whichever global wake state currently exists as stopped.

**Target**: `WakeState` and each worker carry the same unique ID; cleanup and late events are accepted only while that ID is current.

**Acceptance**:

- [x] An old worker cannot change a replacement worker's `running` flag.
- [x] Rust regression test covers mismatched and matched worker IDs.
- [x] A startup failure is returned synchronously instead of leaving a dead worker marked active.
- [x] A stale command-level `stopped` event cannot disable a replacement worker.

### BUG-02 - Recognition callback ownership

**Current**: callbacks mutate state and submit captured input without checking recognizer identity, stop state, or latest session; native deliveries can overlap.

**Target**: all recognizer callbacks require current ownership, callbacks/session are read from refs, native events require an active native backend, and WAV delivery is FIFO serialized.

**Acceptance**:

- [x] A stopped or replaced recognizer cannot deliver a transcript or schedule restart.
- [x] A session switch routes the next result through the latest callback/session.
- [x] At most one native capture callback is awaiting at a time.

### BUG-03 - Quick Chat voice session scope

**Current**: all Gateway assistant callbacks are passed to the Quick Chat voice runtime.

**Target**: the root creates one quick-chat owner key, passes it to the page, and callbacks accept only that key without mutating main chat navigation state.

**Acceptance**:

- [x] A main-session event is rejected by the Quick Chat voice gate.
- [x] The owned quick-chat session is accepted.
- [x] Quick Chat ownership does not call `setActiveSession` or persist a main chat tab.

### BUG-04 - Scoped interruption preserves unrelated queue entries

**Current**: incrementing a global playback generation makes every surviving queue item stale.

**Target**: scoped cancellation invalidates the current utterance, retags surviving entries, and resumes them.

**Acceptance**:

- [x] Interrupting session A does not drop queued speech for session B.
- [x] Global interruption still clears every item.

### BUG-05 - Streaming speech extraction

**Current**: a chunk-terminal period is emitted immediately and raw text reaches the splitter before incomplete control blocks are removed.

**Target**: terminal ASCII periods wait for the next chunk/final flush; cumulative sanitized speech text is the delta source and unmatched control constructs are withheld.

**Acceptance**:

- [x] `v1.` followed by `2` is spoken as `v1.2`, not two utterances.
- [x] Punctuation inside an unfinished code/artifact/directive block is never spoken.

### BUG-06 - External playback coordination

**Current**: every audio element auto-plays from a global setting and external media bypasses voice state.

**Target**: a live assistant response registers one pending media URL; only a matching assistant player can claim auto-play; play/pause/end/error update the runtime and stop prior output.

**Acceptance**:

- [x] Historical and user audio do not auto-play merely because the setting is enabled.
- [x] Claimed assistant media enters `speaking` and responds to global/session stop.
- [x] Quick Chat renders assistant media through the same coordinator.

### BUG-07 - Barge-in coverage

**Current**: direct text sends and Escape can leave completed-response audio playing.

**Target**: Escape prioritizes active voice/AI cancellation, and every non-queued main or Quick Chat send interrupts owned voice first.

**Acceptance**:

- [x] Escape during speech stops audio and does not recall chat history.
- [x] Sending a new request stops the previous spoken reply.

### BUG-08 - Voice file persistence and encoding

**Current**: saving calls the user-visible `open_folder` command; reading spreads the entire byte array into one function call.

**Target**: recursive `mkdir` creates the private voice directory and a shared chunked encoder handles arbitrary byte lengths.

**Acceptance**:

- [x] Saving a recording never invokes `open_folder`.
- [x] Encoding a byte array larger than JavaScript's argument limit succeeds.

### BUG-09 - Native manual recording fallback

**Current**: browser capture failure ends the flow; native stop sleeps for a guessed interval before reading.

**Target**: browser capture falls back to typed native start/stop methods; the native command confirms startup and joins the exact worker before reading/removing the WAV.

**Acceptance**:

- [x] VoiceRecorder can send a native WAV data URL when MediaRecorder is unavailable.
- [x] Native start reports setup failure synchronously.
- [x] Native stop reads only after worker finalization.

### BUG-10 - Native VAD pre-roll and sample formats

**Current**: capture begins only after the speech threshold and `U16` input is rejected.

**Target**: a bounded pre-roll buffer is copied into each utterance and unsigned samples are centered into signed PCM for VAD/WAV.

**Acceptance**:

- [x] A unit test proves samples before the trigger are present in the utterance.
- [x] `U16` RMS/capture conversion is covered and accepted by the input stream match.

### BUG-11 - External playback ownership

**Current**: claiming one assistant media element clears all pending external requests, and ownerless players accept session-scoped interrupt events.

**Target**: replacing the physical player preserves pending requests for other sessions; scoped interrupts pause only the matching owner.

**Acceptance**:

- [x] Starting session A media does not clear session B's pending request.
- [x] A session-specific interrupt does not pause an ownerless/history player.

### BUG-12 - VAD startup lifecycle

**Current**: worker setup can fail before global state registration, and command-level stopped events are not tied to the worker being stopped.

**Target**: startup has a bounded readiness handshake and stale stop notifications are suppressed while a replacement worker is registered.

**Acceptance**:

- [x] Missing-device/setup failure reaches the caller synchronously.
- [x] Stop followed immediately by start cannot turn the new listener off.

### BUG-13 - Manual recorder async ownership

**Current**: an async browser/native start may complete after the component has been cleaned up.

**Target**: only the latest mounted start attempt can own capture resources; late resources are stopped and browser chunks are finalized before cleanup.

**Acceptance**:

- [x] Concurrent starts produce at most one active backend.
- [x] Unmount during startup leaves no native/browser capture active.

### BUG-14 - Native capture session ownership

**Current**: queued native WAVs are drained through the latest callback/session.

**Target**: each capture carries its owner and is discarded if that session is no longer active when delivery begins.

**Acceptance**:

- [x] A queued capture cannot be sent to a newly selected session.

### BUG-15 - Native recorder slot ownership

**Current**: concurrent native starts can both pass the initial empty-slot check and later overwrite the global `ActiveRecording` handle.

**Target**: replacement and final slot installation are serialized so every worker is either joined or owned by the global slot.

**Acceptance**:

- [x] A racing start cannot orphan a worker without a stop handle.
- [x] The next stop command always addresses the currently installed worker.

### BUG-16 - Native VAD playback feedback

**Current**: raw native VAD can treat JunQi's speaker output as user speech and feed it back into chat.

**Target**: a native utterance detected during owned queued/speaking output is suppressed through its matching captured event.

**Acceptance**:

- [x] Native playback cannot invoke the wake callback or enqueue its captured WAV.
- [x] Suppression resets after one captured utterance or listener shutdown.

### BUG-17 - Assistant segment speech boundaries

**Current**: one run ID can cover several tool-separated message segments, so a reset payload is treated as continuation text.

**Target**: VoiceRuntime receives a stable message-segment ID and flushes a prior segment tail before switching identities.

**Acceptance**:

- [x] A punctuation-free pre-tool segment is spoken separately from the post-tool segment.
- [x] Normal cumulative chunks within one message remain deduplicated.

### BUG-18 - Cross-WebView voice ownership

**Current**: each WebView owns an isolated runtime and DOM-only stop event, so concurrent output and partial stop behavior are possible.

**Target**: every output start publishes a deterministically ordered global claim; other WebViews stop local output, and a global stop command reaches all runtimes without rebroadcast loops.

**Acceptance**:

- [x] A newer Quick Chat claim interrupts main-window output and vice versa.
- [x] Main settings/disconnect stop commands reach every open voice runtime.
- [x] Browser preview remains a safe no-op when the Tauri event bridge is absent.

### BUG-19 - Independent speech settings

**Current**: `audioAutoPlay` enables both live media and synthetic text speech.

**Target**: `audioAutoPlay` controls only live assistant media; `voiceAutoSpeak` independently controls system TTS under `aegis-voice-auto-speak` and defaults to false.

**Acceptance**:

- [x] A legacy audio auto-play value never enables synthetic TTS.
- [x] Live assistant media and text speech can be enabled or disabled independently.
- [x] Setting changes synchronize into another WebView's settings store.

### BUG-20 - Quick Chat navigation isolation

**Current**: mounting Quick Chat calls `setActiveSession`, which appends and persists its generated key as an open main-chat tab.

**Target**: root callbacks and the page share an explicit immutable owner key without using main navigation APIs.

**Acceptance**:

- [x] Opening and closing Quick Chat leaves `aegis-open-tabs` unchanged.
- [x] Gateway callbacks still accept only the exact owned session.

### BUG-21 - Portable voice attachments and cleanup

**Current**: successful local persistence sends only an absolute path, and session cleanup has no voice adapter implementation.

**Target**: Gateway always receives the complete audio attachment; local persistence is optional and its session directory is removed after successful session delete/reset.

**Acceptance**:

- [x] Voice send uses `attachments` even when local save succeeds.
- [x] No base64 content is embedded into the visible message text.
- [x] Voice cleanup removes only the encoded target session directory.

### BUG-22 - Business status presentation priority

**Current**: passive voice playback can replace an attention/notice/tool headline or pet state.

**Target**: resource drop, connection failure, notices, attention tasks, and tool activity retain priority; voice remains visible when no higher-priority business state exists.

**Acceptance**:

- [x] Dynamic Island attention and notice headlines beat voice playback.
- [x] Pet tool state beats voice playback while direct voice listening remains user-visible.

### BUG-23 - Remote output state and ordered release

**Current**: claim events stop local output, but the winning remote output is not visible to local VAD suppression, status surfaces, or user controls; asynchronous event reordering can revive stale state.

**Target**: remote output is stored independently from local input phase, normal cleanup releases ownership, and claim/release/stop messages share deterministic ordering and stale-event rejection.

**Acceptance**:

- [x] Remote playback appears in the main input controls, Dynamic Island, and pet state.
- [x] Native VAD suppresses capture while either local or remote output is active.
- [x] Direct user input and Escape stop companion-window output.
- [x] Release-before-claim and stop-before-claim delivery cannot revive stale ownership.
- [x] Local Quick Chat cleanup emits release without stopping unrelated main-window output.

### BUG-24 - Collision-free voice retention paths

**Current**: lossy `_` replacement can map distinct session keys to one directory, and recursive cleanup can delete both sessions' files.

**Target**: every session key maps injectively to a path below the voice root, with bounded components and no session path that can be another session's ancestor.

**Acceptance**:

- [x] Formerly colliding session keys map to distinct directories.
- [x] Encoded paths contain no traversal segments.
- [x] Exact component-boundary prefixes cannot create ancestor directories.
