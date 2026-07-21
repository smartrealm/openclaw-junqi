# Voice Runtime Audit Fix Plan

Status: complete through Phase J; final validation recorded in the audit and specification.

## Execution order

### Phase A - Concurrency and ownership

| Bug | File | Fix |
|---|---|---|
| BUG-01 | `src-tauri/src/commands/voice_wake.rs` | Add worker IDs, deterministic joins, and generation-aware cleanup. |
| BUG-02 | `src/hooks/useVoiceWake.ts` | Guard recognizer ownership, use latest callback/session refs, and serialize native captures. |
| BUG-03 | `src/pages/QuickChatRoot.tsx`, `src/pages/QuickChatPage.tsx` | Establish and enforce one owned quick-chat session. |
| BUG-04 | `src/services/voice/VoiceRuntime.ts` | Rebase surviving queue items after scoped cancellation. |

### Phase B - Streaming correctness

| Bug | File | Fix |
|---|---|---|
| BUG-05 | `src/services/voice/sentenceSplitter.ts`, `src/services/voice/VoiceRuntime.ts` | Defer terminal periods and split cumulative sanitized speech. |

### Phase C - Playback and barge-in

| Bug | File | Fix |
|---|---|---|
| BUG-06 | `src/services/voice/VoiceRuntime.ts`, `src/components/Chat/AudioPlayer.tsx`, `src/components/Chat/MessageBubble.tsx` | Coordinate one claimed external media playback and report its state. |
| BUG-07 | `src/components/Chat/MessageInput.tsx`, `src/pages/QuickChatPage.tsx` | Interrupt voice on Escape and before new direct sends. |

### Phase D - Capture and persistence fallbacks

| Bug | File | Fix |
|---|---|---|
| BUG-08 | `src/api/tauri-adapter.ts` | Replace Explorer side effect with `mkdir`; chunk base64 encoding. |
| BUG-09 | `src/components/Chat/VoiceRecorder.tsx`, `src/types/global.d.ts`, `src-tauri/src/commands/voice.rs` | Add native UI fallback and deterministic worker finalization. |
| BUG-10 | `src-tauri/src/commands/voice_wake.rs` | Add pre-roll and `U16` normalization. |

### Phase E - Follow-up lifecycle audit

| Bug | File | Fix |
|---|---|---|
| BUG-11 | `src/services/voice/VoiceRuntime.ts`, `src/components/Chat/AudioPlayer.tsx` | Preserve other sessions' pending media and scope interrupt ownership. |
| BUG-12 | `src-tauri/src/commands/voice_wake.rs` | Handshake worker startup and suppress stale command-stop events. |
| BUG-13 | `src/components/Chat/VoiceRecorder.tsx` | Cancel stale async starts and finalize browser capture before cleanup. |
| BUG-14 | `src/hooks/useVoiceWake.ts` | Bind native WAV queue entries to their capture session. |
| BUG-15 | `src-tauri/src/commands/voice.rs` | Serialize concurrent native recorder replacement and slot installation. |
| BUG-16 | `src/hooks/useVoiceWake.ts` | Suppress native VAD feedback while owned voice output is active. |
| BUG-17 | `src/App.tsx`, `src/pages/QuickChatRoot.tsx`, `src/services/voice/VoiceRuntime.ts` | Use message-segment identity and flush tails across tool boundaries. |

### Phase F - Regression and validation

1. Add one named regression contract per BUG ID.
2. Run focused TypeScript and Rust tests.
3. Run syntax/type, interface, cleanup grep, full behavior tests, build, and diff checks.

### Phase G - Cross-window compatibility follow-up

| Bug | File | Fix |
|---|---|---|
| BUG-18 | `src/services/voice/VoiceRuntime.ts`, `src/services/voice/types.ts`, `src/stores/settingsStore.ts` | Coordinate output claims/stops over Tauri events and synchronize voice settings across WebViews. |
| BUG-19 | `src/stores/settingsStore.ts`, `src/pages/SettingsPage.tsx`, `src/services/voice/VoiceRuntime.ts` | Split synthetic TTS from legacy live-media auto-play. |
| BUG-20 | `src/pages/QuickChatRoot.tsx`, `src/pages/QuickChatPage.tsx` | Share an explicit owner key without calling the persisted active-tab API. |

### Phase H - Transport, retention, and presentation

| Bug | File | Fix |
|---|---|---|
| BUG-21 | `src/components/Chat/MessageInput.tsx`, `src/api/tauri-adapter.ts` | Send portable audio attachments and implement session voice cleanup. |
| BUG-22 | `src/dynamic-island/DynamicIsland.tsx`, `src/pet/pet-states.ts` | Restore business attention/tool priority above passive playback. |

### Phase I - Compatibility regression and full validation

1. Add one regression contract for each of BUG-18 through BUG-22.
2. Re-run focused voice, Quick Chat, settings, dynamic-island, and pet tests.
3. Re-run full frontend/scripts/Rust suites, lint, build, formatting, and diff checks.

### Phase J - Residual ownership and retention hardening

| Bug | File | Fix |
|---|---|---|
| BUG-23 | `src/services/voice/VoiceRuntime.ts`, `src/stores/voiceStore.ts`, `src/hooks/useVoiceWake.ts`, status/control consumers | Propagate ordered remote ownership and release state into capture suppression, user controls, Dynamic Island, and pet state. |
| BUG-24 | `src/api/tauri-adapter.ts` | Replace lossy session-directory sanitization with injective, prefix-safe path encoding. |

1. Test out-of-order claim/release/stop delivery.
2. Test local runtime cleanup emits release without a global stop.
3. Test collision and ancestor safety for encoded session directories.
