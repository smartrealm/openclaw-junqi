# Cross-Platform Voice Wake Host Plan

## Completed

1. Audited the current VAD-only implementation, OpenClaw routing boundary, window close checkpoint, and official Sherpa/Tauri contracts.
2. Added the Sherpa-ONNX detector adapter and model-directory completeness gate.
3. Split native capture into dictation VAD and wake-word KWS paths.
4. Added the voice workspace model selector, explicit session-scoped login restore, and close-to-tray behavior while armed.
5. Renewed automatic arming after each completed draft, added bounded retry after native listener errors, moved voice-workspace IPC ownership to the composer hook, and made model settings writes atomic.

## Validation

1. Run Rust format, library check, targeted voice-wake tests, TypeScript check, and diff checks.
2. Run the recursively discovered frontend test suite so moved voice-runtime regressions cannot be skipped.
3. Record target-platform validation separately for macOS, Windows, CentOS, and Ubuntu with actual microphone permission and login-start evidence.

## Follow-Up Evidence Required

- Audit the exact model archive checksum and license before shipping a downloader or bundle.
- Produce approved `keywords.txt` files for supported wake phrases using the upstream tokenization process.
- Measure false accepts, false rejects, idle CPU, memory, and battery impact on each supported platform.
