# Cross-Platform Voice Wake Host Verification Record

## Implemented Boundary

The native host uses CPAL for microphone capture and Sherpa-ONNX for local keyword spotting. It does not introduce an OpenJarvis, Kiwi Voice, browser VAD, or proxy runtime. After a keyword result, the existing JunQi capture flow creates a local WAV draft and retains explicit user confirmation before the existing OpenClaw attachment transaction is invoked. OpenClaw remains the selected Gateway authority.

The local detector requires the extracted official bilingual model directory with these files:

- `encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx`
- `decoder-epoch-13-avg-2-chunk-16-left-64.onnx`
- `joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx`
- `tokens.txt`
- `keywords.txt`

`keywords.txt` is intentionally not generated from guessed text. It must be produced with the model's official tokenization procedure and reviewed with the selected wake phrase.

## Residency

When a wake-word listener is armed, the existing workbench checkpoint and PTY shutdown finish before the main window is hidden. The process remains available through the existing tray. A normal close still destroys the window. Login-start opens JunQi with its main window hidden, persists only the explicitly selected session key, and restores listening only after that session has an authenticated OpenClaw connection. It does not persist a connection ID, credential, audio, or transcript.

After a confirmed or discarded audio draft, the session-scoped automatic arm request is renewed. Native listener failures retry with a bounded exponential delay while the same authenticated session remains selected; a successful listener clears that retry count. Model configuration is written atomically. The React workspace receives typed detector data and callbacks from the composer hook; direct Tauri invocation is limited to the typed adapter.

Wake mode is not confined to the composer. Once selected, it presents a fixed full-window control surface above the desktop workspace for local listening, keyword detection, draft confirmation, model configuration, and recoverable errors. Escape and the visible stop controls release capture. The assistant pet and Dynamic Island remain separate auxiliary projections and receive only mode, phase, confirmation-needed, and error cues.

## Jarvis Session Categories

OpenClaw `v2026.7.1-2` separates channel group-session routing from a user-defined session organization bucket. JunQi does not fabricate a channel-style `:group:` session key for a wake word. When the local Sherpa detector returns a non-empty keyword, JunQi persists `sessions.patch({ key, category: "Jarvis: <keyword>" })` for the currently selected OpenClaw session. The Session Manager renders that category, so sessions activated by the same recognized phrase can be identified as one Jarvis group without changing channel routing, sandbox policy, or session identity.

OpenClaw voice-wake routing can target `current`, an agent, or a canonical session key, but `talk.session.create` has no `voiceWakeTrigger` parameter. Continuous Talk therefore stays bound to the resolved selected session; it does not claim that Gateway automatically routes Talk audio by keyword. The local model's `keywords.txt` remains externally generated through the selected model's documented tokenization process. JunQi does not write or infer that asset.

## Talk Relay Boundary

JunQi now has a fenced client for the installed OpenClaw `talk.catalog` and `talk.session.*` protocol, plus a strict `talk.event` bridge. The client rejects a missing or unready catalog and only creates the documented `realtime/gateway-relay/agent-consult` session shape after the catalog explicitly advertises PCM16 input and barge-in support. It binds every request to the attested Gateway connection and rejects a response if that connection changed.

The event bridge validates the OpenClaw Talk envelope within `payload.talkEvent` and retains the highest sequence number per Talk session. Malformed Talk envelopes are consumed without falling through to chat handling; duplicate or stale event sequences are discarded. The native worker now emits PCM16/24000Hz/mono frames only after a VAD or verified keyword trigger, while preserving WAV only for the confirmation-required fallback. Gateway PCM output is queued through a Rust-owned Rodio/CPAL playback thread; it does not use Web Speech. The Talk relay is created on a keyword trigger rather than when the listener arms, so idle standby cannot consume its Gateway session TTL; early PCM is bounded and retained while that session connects.

## Automated Evidence

- `pnpm exec tsc --noEmit` passed.
- `cd src-tauri && cargo fmt -- --check && cargo check --lib` passed. The existing `system.rs` unused-variable warning remains.
- `cd src-tauri && cargo test --lib voice_wake` passed with 7 tests, including missing model assets and a stereo callback-boundary regression.
- `JUNQI_WAKE_MODEL_DIR=<official fixture> cargo test --manifest-path src-tauri/Cargo.toml --lib official_model_fixture_detects_a_keyword_when_supplied` passed with the upstream bilingual model and its `zh_3.wav` fixture.
- Frontend voice, session-fence, and auto-arm preference tests passed: 15 tests.
- `pnpm build` passed, including the collaboration package contract, plugin bundle, TypeScript compilation, and Vite production build.
- The test command recursively discovers TypeScript and TSX tests under `src`; this includes `voiceAuditRegression.test.ts`, which previously was not covered by the shell glob.
- The updated regression suite verifies large-audio encoding and portable session-directory isolation through exported behavior. Native recorder lifecycle and VAD worker lifecycle remain covered by Rust library tests.
- Runtime microphone stream errors now terminate the native listener, emit its existing error event, and mark native listening as stopped; the regression test covers that transition.
- The complete Rust library suite passed with 691 tests passed and 3 intentionally ignored tests.
- Capability and locale JSON parsed successfully, and `git diff --check` passed.

## Unverified Boundaries

- No model archive is bundled in this change.
- No microphone, login-start, tray, sleep-resume, or package validation has been performed on Windows, CentOS, or Ubuntu.
- The local development machine is not evidence of target-platform behavior.
- A real Talk relay session has not yet been exercised against a configured Gateway or on target operating systems.
