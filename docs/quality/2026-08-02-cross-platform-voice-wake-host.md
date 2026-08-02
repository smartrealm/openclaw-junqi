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
- The complete Rust library suite passed with 688 tests passed and 3 intentionally ignored tests.
- Capability and locale JSON parsed successfully, and `git diff --check` passed.

## Unverified Boundaries

- No model archive is bundled in this change.
- No microphone, login-start, tray, sleep-resume, or package validation has been performed on Windows, CentOS, or Ubuntu.
- The local development machine is not evidence of target-platform behavior.
