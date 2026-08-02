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
- The window hides after the existing checkpoint only while the real wake-word listener is armed. Tray Quit remains an explicit exit.
- The login-start choice starts JunQi on macOS, Windows, and Linux with the main window hidden. It restores only the explicitly saved session key after its Gateway connection is authenticated; it does not persist a connection ID, credential, audio, or guessed target.

## Non-Goals

- Bundling model assets, generating keyword token files, automatic model download, or claiming a default JunQi pronunciation.
- Sending audio, text, or state to a second agent runtime. The existing confirmation and OpenClaw attachment transaction remain authoritative.
- Claiming verified microphone permissions, autostart registration, tray persistence, or package behavior on Windows, CentOS, or Ubuntu without target-platform evidence.

## Acceptance

- Missing or empty model assets keep wake-word mode unavailable.
- A selected model directory is persisted in JunQi application data and must pass both asset validation and Sherpa detector creation before it is reported available.
- A wake listener cannot be activated by VAD alone.
- Existing dictation, session ownership, draft confirmation, and Gateway connection fences remain in force.
