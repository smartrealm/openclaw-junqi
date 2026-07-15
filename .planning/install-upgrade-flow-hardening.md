# Install and Upgrade Flow Hardening Plan

## Phase A - State correctness

| Bug | File | Fix |
| --- | --- | --- |
| IU-01 | `src/hooks/useSetupFlow.ts`, `src/pages/SetupPage.tsx` | Centralize storage completion and require onboarding for fresh storage |
| IU-03 | `src-tauri/src/commands/storage.rs`, `StorageSetupGate.tsx` | Return and consume authoritative `createdFresh` |

## Phase B - Gateway ownership

| Bug | File | Fix |
| --- | --- | --- |
| IU-02 | `src-tauri/src/commands/openclaw_update.rs` | Disable updater-owned restart and retain JunQi restoration |
| IU-04 | `src-tauri/src/commands/storage.rs` | Restore unknown/external runtimes as managed children |

## Phase C - Progress integrity

| Bug | File | Fix |
| --- | --- | --- |
| IU-05 | `src/hooks/useSetupFlow.ts`, `setupProgressModel.ts` | Preserve monotonic overall progress after storage selection |

## Phase D - Validation

1. Add one regression contract per Bug ID.
2. Run frontend tests, TypeScript/boundary checks, Rust format/clippy/tests, and production build.
3. Merge the verified main commit into `daxia` and run its branch checks.
