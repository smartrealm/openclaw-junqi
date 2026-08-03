# OpenClaw Client Capability And Version Boundary Audit

Date: 2026-08-03

## Scope

Audit JunQi's native OpenClaw installation health chain and the external
`@junqi/openclaw-collaboration` plugin compatibility metadata. The purpose is
to apply the product boundary: JunQi is an OpenClaw desktop client and must not
invent a general OpenClaw version support policy.

## Authoritative Evidence

The official OpenClaw Gateway protocol's `hello-ok` response contains
`features.methods` and `features.events`. The protocol calls this a
conservative feature-discovery list, not a complete method enumeration. JunQi
therefore uses advertised methods, request results, scopes, and strict response
decoding to decide whether a Gateway interaction is available. It must not
replace those runtime facts with a client-maintained version range.

Official sources reviewed at commit
`957bdd177f1ad5616abe34e71fbff5a1525fdb06`:

- [Gateway protocol](https://github.com/openclaw/openclaw/blob/957bdd177f1ad5616abe34e71fbff5a1525fdb06/docs/gateway/protocol.md)
- [Plugin manifest reference](https://github.com/openclaw/openclaw/blob/957bdd177f1ad5616abe34e71fbff5a1525fdb06/docs/plugins/manifest.md)
- [Plugin install compatibility handler](https://github.com/openclaw/openclaw/blob/957bdd177f1ad5616abe34e71fbff5a1525fdb06/src/plugins/install-shared.ts)
- [Plugin package contract](https://github.com/openclaw/openclaw/blob/957bdd177f1ad5616abe34e71fbff5a1525fdb06/packages/plugin-package-contract/src/index.ts)

The plugin manifest reference states that `openclaw.compat.pluginApi` is the
minimum plugin SDK/runtime API range a non-bundled plugin was built against.
The official installer enforces that field during plugin installation. It also
states that `peerDependencies.openclaw` is npm metadata and must not be used as
the package compatibility decision.

## Current Behavior

`src-tauri/src/commands/system.rs` parses the installed package version,
requires it to be at least `2026.7.1`, and reports a separate warning beyond
the arbitrary `2027` ceiling. `OpenclawStatus.version_ok` then contributes to
both `installed` and the Setup repair decision. The corresponding TypeScript
DTO, Setup health classifier, UI check, translations, and regression tests all
encode this policy.

This is a client-created Gateway compatibility gate. It is not an OpenClaw
Gateway protocol feature and can mark a structurally valid, runnable current
OpenClaw installation as needing repair solely from a JunQi-maintained version
range.

The collaboration package is different. It imports public
`openclaw/plugin-sdk/*` modules and is installed as an external code plugin.
Its `openclaw.compat.pluginApi` field is therefore a required OpenClaw package
contract. The local package builds and validates against the installed public
OpenClaw SDK `2026.7.1-2`; that is the evidenced lower API floor for this
source. The current upper bound is not supported by the official manifest
guidance, which specifies a semantic-version floor. This plugin contract is not
a reason to block general desktop Gateway health.

## Target Behavior

Native installation health verifies only JunQi's local launch prerequisites:

1. a discovered binary belongs to a structurally valid OpenClaw package;
2. its package entry passes the selected Node.js smoke check; and
3. it is not a legacy wrapper.

The package version remains informational when returned by package metadata.
It is not a supported/unsupported switch, a repair defect, or a UI warning.
Gateway feature availability remains determined per operation from official
protocol discovery and authoritative method responses.

`junqi-collab` plugin API compatibility remains a separate upstream-enforced
contract. Its peer metadata and `compat.pluginApi` use the evidenced
`>=2026.7.1` SDK API floor without a JunQi-created upper ceiling. Its build
metadata still records the concrete SDK/build input. No desktop health behavior
may derive from that plugin range.

## Platform Boundary

The removed policy is platform-independent. Existing binary discovery,
selected Node.js smoke checks, npm prefix handling, and Windows command-shim
handling remain unchanged. This audit does not claim real-device validation for
Windows, macOS, CentOS, or Ubuntu.

## Verification Plan

- Rust tests prove no hardcoded OpenClaw support-range symbols remain in the
  native installation health implementation.
- TypeScript behavior tests prove a valid binary does not become repairable
  merely because its informational version is absent from an arbitrary client
  range.
- IPC DTO, Setup health classifier, and UI no longer expose a version-support
  state.
- Run focused TypeScript tests, Rust library tests, lint, official-document
  link verification, collaboration package validation, `git diff --check`, and
  the repository emoji scan.

## Verification Result

Passed:

- Focused Setup installation-health tests: 14 passed.
- `pnpm lint`.
- `cargo fmt -- --check`.
- `cargo check --lib`.
- `cargo test --lib`: 697 passed, 4 ignored existing environment-dependent
  tests.
- `pnpm verify:openclaw-docs`: 55 official links and anchors verified.
- `pnpm collab:test`.
- `pnpm collab:validate`.
- `pnpm test`.
- Production `pnpm build` with the verified official CLI explicitly selected
  through `OPENCLAW_BIN=/Users/wei/.npm-global/bin/openclaw`.
- `git diff --check` and the modified-file emoji scan.

The first parallel production-build attempt timed out while the generator used
the workspace plugin dependency's `openclaw.mjs` to obtain the official model
catalog. The generator failed closed and did not use template fallback. The
global official OpenClaw CLI returned both its version and model catalog, and
the explicit single-process build completed without generated-source changes.

The first parallel `pnpm test` process was interrupted after it remained idle
alongside the blocked build. A later single-process `pnpm test` completed with
exit code zero, so the full test command is recorded as passed.

Real-device verification remains pending for native OpenClaw discovery and
entry checks on Windows, macOS, CentOS, and Ubuntu. No claim is made that those
platforms were exercised by this host-only test run.
