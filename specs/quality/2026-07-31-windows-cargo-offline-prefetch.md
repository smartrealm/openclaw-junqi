# Windows Cargo Offline Prefetch Specification

## Current behavior

Windows x86 CI prefetches the declared target graph, then fails during the
offline `cargo check` when Cargo needs an x64-host build dependency that was
not downloaded.

## Target behavior

Before any workflow enables `CARGO_NET_OFFLINE`, the shared Cargo dependency
script prepares the complete dependency graph for the selected target and its
runner host. The subsequent validation and packaging commands remain offline.

## Acceptance

- [x] Target validation runs `cargo fetch --locked --target <target>`.
- [x] The same warm-up runs `cargo check --locked --all-targets --target <target>`
      while network access is available.
- [x] Inherited Cargo offline and frozen flags cannot block the warm-up.
- [x] CI and release workflow build steps retain `CARGO_NET_OFFLINE=true`.
- [x] Unit tests protect the command and retry contract.
- [ ] A pushed workflow run verifies Windows x64-host to x86-target execution.
