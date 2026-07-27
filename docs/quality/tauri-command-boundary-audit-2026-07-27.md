# Tauri Command Boundary Audit

Reviewed on 2026-07-27 against:

- Tauri v2 official command documentation:
  <https://v2.tauri.app/develop/calling-rust/>
- Installed `@tauri-apps/api` `invoke<T>` declaration in
  `node_modules/@tauri-apps/api/core.d.ts`.
- Registered commands in `src-tauri/src/lib.rs` and the Rust result types in
  `commands/gateway.rs`, `commands/ensure.rs`, and
  `state/gateway_process.rs`.

## Findings

### BUG-IPC-01 - Renderer types drift from Rust responses

`startGateway` used `invoke<any>` although Rust returns `GatewayStatus`.
Renderer log types allowed `trace` and `debug`, while Rust serializes only
`info`, `warn`, and `error`. These widened contracts hide backend/frontend
drift from TypeScript.

**Resolution:** use `GatewayStatus` at the command boundary and mirror the Rust
log enum exactly.

### BUG-IPC-02 - Duplicate raw command invocation bypasses the facade

The adapter, Gateway log panel, and Wizard handoff invoked command strings
already wrapped by `src/api/tauri-commands.ts`. That duplicated argument and
result contracts and allowed the stale types above to survive.

**Resolution:** route those shared commands through the typed facade. Raw
`invoke` remains valid for commands that do not yet have a shared wrapper or
for deliberately injected resolver ports.

### BUG-IPC-03 - Ensure documentation claims behavior Rust forbids

Renderer comments described Native-to-Docker fallback and a 60-second debounce.
Rust persists the user's runtime choice, never silently switches it, and uses
only a concurrency gate so recovery can be retried immediately.

**Resolution:** document selected-runtime-only behavior in TypeScript, global
types, and Rust compatibility-field comments. `attempted_fallback` remains on
the wire for compatibility but is currently always false.

## Branch Audit

After `git fetch --all --prune --tags`, current `main` contains every commit on
the remote branches and all local branches except `fix/setup-stage-alignment`.
Its sole unique commit, `0fd2b30`, was manually integrated because current
`main` also has overlapping setup and locale changes.

The `capricorn` worktree has 17 modified/untracked files and an active Claude
daemon. Its uncommitted Gateway-log localization and post-install owner handoff
work is recorded as WIP, not imported or represented as a stable branch head.
Older stashes and branches are ancestors of `main` and were not reapplied.

## Validation Contract

- Contract tests compare TypeScript wrappers with Rust return types and enums.
- Consumers with an existing wrapper cannot invoke the same raw command string.
- Setup cancellation and missing-prerequisite routes retain regression tests.
- TypeScript, module boundaries, frontend/scripts, and Rust suites must pass.

## Validation Results

- Focused IPC/setup suite: 87 passed.
- Full frontend and script suite: passed.
- TypeScript and module boundaries: passed.
- Rust library suite: 622 passed, 3 environment-dependent tests ignored.
- Locale JSON parsing and `git diff --check`: passed.
- macOS ARM64 DMG built from the final worktree and launched from the mounted
  image. A composited screen-region capture confirmed the main onboarding UI
  rendered; direct Window-ID capture omits WKWebView layers on this host and is
  therefore not accepted as the visual oracle.
- The local build has no Apple distribution signing identity/notarization and
  is a development smoke artifact, not a promotable release.
