# Collaboration Bootstrap Decomposition Spec

Date: 2026-07-30
Status: in progress
Finding: BUG-FCA-14

## Current

`src-tauri/src/commands/collaboration_bootstrap.rs` owns eight Tauri commands and
approximately 7,000 lines of production implementation. Wire DTOs, target
identity validation, agent policy, bounded process execution, package
attestation, descriptor-safe storage, journal archiving, plugin mutation and
rollback are compiled as one module.

## Target boundaries

| Module | Ownership |
| --- | --- |
| `collaboration_bootstrap/contract.rs` | Tauri request/response DTOs and serialized enums only |
| `collaboration_bootstrap/target.rs` | target classification, fingerprint and durable-runtime authority |
| `collaboration_bootstrap/agent_policy.rs` | agent registry parsing, validation and config batch/readback |
| `collaboration_bootstrap/package.rs` | bundled metadata, archive/hash attestation and staging |
| `collaboration_bootstrap/storage.rs` | descriptor-safe directories, bounded files and config snapshots |
| `collaboration_bootstrap/journal.rs` | durable journal validation, archive and evidence retention |
| `collaboration_bootstrap/plugin.rs` | plugin inspection, exact backup, install/enable/uninstall |
| `collaboration_bootstrap/recovery.rs` | rollback source validation and exact restore |
| `collaboration_bootstrap.rs` | eight command orchestrators and private cross-domain composition |

The decomposition is dependency-driven. A module is extracted only when its
inputs/outputs can be expressed without reaching through another domain's
private state.

## Invariants

- The eight `#[tauri::command]` function names and their registration paths in
  `src-tauri/src/lib.rs` do not change.
- Parameter wrappers and `serde(rename_all = ...)` casing do not change.
- Serialized enum values and response field names do not change.
- Native and Docker runtime ownership, fingerprint checks, secret redaction,
  journaling order, atomic restore and exact plugin backup semantics do not
  change.
- No new public API is introduced; extracted helpers remain private to the
  collaboration bootstrap module.

## Acceptance

- [x] Wire DTOs live in `contract.rs`, are re-exported by the parent module and
      are guarded by serialization tests.
- [ ] At least the target, agent-policy, package/storage, journal/plugin and
      recovery domains are represented by private modules with documented APIs.
- [ ] `collaboration_bootstrap.rs` is primarily command orchestration rather
      than ownership of every implementation detail.
- [ ] Existing Rust and collaboration tests pass after every extraction batch.
- [ ] `cargo fmt -- --check`, `cargo check --lib`, `pnpm test:rust`,
      `pnpm collab:test`, `pnpm collab:validate` and `git diff --check` pass.
