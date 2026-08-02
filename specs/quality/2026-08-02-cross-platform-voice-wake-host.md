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
- In wake-word mode, only a non-empty Sherpa keyword result emits `wake_detected`; VAD begins post-keyword capture and produces the existing confirmation-required WAV draft.
- The native event includes the non-empty recognized keyword. JunQi persists the selected session under the OpenClaw `category` `Jarvis: <keyword>`; it does not synthesize a channel-group session key from that keyword.
- Wake mode starts only after the selected authenticated Gateway supplies a valid trigger and routing snapshot. While armed, a local keyword must remain in the Gateway trigger set, and a resolved route must still match the selected session; otherwise captured audio is discarded and no chat request is made.
- The window hides after the existing checkpoint only while the real wake-word listener is armed. Tray Quit remains an explicit exit.
- The login-start choice starts JunQi on macOS, Windows, and Linux with the main window hidden. It restores only the explicitly saved session key after its Gateway connection is authenticated; it does not persist a connection ID, credential, audio, or guessed target.

## Talk Relay Extension

- Continuous Jarvis Talk is available only when the selected, authenticated Gateway returns a `talk.catalog` payload with `speech.ready: true` and a configured provider that explicitly supports `realtime`, `gateway-relay`, `agent-consult`, PCM16 input, and barge-in.
- JunQi creates only `talk.session.create({ mode: 'realtime', transport: 'gateway-relay', brain: 'agent-consult' })` sessions. It does not use browser-owned WebRTC or provider WebSocket paths for the desktop host.
- Audio is sent only as native PCM16 chunks. A complete WAV capture must not be submitted to `talk.session.appendAudio`.
- Gateway `talk.event` envelopes are validated and ordered per Talk session. Repeated or stale sequence numbers cannot update a newer voice turn.
- A user speech interruption must first stop local output and then request `talk.session.cancelOutput` on the same attested connection. Connection changes close the local Talk owner and discard later events.

## Non-Goals

- Bundling model assets, generating keyword token files, automatic model download, or claiming a default JunQi pronunciation.
- Sending audio, text, or state to a second agent runtime. The existing confirmation and OpenClaw attachment transaction remain authoritative.
- Claiming verified microphone permissions, autostart registration, tray persistence, or package behavior on Windows, CentOS, or Ubuntu without target-platform evidence.

## Acceptance

- Missing or empty model assets keep wake-word mode unavailable.
- A selected model directory is persisted in JunQi application data and must pass both asset validation and Sherpa detector creation before it is reported available.
- A wake listener cannot be activated by VAD alone.
- Existing dictation, session ownership, draft confirmation, and Gateway connection fences remain in force.
- A Gateway without the explicit realtime relay capability remains in the current confirmation-required voice-draft path; it is never presented as continuous Talk.
- A Talk session remains explicitly bound to its selected session key because the installed `talk.session.create` contract does not accept `voiceWakeTrigger`.
