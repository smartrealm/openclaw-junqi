# Windows Cargo Offline Prefetch Validation

Date: 2026-07-31

## Evidence

GitHub Actions run `30642388240` failed only in the Windows x86 validation
matrix. Its target-specific `cargo fetch --locked --target i686-pc-windows-msvc`
completed, but the subsequent offline check could not obtain
`windows_x86_64_msvc v0.48.5`.

The Windows x86 job runs on an x64 host. Cargo therefore resolves both the x86
target dependency graph and host-side build dependencies. A target-only fetch
does not guarantee that the latter crate archives are in the local registry.

## Current behavior

`scripts/fetch-cargo-dependencies.mjs` now has one responsibility: establish a
complete online Cargo cache for a declared target before workflows enter their
offline validation or packaging phases.

For every target it performs, with the locked dependency graph:

1. `cargo fetch --target <target>` for the target graph.
2. `cargo check --all-targets --target <target>` to resolve and cache the same
   host and target dependencies that the later offline check uses.

The warm-up explicitly removes inherited `CARGO_NET_OFFLINE` and
`CARGO_NET_FROZEN`. Workflows retain `CARGO_NET_OFFLINE=true` for their actual
check, test, and release build steps.

## Validation

- Script unit tests assert the two-command warm-up and retry contract.
- Windows workflow contract tests assert that validation and release packaging
  remain offline after the warm-up step.
- GitHub Actions still needs a new push to validate this exact change on a
  Windows x64 host building the x86 target.

## Boundary

This change does not weaken the offline build gate or change application
dependencies. It only makes the preceding cache preparation represent the
complete Cargo dependency graph used by that gate.
