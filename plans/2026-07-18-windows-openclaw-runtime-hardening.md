# Windows OpenClaw Runtime Hardening Plan

## Execution order

### Phase A - Ownership and migration correctness

| Bug | Files | Fix |
| --- | --- | --- |
| BUG-WIN-05 | `gateway_service.rs`, `gateway.rs` | Centralize state/config service identity and guard restart. |
| BUG-WIN-06 | `storage.rs` | Separate installed deployment from prior running state and rewrite service metadata transactionally. |
| BUG-WIN-07 | `StorageSetupGate.tsx`, `storage.rs` | Use configured source for path mapping and capability checks. |

### Phase B - Runtime path and mode transitions

| Bug | Files | Fix |
| --- | --- | --- |
| BUG-WIN-08 | `docker.rs`, `storage.rs`, `paths.rs` | Separate host and container workspace paths. |
| BUG-WIN-10 | `useSetupFlow.ts`, `openclawWizard.ts`, lifecycle commands | Make mode and wizard handoff single-owner transitions. |

### Phase C - Installation and platform lifecycle

| Bug | Files | Fix |
| --- | --- | --- |
| BUG-WIN-09 | `setup.rs`, `npm_registry.rs`, `system.rs` | Add bounded process supervision and full install verification. |
| BUG-WIN-11 | NSIS hooks, terminal integration, release workflow | Clean owned Windows state and fail closed on unsigned tag releases. |

### Phase D - Validation

1. Rust unit and behavior tests for service identity, migration state, path mapping, and install verification.
2. Frontend state-machine tests for forced recovery, mode switching, progress completion, and wizard recovery.
3. Script tests for signing/version gates and NSIS hook presence.
4. Full Rust, frontend, script, build, and clean-worktree validation.
