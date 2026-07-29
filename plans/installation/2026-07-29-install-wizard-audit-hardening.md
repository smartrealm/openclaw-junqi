# Installation and Wizard Audit Hardening Plan

Date: 2026-07-29

## Execution order

### Phase A - Process and state safety

1. **BUG-IW-01**: generalize the operation-scoped Rust coordinator and frontend
   wrapper; wire OpenClaw npm and Docker pull into confirmed process-tree
   cancellation.
2. **BUG-IW-03**: make cached Docker validation inspect the selected durable
   runtime contract and add behavioral tests for missing CLI/image/daemon states.

### Phase B - Secret and irreversible Wizard boundaries

3. **BUG-IW-02**: remove Wizard answer history, simulated Back, and replay-based
   retry; retain pause/resume and fresh-session recovery only.
4. **BUG-IW-04**: narrow Wizard types/normalization/UI/tests to the installed
   OpenClaw 2026.7.1 schema and remove unreachable code.

### Phase C - Ownership and maintainability

5. **BUG-IW-05**: extract the shared setup operation coordinator and focused
   installation orchestration from `useSetupFlow/index.ts`, preserving the hook
   facade and existing navigation contracts.

### Phase D - Validation

6. Run focused tests that fail against each original behavior.
7. Run `pnpm lint`, `pnpm test`, `pnpm test:rust`, `pnpm build`,
   `pnpm verify:openclaw-docs`, `cargo fmt -- --check`, `cargo check --lib`,
   `cargo test --lib`, and `git diff --check`.
8. Record any target-platform checks that were not physically exercised.

### Phase E - Release

9. Synchronize `main`, `daxia`, and `Blues-Code/wei-dev` to the verified commit.
10. Increment the patch version consistently in `package.json`,
    `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`; update the lockfile.
11. Inspect the immutable release workflow and tag convention, create the next
    patch tag, push branches and tag to GitHub, and verify that the Release
    workflow was triggered.

## Progress

- [x] Phase A: shared cancellable setup operation and Docker cache validation.
- [x] Phase B: opaque Wizard session semantics and exact installed schema.
- [x] Phase C: focused setup operation/progress/environment modules.
- [x] Phase D: local lint, frontend/script tests, Rust tests, production build,
      OpenClaw documentation links, collaboration tests/package contract, Rust
      formatting/check, and whitespace validation.
- [ ] Phase E: version and local arm64 macOS preview package are complete;
      branch synchronization, tag, push, and Release workflow verification
      remain.

Three environment-mutating Rust tests are intentionally ignored by the
repository. Physical Windows checks and formal macOS signing/notarization are
not part of the local automated result and remain explicitly unverified. The
local Tauri build generated the app and DMG but correctly failed updater signing
because no private updater key was available.
