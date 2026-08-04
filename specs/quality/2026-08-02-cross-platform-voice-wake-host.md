# Cross-Platform Voice Wake Host

## Basis

- JunQi is the desktop client and preserves the selected OpenClaw Gateway as the only chat transport and identity authority.
- Sherpa-ONNX provides the local, streaming keyword-spotting API used by this host. The selected upstream bilingual model is documented by its maintainer as `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20`.
- Tauri autostart provides one desktop contract for macOS, Windows, and Linux.

## Previous Behavior

- `voice_wake_start` used only an RMS VAD threshold, so any sustained speech emitted `wake_detected`.
- The UI correctly reported wake word unavailable, and a close request always destroyed the main window after a workbench checkpoint.

## Target Behavior

- Dictation continues to use VAD.
- Wake-word mode starts only when the user has selected a local model directory containing the fixed Sherpa model files, `tokens.txt`, and a generated `keywords.txt`.
- The selected `phone+ppinyin` model must expose at least one official `@original_phrase` keyword label, no longer than the official Gateway protocol's 64 UTF-16-code-unit trigger limit, that exactly matches a configured Gateway trigger before wake-word mode can arm.
- The full-window Jarvis surface may select one or more labels declared by the selected local model and save only those labels through `voicewake.set`. Free-form text is not presented as a local wake phrase because the selected model requires an externally generated official keyword file.
- Jarvis configuration is available only at `/settings?tab=jarvis`. It owns model-directory selection, declared wake-phrase selection, and the explicit desktop-standby choice. Enabling desktop standby uses the Tauri autostart contract and binds the selected OpenClaw session key with the current verified JunQi runtime target fingerprint; it never persists a connection ID, credential, audio, or guessed target. A legacy binding without that fingerprint is inactive.
- The application root owns the armed listener, Talk relay, full-window Jarvis surface, and confirmed-draft lifecycle. Navigating away from chat must not unmount or stop an already armed listener. The conversation composer consumes that controller only for current-session start/stop and ordinary recorder controls.
- In wake-word mode, only a non-empty Sherpa keyword result emits `wake_detected`; VAD begins post-keyword capture and produces the existing confirmation-required WAV draft.
- The native event includes the non-empty recognized keyword. JunQi persists the selected session under the OpenClaw `category` `Jarvis: <keyword>`; it does not synthesize a channel-group session key from that keyword.
- A recognized wake keyword is not accepted for Talk or fallback capture until its `sessions.patch.category` response confirms the selected session's Jarvis category. Audio arriving during that bounded confirmation is retained only in memory for the current turn; a failed or stale category mutation discards it and stops the turn with a visible error.
- Wake mode starts only after the selected authenticated Gateway supplies a valid trigger and routing snapshot. While armed, a local keyword must remain in the Gateway trigger set. `current` routes are accepted locally; an explicit session route must equal the selected session key; an agent route must equal the selected session's Gateway-projected `agentId`. Missing identity, mismatch, or a route to another session discards WAV fallback and in-flight PCM audio without a chat request. JunQi does not infer agent identity from a session-key string or auto-switch the selected conversation.
- The window hides after the existing checkpoint only while the real wake-word listener is armed. Tray Quit remains an explicit exit.
- A verified wake result restores and unminimizes the main window before its full-window control surface is used. A platform focus denial must not discard the verified voice turn; a visibility restoration failure must remain diagnosable.
- The login-start choice starts JunQi on macOS, Windows, and Linux with the main window hidden. It restores only the explicitly saved session key after its Gateway connection is authenticated and its verified JunQi runtime target fingerprint matches the stored binding; it does not persist a connection ID, credential, audio, or guessed target.
- Login-start serialization must preserve the current executable path and every `--voice-resident` argument on Windows and Linux even when either contains spaces or characters reserved by the target startup format. A startup-format failure must surface as the existing autostart enable error; it must not select a different runtime or scheduler.

## Talk Relay Extension

- Continuous Jarvis Talk is available only when the selected, authenticated Gateway returns a `talk.catalog` payload with `realtime.ready: true` and a configured provider that explicitly supports `realtime`, `gateway-relay`, `agent-consult`, PCM16 input, and barge-in. `speech.ready` is not a current relay capability signal.
- JunQi creates only `talk.session.create({ mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult' })` sessions. It does not use browser-owned WebRTC or provider WebSocket paths for the desktop host.
- Audio is sent only as native PCM16 chunks. A complete WAV capture must not be submitted to `talk.session.appendAudio`.
- Gateway `talk.event` envelopes are validated and ordered per Talk session. Repeated or stale sequence numbers cannot update a newer voice turn.
- A verified local KWS phrase remains a user barge-in signal while assistant output is active; VAD-only input remains suppressed in that state. A user speech interruption must first stop local output and then request `talk.session.cancelOutput` on the same attested connection before closing a replaced Talk session. Connection changes close the local Talk owner and discard later events.

## Non-Goals

- Bundling model assets, generating keyword token files, automatic model download, or claiming a default JunQi pronunciation.
- Sending audio, text, or state to a second agent runtime. The existing confirmation and OpenClaw attachment transaction remain authoritative.
- Claiming verified microphone permissions, autostart registration, tray persistence, or package behavior on Windows, CentOS, or Ubuntu without target-platform evidence.

## Acceptance

- Missing or empty model assets keep wake-word mode unavailable.
- A selected model directory is persisted in JunQi application data and must pass both asset validation and Sherpa detector creation before it is reported available.
- The official-model audio fixture test is an explicit opt-in check that requires `JUNQI_WAKE_MODEL_DIR`; an environment without that fixture must report the test as ignored rather than passing without detection.
- A wake listener cannot be activated by VAD alone.
- A model whose labels have no intersection with the selected Gateway trigger list remains unavailable and does not capture audio.
- On an explicit user command, JunQi may replace only Gateway trigger items whose trim-exact labels are declared by the selected local model. It must preserve all other items, must not mutate voice-wake routing as part of that operation, and must re-read the normal arm preconditions afterwards.
- Existing dictation, session ownership, draft confirmation, and Gateway connection fences remain in force.
- A Gateway without the explicit realtime relay capability remains in the current confirmation-required voice-draft path; it is never presented as continuous Talk.
- A Talk session remains explicitly bound to its selected session key because the installed `talk.session.create` contract does not accept `voiceWakeTrigger`.
- A hidden standby window is restored after a verified wake result without adding a platform-specific window implementation.
- A close request received before workbench persistence becomes ready still queries the native listener. It hides the main window only for a verified wake-word listener; otherwise it completes a normal destroy. Once persistence is ready, the existing checkpoint and PTY shutdown remain before that decision.
- A rejected or failed Jarvis category update cannot forward pending PCM or WAV audio to Talk or ordinary chat, and the user receives a recoverable category error.
- An `agentId` wake route is accepted only when the selected session carries the same authoritative Gateway `agentId`; a key-shaped string without that projection, or another agent, fails closed.
- While the authenticated Talk relay is opening, a completed WAV capture waits for that result. A ready relay owns the PCM and suppresses the duplicate WAV; an unavailable relay leaves the existing confirmation-required WAV draft available. Each boundary retains the complete bounded native VAD turn during setup.
- Windows Run and Linux Desktop Entry command encoders have executable unit tests for whitespace and format-reserved characters.
- The Dynamic Island close control requests only an immediate native hide of its own auxiliary window, then asks the main window to persist the disabled preference. The dedicated native request cannot open the window or write preferences, and a lost cross-window event cannot leave the close control without visible effect.
- Changing desktop standby in Settings immediately notifies the application runtime: enabling re-evaluates the normal authenticated arming gate and disabling releases capture before the persisted target is cleared.
- A saved standby binding must include an exact session key and verified runtime target fingerprint. Changing runtime before or during autostart confirmation fails closed, does not arm capture, and rolls system autostart back when it was newly enabled.
