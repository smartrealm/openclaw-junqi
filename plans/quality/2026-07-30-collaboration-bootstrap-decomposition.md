# Collaboration Bootstrap Decomposition Plan

Date: 2026-07-30
Status: in progress
Spec: `specs/quality/2026-07-30-collaboration-bootstrap-decomposition.md`

## Execution order

1. [x] Extract serialized request/response contracts and add exact JSON-shape
   regressions. Keep parent-module re-exports and all command signatures.
2. [ ] Extract target classification and durable identity validation.
3. [ ] Extract agent registry/policy parsing and OpenClaw config readback.
4. [ ] Extract bounded process execution and plugin inspection.
5. [ ] Extract bundled package attestation and descriptor-safe artifact storage.
6. [ ] Extract config snapshot and exact plugin backup/restore ownership.
7. [ ] Extract journal archive/abandon and recovery orchestration helpers.
8. [ ] Reduce the parent file to command orchestration, then run complete Rust,
   collaboration, frontend boundary and production-build validation.

## Per-batch gate

- Preserve the dirty worktree and move only one coherent dependency slice.
- Run the narrowest existing tests plus `cargo fmt -- --check` and
  `cargo check --lib`.
- Inspect command registration, Rust signatures and serialized field casing.
- Stop if an extraction requires widening a secret-bearing type or weakening a
  filesystem/runtime authority check.
