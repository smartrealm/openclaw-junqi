# Gateway Self-Rescue Hardening Plan

## Execution order

1. **BUG-SR01 / BUG-SR02**: add cancellation-safe frontend state and one backend lifecycle gate.
2. **BUG-SR03 / BUG-SR06**: extract one official repair runner and one cross-platform process-tree terminator; route setup, rescue, and maintenance through them.
3. **BUG-SR04**: sanitize streamed diagnostics and retain only a bounded tail.
4. **BUG-SR05**: expose a Gateway-only direct retry that preserves installation logs.
5. **BUG-SR07**: return a structured recovery recommendation and use it to select the primary action.
6. Add behavioral and source-contract regressions, then run frontend, Rust, Windows CI, and release builds.
