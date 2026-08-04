# Cross-Platform Voice Wake Host Verification Record

## Implemented Boundary

本记录中的 OpenClaw Talk 目录表述已按官方当前 schema 校正：就绪状态来自 `realtime.ready`，provider 的音频格式与 barge-in 能力是可选声明；JunQi 只有在当前 Gateway 明确提供完整的桌面 PCM 能力时才启用 relay。`package.json`、lockfile 和本机安装包只作为复现实验与验证范围证据，不作为协议契约或版本分支条件。详见 [Talk 目录对齐记录](openclaw-talk-catalog-alignment-2026-08-03.md)。

The native host uses CPAL for microphone capture and Sherpa-ONNX for local keyword spotting. It does not introduce an OpenJarvis, Kiwi Voice, browser VAD, or proxy runtime. OpenClaw remains the selected Gateway authority. A verified keyword may enter the separately catalog-gated Talk path when the Gateway advertises that capability; otherwise the existing WAV fallback retains its explicit confirmation boundary. This JunQi local detector integration is not a claim that OpenClaw natively guarantees persistent recognition on every desktop platform.

The local detector requires the extracted official bilingual model directory with these files:

- `encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx`
- `decoder-epoch-13-avg-2-chunk-16-left-64.onnx`
- `joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx`
- `tokens.txt`
- `keywords.txt`

`keywords.txt` is intentionally not generated from guessed text. It must be produced with the model's official tokenization procedure and reviewed with the selected wake phrase. For the selected `phone+ppinyin` model, JunQi reads only the official `@original_phrase` labels from that file; a missing label makes the model unavailable. Labels must not exceed the OpenClaw voice-wake trigger limit declared by the official Gateway contract, so a model that cannot be synchronized to the selected Gateway is rejected before it can arm.

## Residency

When a wake-word listener is armed, the existing workbench checkpoint and PTY shutdown finish before the main window is hidden. The process remains available through the existing tray. A normal close still destroys the window. Login-start opens JunQi with its main window hidden, persists the explicitly selected session key together with the current verified JunQi runtime target fingerprint, and restores listening only after that session has an authenticated OpenClaw connection on the same verified target. It does not persist a connection ID, credential, audio, or transcript.

Before the workbench writer becomes ready, a close request cannot create a checkpoint. It still prevents the native close long enough to read the listener status: an actively running wake-word listener hides the main window, while any unavailable, dictation, or failed status completes a normal destroy. Once the writer is ready, the regular checkpoint and PTY shutdown remain mandatory before this same decision.

After a confirmed or discarded audio draft, the session-scoped automatic arm request is renewed. Native listener failures retry with a bounded exponential delay while the same authenticated session remains selected; a successful listener clears that retry count. Model configuration is written atomically. The application-root `JarvisVoiceRuntime` owns the typed native listener and callbacks; navigating away from chat cannot unmount it.

Wake mode is not confined to the composer. Once selected, the application root presents a fixed full-window control surface above the desktop workspace for local listening, keyword detection, draft confirmation, and recoverable errors. Escape and the visible stop controls release capture. Model directory, declared wake phrases, and desktop standby are configured only through Settings `Jarvis`; the assistant pet and Dynamic Island remain separate auxiliary projections and receive only mode, phase, confirmation-needed, and error cues.

When the main window is hidden for standby, a verified local wake result requests `show`, `unminimize`, and `setFocus` before the full-window surface is presented. Operating systems may reject focus stealing; that result does not cancel the already verified voice turn, but a failure to restore visibility is reported to the media debug scope. The behavior uses Tauri's common window API rather than a macOS-only activation path.

## Login-Start Audit

The voice login-start switch is distinct from the OpenClaw Gateway service autostart switch. It uses the installed `tauri-plugin-autostart 2.5.1` API to add `--voice-resident`, while JunQi restores only the separately selected session after Gateway authentication. The selected plugin delegates Windows Run and Linux Desktop Entry creation to `auto-launch 0.5.0`. Its installed source concatenates the executable path and arguments without Windows quoting and writes Linux `Exec` without Desktop Entry quoting. That cannot represent an application path with spaces and is therefore a cross-platform wake-residency defect.

The remediation keeps the Tauri plugin API and uses an application-scoped `auto-launch 0.5.0` source patch. Windows values quote every command-line argument according to Windows parsing rules. Linux values quote whole `Exec` arguments that contain a reserved character, then escape only double quote, backtick, dollar sign, and backslash inside that quoted argument, as required by the Freedesktop Desktop Entry `Exec` specification. The Linux path uses an absolute `XDG_CONFIG_HOME` when present and otherwise the user's `.config` directory. The existing first-run flow preview concerns Gateway service ownership, not this per-user JunQi login item, so it has no behavior change to render.

## Jarvis Session Categories

OpenClaw 官方将渠道群组路由与用户定义的 session organization bucket 分开。JunQi 不为唤醒词捏造渠道式 `:group:` session key。当本地 Sherpa detector 返回非空关键词时，JunQi 会把 Gateway 官方支持的 `sessions.patch({ key, category: "Jarvis: <keyword>" })` 应用于当前选中的 OpenClaw session。Session Manager 展示该 category 并提供 Jarvis 筛选，因此同一识别短语激活的会话可以归入一个桌面分组，同时不改变渠道路由、sandbox policy 或 session identity。

The category mutation is part of wake acceptance, not a best-effort annotation. Until its authenticated response confirms the selected session, JunQi retains only the current turn's bounded in-memory PCM or fallback WAV. A category failure, target switch, or connection change discards the buffered audio, stops the turn, and shows a recoverable category error. This prevents a conversation from proceeding as a Jarvis wake turn when its promised group assignment did not persist.

OpenClaw voice-wake routing can target `current`, an agent, or a canonical session key, but `talk.session.create` has no `voiceWakeTrigger` parameter. Continuous Talk therefore stays bound to the resolved selected session; it does not claim that Gateway automatically routes Talk audio by keyword. The local model's `keywords.txt` remains externally generated through the selected model's documented tokenization process. JunQi does not write or infer that asset.

Before a wake listener starts, JunQi reads both `voicewake.get` and `voicewake.routing.get` from the selected authenticated Gateway and retains the resulting configuration only for that live connection. Gateway `voicewake.changed` and `voicewake.routing.changed` updates replace the matching in-memory portion. A local KWS result that is absent from the Gateway trigger list is discarded without forwarding WAV fallback or in-flight PCM audio. A `current` route is accepted locally; an explicit session route must equal the selected session key; an agent route must equal the selected session's Gateway-projected `agentId`. JunQi does not derive that agent identity from the session-key spelling. A missing identity, mismatched agent, or target outside the selected session is stopped with `target_changed` rather than silently delivering Talk to a different chat; full cross-session Talk handoff remains pending because the Talk contract has no wake-trigger field.

Arming also requires at least one Gateway trigger to exactly match a label actually present in the selected local model. A mismatch is shown as `wake_trigger_model_mismatch`, leaves capture stopped, and offers the existing model-directory selection control. JunQi does not translate arbitrary user text into pinyin or phoneme tokens: the upstream model requires `phone+ppinyin`, `en.phone`, and an `@original_phrase` marker, so unverified local rewriting would make a custom wake word appear configured while the detector could not reliably recognize it.

When this mismatch is visible, the user can explicitly choose `Use local model wake phrases`. JunQi first reads the selected authenticated Gateway's current global trigger list, replaces only trim-exact labels declared by the local model, preserves every other trigger, and waits for the fenced `voicewake.set` response before retrying the normal arm sequence. It intentionally does not call `voicewake.routing.set`, so existing Gateway routes and their target sessions remain unchanged. The model keyword file remains the source of this explicit synchronization; JunQi never accepts a free-form phrase and claims it is tokenized.

The full-window Jarvis surface also lets the user select a non-empty subset of labels declared by the chosen local model. The selection is matched by trim-exact labels, merged with the latest Gateway snapshot, and rejected before write when the official global-list capacity would be exceeded. The Gateway response becomes the new live trigger snapshot and re-arms through the normal configuration gate. This makes supported custom model phrases selectable without claiming that arbitrary text has been tokenized locally.

## Talk Relay Boundary

JunQi now has a fenced client for the official OpenClaw `talk.catalog` and `talk.session.*` protocol, plus a strict `talk.event` bridge. The client rejects a missing or unready catalog and only creates the documented `realtime/gateway-relay/agent-consult` session shape after the catalog explicitly advertises the native PCM16 24000Hz mono input/output contract and barge-in support. It binds every request to the attested Gateway connection and rejects a response if that connection changed.

The event bridge validates the OpenClaw Talk envelope within `payload.talkEvent` and retains the highest sequence number per Talk session. Malformed Talk envelopes are consumed without falling through to chat handling; duplicate or stale event sequences are discarded. The native worker now emits PCM16/24000Hz/mono frames only after a VAD or verified keyword trigger, while preserving WAV only for the confirmation-required fallback. Gateway PCM output is queued through a Rust-owned Rodio/CPAL playback thread; it does not use Web Speech. The Talk relay is created on a keyword trigger rather than when the listener arms, so idle standby cannot consume its Gateway session TTL; early PCM is bounded and retained while that session connects.

The WAV fallback waits for an in-flight Talk relay creation before choosing its path. If the relay becomes ready, it has already received the retained PCM and the WAV is discarded as a duplicate; if relay creation fails, the WAV remains the existing confirmation-required draft. Both the category-confirmation and relay-creation boundaries retain up to one native VAD turn (15 seconds at the worker's 20 ms poll cadence), rather than dropping the beginning of a valid user utterance during normal Gateway latency.

## Barge-In Boundary

A recognized native KWS phrase is the explicit barge-in signal, so JunQi accepts it even while assistant output is active. VAD-only events have no independently verified phrase and remain suppressed during output to reduce playback feedback from being accepted as user audio. On a new accepted wake, an existing Talk relay stops local output first, requests `talk.session.cancelOutput` on the same attested Gateway connection, and only then closes the old relay before creating the new session. The regular local chat abort remains separate for non-Talk streamed replies.

Talk's native PCM output publishes only its active session key and `speaking` state to the existing local voice runtime. The full-window surface retains its more detailed connecting/listening/speaking state; the Dynamic Island and pet consume the ordinary non-sensitive voice projection and therefore change to speaking while native Talk audio plays. Neither projection receives relay audio, transcript, or credentials.

## Talk Output Ordering

The OpenClaw Talk relay emits ordered `output.audio.delta` frames and then `output.audio.done`. JunQi serializes every accepted PCM16 frame for one attested session before it crosses Tauri IPC. The native playback worker appends those frames to one Rodio sink. The done event does not stop that sink: it waits until the sink has consumed its queued audio, then transitions the full-window surface and its projections from speaking to listening.

Interruption, relay replacement, close, and relay failure invalidate the queued generation before sending the native stop command. A frame that was waiting behind an interrupted frame cannot begin playback afterward. The native drain wait processes stop commands while waiting, so a recognized barge-in is not delayed by a long assistant reply.

## Configuration And Auxiliary Controls

Jarvis configuration is a desktop-level concern and is reachable through the Settings `Jarvis` tab. It owns the local model-directory selection, explicit Gateway trigger update, and the desktop standby switch. The selected model directory remains in native application data, the trigger list remains Gateway-owned, and the selected standby target is a canonical OpenClaw session key paired with a verified JunQi runtime target fingerprint. The page does not obtain microphone access, create a Talk session, or rewrite voice-wake routing. Changing standby publishes immediately to the root runtime, which re-evaluates the normal authenticated arming gate or releases the current capture. The conversation composer retains only a shortcut that controls its selected, attested session.

The Dynamic Island auxiliary window closes itself through its native command before it emits the main-window preference action. This preserves immediate visual feedback even if a cross-window event is unavailable; the subsequent main-window action still persists the user preference and prevents reopening on later state updates.

## Automated Evidence

- `pnpm exec tsc --noEmit` passed.
- `cd src-tauri && cargo fmt -- --check && cargo check --lib` passed. The existing `system.rs` unused-variable warning remains.
- `cd src-tauri && cargo test --lib voice_wake` passed with 7 tests, including missing model assets and a stereo callback-boundary regression.
- `official_model_fixture_detects_a_keyword_when_supplied` is explicitly ignored in ordinary library runs because the official model fixture is not bundled. It must be invoked with `JUNQI_WAKE_MODEL_DIR=<official fixture>` before claiming a real KWS detection result.
- On 2026-08-02, the fixture-gated command was invoked with the official `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20` archive, its upstream `zh_3.wav`, and the corresponding generated `keywords.txt`; the detector test passed on the local macOS build and asserted that the detected phrase is a declared model label. This proves the model integration only, not microphone permission, background focus, Gateway relay, or other target platforms.
- Frontend voice, session-fence, and auto-arm preference tests passed: 15 tests.
- On 2026-08-02, the complete `pnpm test` suite passed after adding the regression that requires rejected wake keywords to suppress in-flight PCM before the Talk relay callback.
- `pnpm build` passed, including the collaboration package contract, plugin bundle, TypeScript compilation, and Vite production build.
- The test command recursively discovers TypeScript and TSX tests under `src`; this includes `voiceAuditRegression.test.ts`, which previously was not covered by the shell glob.
- The updated regression suite verifies large-audio encoding and portable session-directory isolation through exported behavior. Native recorder lifecycle and VAD worker lifecycle remain covered by Rust library tests.
- Runtime microphone stream errors now terminate the native listener, emit its existing error event, and mark native listening as stopped; the regression test covers that transition.
- The complete Rust library suite passed with 692 tests passed and 4 intentionally ignored tests. The fourth ignored test is the official-model fixture check described above, not a passing no-op.
- The login-start repair requires executable unit coverage for Windows command-line quoting and Linux Desktop Entry `Exec` serialization. Source-text assertions are not sufficient evidence for this behavior.
- On 2026-08-02, `cargo test --manifest-path src-tauri/vendor/auto-launch/Cargo.toml` passed 3 portable command-serialization tests. `cargo fmt -- --check`, `cargo check --lib`, and the complete `cargo test --lib` suite also passed; the library suite reported 692 passed and 4 ignored tests.
- On 2026-08-02, `pnpm lint`, the complete `pnpm test` suite, `pnpm build`, and `git diff --check` passed after the login-start serialization repair. Rust still reports the pre-existing unused `version_beyond_verified_range` variable in `system.rs`.
- On 2026-08-02, the wake-category acceptance gate tests passed with the voice coordinator, wake-audit, and composer-voice suites (31 tests). The TypeScript check, production build, Rust format/check, and complete Rust library suite passed; the library suite reported 692 passed and 4 ignored tests.
- On 2026-08-02, the Talk relay regression suite covered PCM arriving in the same event turn as relay setup, WAV fallback waiting for relay creation, and an explicit stop discarding retained PCM before a later relay. The complete frontend lint/test suite, production build, Rust format/check, and Rust library suite passed; the library suite reported 692 passed and 4 ignored tests.
- On 2026-08-02, the voice-residency policy test verified that only a real native wake-word listener may keep the application resident; dictation, stopped listeners, and unavailable status do not change normal close behavior. The complete frontend lint/test suite, production build, Rust format/check, and Rust library suite passed; the library suite reported 692 passed and 4 ignored tests.
- On 2026-08-02, model-backed wake phrase selection tests verified exact declared-label preservation across Gateway snapshots and rejected empty, duplicate, or undeclared selections. The complete frontend lint/test suite, production build, Rust format/check, and Rust library suite passed; the library suite reported 692 passed and 4 ignored tests.
- On 2026-08-02, barge-in policy tests verified that a declared KWS phrase is accepted during assistant output while unverified VAD/browser input remains suppressed. The Talk coordinator regression verifies local playback stop, Gateway cancellation, and old-relay close in that order when a new wake replaces an active relay.
- On 2026-08-02, the native Talk projection regression verified that only the owning Talk session can publish and clear the shared `speaking` state consumed by the pet and Dynamic Island.
- On 2026-08-02, `pnpm lint`, the complete `pnpm test` suite (2,242 frontend tests and 233 script tests), `pnpm build`, `cargo fmt -- --check`, `cargo check --lib`, and `cargo test --lib` passed. The Rust library suite reported 692 passed and 4 intentionally ignored tests; the existing `system.rs` unused-variable warning remains.
- On 2026-08-02, the Talk output ordering regression verified that PCM deltas serialize, `output.audio.done` waits for native drain, and stopping a relay fences queued playback. The complete frontend lint/test/build suite and complete Rust library suite passed again; Rust reported 692 passed and 4 intentionally ignored tests, with the existing `system.rs` unused-variable warning.
- On 2026-08-02, Dynamic Island close regression verified immediate local native hide before the main-window preference action. The Settings Jarvis tab passed TypeScript, module-boundary, Gateway trigger contract, model-label selection, locale JSON, complete frontend test, and production build validation.
- On 2026-08-02, the Jarvis ownership remediation moved the native listener and full-window overlay to the application-root runtime, added Settings-owned desktop standby with a selected-session binding, and verified immediate preference publication with a behavior test. Target-platform microphone and login-start validation remains separately unverified.
- Capability and locale JSON parsed successfully, and `git diff --check` passed.

## Unverified Boundaries

- No model archive is bundled in this change.
- JunQi does not yet provide an in-app keyword token generator; a custom phrase still requires a model package generated using the upstream tokenizer before it can be selected and matched to Gateway configuration.
- No microphone, login-start, tray, sleep-resume, or package validation has been performed on Windows, CentOS, or Ubuntu.
- No target-platform test has registered or executed the repaired Windows Run value or Linux Desktop Entry. Unit tests can prove the serialized value, but Windows sign-in and each supported Linux desktop session remain target-platform validation work.
- No target-platform test has confirmed whether a background wake may claim focus under the local Windows, CentOS, Ubuntu, or macOS focus policy.
- The local development machine is not evidence of target-platform behavior.
- A real Talk relay session has not yet been exercised against a configured Gateway or on target operating systems.
