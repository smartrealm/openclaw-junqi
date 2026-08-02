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
10. Restored and unminimized the main window on a verified wake result before the existing full-window Jarvis surface appears; focus denial remains non-fatal because desktop focus policy is platform-owned.
11. Parsed the selected Sherpa model's official keyword labels and blocked arming unless at least one label matches a Gateway-owned trigger; arbitrary text is never written into `keywords.txt`.
12. Added an explicit mismatch recovery action that synchronizes only declared local model labels through `voicewake.set`, preserves Gateway routing, and retries the fenced arm sequence.
13. Marked the official-model detector regression as explicitly fixture-gated so ordinary test output cannot imply a real keyword detection occurred without the upstream model and WAV asset.
14. Ran the fixture-gated official bilingual model test against its upstream `zh_3.wav` on the local macOS build; target-platform microphone and Gateway validation remain separate work.
15. Rejected wake keywords now suppress both WAV fallback and any in-flight PCM frames before the Talk relay queue, closing the native stop-request race.
16. Bound model keyword labels to OpenClaw's installed 64 UTF-16-code-unit trigger limit before a model may be selected or synchronized.
17. Gate wake acceptance on the documented `sessions.patch.category` confirmation, retaining only bounded current-turn audio until the Jarvis group assignment is durable.
18. Delay WAV fallback until an in-flight Talk relay reports ready or unavailable, preventing duplicate Talk and attachment delivery; retain a complete bounded VAD turn across the category and relay setup boundaries.
19. Preserve an already verified wake-word listener when a close request arrives before workbench persistence is ready, without relaxing the normal checkpoint and PTY shutdown path.
20. Expose the selected model's declared wake labels in the full-window Jarvis surface, saving only a non-empty model-backed subset through the fenced Gateway trigger contract.
21. Preserve a verified KWS phrase as the barge-in signal during assistant output, while retaining VAD/browser feedback suppression; cancel old Gateway Talk output after local stop and before closing its replaced relay session.
22. Serialize Gateway Talk PCM deltas at the Tauri boundary, wait for the native sink to drain after `output.audio.done`, and make cancellation fence queued frames before stopping the sink.
23. Move Jarvis model and wake-phrase configuration to an independent Settings tab; retain the composer as a session-scoped shortcut only.
24. Make the Dynamic Island close control invoke its native hide command before synchronizing the main-window display preference.

## Current Remediation (Completed)

1. Audit the complete Jarvis capture, Talk, session category, closing, tray, login-start, Tauri IPC, installed OpenClaw, and installed autostart dependency chains before changing code.
2. Keep Gateway autostart separate from JunQi voice residency and preserve the selected OpenClaw runtime.
3. Patch only the application-scoped `auto-launch 0.5.0` dependency for Windows command-line quoting and Linux Desktop Entry `Exec` serialization, with portable behavior tests.
4. Re-ran the local dependency tests, TypeScript, Rust, full frontend, build, and diff validation; target-platform sign-in remains required.

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
