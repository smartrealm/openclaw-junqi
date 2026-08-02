# Cross-Platform Voice Wake Host Plan

## Completed

1. Audited the current VAD-only implementation, OpenClaw routing boundary, window close checkpoint, and official Sherpa/Tauri contracts.
2. Added the Sherpa-ONNX detector adapter and model-directory completeness gate.
3. Split native capture into dictation VAD and wake-word KWS paths.
4. Added the voice workspace model selector, explicit session-scoped login restore, and close-to-tray behavior while armed.
5. Renewed automatic arming after each completed draft, added bounded retry after native listener errors, moved voice-workspace IPC ownership to the composer hook, and made model settings writes atomic.
6. Replaced the Wake mode composer-only presentation with a full-window control surface while preserving the existing pet and Dynamic Island projections.
7. Added a fenced OpenClaw Talk catalog/session client and a validated, per-session ordered `talk.event` bridge for the `realtime/gateway-relay/agent-consult` contract.
8. Preserved the native detector's recognized keyword and persistently categorized the selected OpenClaw session as `Jarvis: <keyword>` through the documented `sessions.patch.category` contract; no channel-style group session key is invented.
9. Gated wake-listener startup and each keyword acceptance on the Gateway-owned trigger/routing snapshot, including live change events; cross-session Talk routing fails closed until the installed Talk contract can represent the trigger.

## In Progress

1. Completed: native capture emits bounded PCM16/24000Hz/mono chunks after a verified trigger; WAV remains only for the confirmation-required fallback path.
2. Completed: the Talk session owner is bound to the authenticated Gateway connection and selected OpenClaw session, with close/cancel behavior on route, runtime, or connection change.
3. Completed in the main window: the full-window surface reflects Talk connecting and speaking phases; pet/Dynamic Island remain derived projections.

## Validation

1. Run Rust format, library check, targeted voice-wake tests, TypeScript check, and diff checks.
2. Run the recursively discovered frontend test suite so moved voice-runtime regressions cannot be skipped.
3. Record target-platform validation separately for macOS, Windows, CentOS, and Ubuntu with actual microphone permission and login-start evidence.

## Follow-Up Evidence Required

- Audit the exact model archive checksum and license before shipping a downloader or bundle.
- Produce approved `keywords.txt` files for supported wake phrases using the upstream tokenization process.
- Measure false accepts, false rejects, idle CPU, memory, and battery impact on each supported platform.
- Run a real configured Gateway relay session on macOS, Windows, CentOS, and Ubuntu before declaring continuous Talk available on those targets.
