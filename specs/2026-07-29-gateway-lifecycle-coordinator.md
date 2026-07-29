# Gateway lifecycle coordinator

## Current

Ordinary Gateway lifecycle requests are initiated through four different frontend contracts:

- `aegis:manual-reconnect` browser commands handled by `App.tsx`;
- direct `gatewayManager.restart()` calls;
- direct `window.aegis.config.restart()` calls;
- direct `restart_local_gateway` IPC calls.

The Rust `operation_gate` prevents competing process mutations, but frontend callers do not share one recovery policy, migration-lock wait, progress contract, result shape, or reconnect behavior.

Collaboration bootstrap and OpenClaw package update intentionally use dedicated transactional Rust commands and are not ordinary restart requests.

## Target

All ordinary frontend restart and recovery requests use one non-React `GatewayLifecycleCoordinator`.

The coordinator owns:

- frontend lifecycle single-flight;
- the distinction between `reconnect`, `recover`, and explicit `restart`;
- startup-migration lock waiting before destructive restart;
- common progress events and structured results;
- reconnect through `GatewayConnectionManager` after the selected runtime is ready.

Browser events remain output notifications only. A temporary compatibility listener may translate the existing `aegis:manual-reconnect` command into a coordinator call while remaining consumers are migrated.

The following remain dedicated transactional operations:

- `collaboration_bootstrap_restart`, because it is bound to operation, target fingerprint, and connection identity;
- `update_openclaw`, because package replacement owns stop/restore as one transaction.

## Acceptance

- [x] StatusBar, TopBar, Dashboard, Channels Center manual restart, configuration apply, channel binding apply, Ready Screen autostart fallback, and Wizard reclaim no longer call a low-level restart API directly.
- [x] Concurrent ordinary frontend recovery/restart requests share one in-flight operation; a stronger request is queued rather than discarded.
- [x] `recover` first calls `ensureRunning` and restarts only when selected-runtime health is not established.
- [x] Explicit `restart` waits for a reported OpenClaw startup migration lock.
- [x] Progress remains visible through `aegis:gateway-progress`, is terminal on failure/cancellation, and callers do not dispatch lifecycle command events.
- [x] Collaboration bootstrap and OpenClaw update retain their dedicated commands.
- [x] Boundary regression tests reject new direct ordinary restart calls from pages/components/hooks.
- [x] TypeScript checks, relevant tests, full test/build checks, and `git diff --check` pass.

## Unverified boundary

Automated tests do not replace Windows/macOS validation of service restart, Docker Desktop cold start, transparent-window behavior, or a real restart/reconnect loop.
