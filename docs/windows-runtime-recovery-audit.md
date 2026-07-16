# Windows Runtime and Recovery Audit

Date: 2026-07-16

Scope: completed setup, dynamic install-location resolution, native/Docker
Gateway start and restart, official repair, maintenance diagnostics, and AI
rescue. This review deliberately treats the persisted storage bootstrap and
the detected OpenClaw binary as authoritative rather than assuming a user
directory or package-manager layout.

## Critical findings

### BUG-WSR-01 - Official repair can relaunch OpenClaw with an incompatible Node.js

**Locations**: `src-tauri/src/commands/openclaw_repair.rs`,
`src-tauri/src/commands/gateway.rs`, `src-tauri/src/commands/system.rs`

Gateway startup calls `ensure_compatible_node_runtime` before it creates a
native OpenClaw command. The official repair path resolves the binary and
creates a command directly. On Windows, an npm `.cmd` shim is converted to
`node <resolved package entry>`, but the node executable is re-resolved from
PATH rather than from the compatibility result. A Node.js version mismatch can
therefore cause the repair intended to fix the broken Gateway to fail with the
same runtime error.

**Fix**: resolve an exact native command context from the selected binary,
installed OpenClaw package requirement, and compatible Node executable. All
native lifecycle operations must pass that exact Node path to the command
builder. Mutating flows may ensure/install a compatible Node; read-only flows
must fail with an actionable compatibility error instead of invoking an
arbitrary PATH Node.

### BUG-WSR-02 - Windows managed-Gateway cleanup does not terminate child trees

**Locations**: `src-tauri/src/commands/gateway_supervisor.rs`,
`src-tauri/src/commands/process_control.rs`, `src-tauri/src/commands/gateway.rs`

The repair timeout path uses `taskkill /T /F` through `terminate_process_tree`.
Gateway start, restart, stop, Docker switching, and startup timeout instead
use `Child::kill()` through `terminate_owned_gateway`. On Windows that does not
guarantee termination of descendants created by the Node/OpenClaw process.
Those descendants can retain a port or migration lock after the parent is gone.

**Fix**: make the owned-Gateway supervisor reuse the tree-aware termination
primitive on Windows while retaining ownership boundaries: only the stored
desktop child PID may be terminated.

### BUG-WSR-03 - Runtime recovery ignores the official migration-lock expiry

**Locations**: `src/services/gateway/openclawRepair.ts`, `src/App.tsx`,
`src/hooks/useSetupFlow.ts`

The parser for OpenClaw's `startup migrations are already running ... after
<timestamp>` response exists and setup honors it. Boot recovery and the
post-install UI do not use the parsed delay; they immediately invoke ensure and
then restart, which can create repeated competing launches during the lock
window.

**Fix**: centralize the recovery decision and use the bounded, parsed retry
delay for every runtime recovery entry point. The user must see the planned
retry time and retain a non-destructive manual retry route.

### BUG-WSR-04 - Repair progress has no terminal contract and can leave recovery controls disabled

**Locations**: `src-tauri/src/commands/setup_progress.rs`,
`src-tauri/src/commands/openclaw_repair.rs`, `src/hooks/useSetupProgress.ts`,
`src/components/OfflineOverlay.tsx`, `src/components/GatewaySelfRescuePanel.tsx`

Repair emits ordinary `setup-progress` events on start and success but no
completed status, and returns errors without an error event. The frontend
recognizes only explicit terminal statuses. After a failed repair it can retain
an indeterminate gateway progress record, classify the recovery as busy, and
disable the retry controls while hiding the underlying error.

**Fix**: make progress terminal states explicit and typed; emit a failed event
on every repair failure and a completed event on success. The self-rescue panel
must retain and display the error while becoming retryable.

### BUG-WSR-05 - AI rescue can send raw Gateway logs despite its no-key claim

**Locations**: `src-tauri/src/commands/gateway.rs`,
`src-tauri/src/commands/docker.rs`, `src/services/gatewayRescue.ts`,
`src-tauri/src/commands/gateway_rescue.rs`

Gateway and Docker log readers store raw child output. The UI passes that log
buffer to the direct-provider rescue command, which embeds it in the external
model prompt. The existing sanitizer is used for repair and selected CLI
output, but not for normal Gateway/Docker ingress or the outbound rescue
boundary. The UI statement that API keys are not sent is therefore not
guaranteed.

**Fix**: redact and bound external diagnostic context in Rust immediately
before the provider request, including both error text and every log line. Keep
the direct-provider API key out of all diagnostics. Add a second defense at
log ingress for known credential patterns.

## High findings

### BUG-WSR-06 - Dynamic npm-prefix discovery stops at the first unrelated `.npmrc` setting

**Location**: `src-tauri/src/paths.rs`

`user_npm_prefix` uses `?` while iterating `.npmrc`; the first non-comment line
that is not `prefix=...` exits the function. A common `registry=...` entry
before `prefix=...` makes later detection and search paths miss the actual user
prefix.

**Fix**: continue scanning unrelated lines and accept only a validated,
absolute prefix. The login-shell `npm config get prefix` remains first choice.

### BUG-WSR-07 - Reinstall only recognizes one Windows npm shim layout

**Location**: `src-tauri/src/commands/setup.rs`

The installer verifies both `<prefix>/openclaw.cmd` and
`<prefix>/node_modules/.bin/openclaw.cmd`, but reinstall derives the prefix
only from the first layout. A detected `.bin` shim is rejected even when it
points to a valid npm-owned OpenClaw package.

**Fix**: dynamically walk from the detected shim to a verified
`node_modules/openclaw/package.json` and derive the npm prefix from that
package root. Never synthesize a replacement destination when ownership cannot
be proven.

## Existing strengths retained

- Storage locations are persisted outside the movable OpenClaw state root.
- Native/Docker runtime selection is explicit and survives restart.
- Setup already checks Node compatibility dynamically from OpenClaw package
  metadata and uses transactional Windows package promotion.
- Docker repair is kept inside the selected Docker runtime rather than silently
  switching to native OpenClaw.
