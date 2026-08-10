# Gateway lifecycle coordinator

## Current

Ordinary Gateway process lifecycle requests use the singleton in `src/runtime/gatewayLifecycle.ts`.
The coordinator owns `reconnect`, `recover`, `restart`, and `stop`. A successful reconnect,
recovery, or restart result now means all of the following are true:

- the selected runtime process operation succeeded;
- restart identity probing still matches the selected runtime;
- a replacement WebSocket completed the official `hello-ok` handshake;
- the replacement connection ID is current;
- Runtime Identity is verified and bound to that same connection ID.

The former `aegis:manual-reconnect` command bridge, DingTalk-only reconnect polling, direct ordinary
manager reconnects, direct UI stop IPC, and log-text progress inference have been removed.

Collaboration bootstrap and OpenClaw package update intentionally use dedicated transactional Rust commands and are not ordinary restart requests.

## Target

All ordinary frontend restart and recovery requests use one non-React `GatewayLifecycleCoordinator`.

The coordinator owns:

- frontend lifecycle single-flight;
- the distinction between `reconnect`, `recover`, explicit `restart`, and `stop`;
- startup-migration lock waiting before destructive restart;
- common progress events and structured results;
- reconnect through `GatewayConnectionManager` after the selected runtime is ready;
- replacement connection and Runtime Identity settlement before success.

Browser events are output notifications only and cannot request a lifecycle mutation.

The following remain dedicated transactional operations:

- `collaboration_bootstrap_restart`, because it is bound to operation, target fingerprint, and connection identity;
- `update_openclaw`, because package replacement owns stop/restore as one transaction.

## Acceptance

- [x] StatusBar, TopBar, Dashboard, Channels Center manual restart, configuration apply, channel binding apply, Ready Screen autostart fallback, and Wizard reclaim no longer call a low-level restart API directly.
- [x] Concurrent ordinary frontend recovery/restart requests share one in-flight operation; a stronger request is queued rather than discarded.
- [x] `recover` first calls `ensureRunning` and restarts only when selected-runtime health is not established.
- [x] Explicit `restart` waits for a reported OpenClaw startup migration lock.
- [x] Reconnect, recover, and restart do not report success before a replacement authenticated and attested connection settles.
- [x] The settings lifecycle panel routes stop through the same coordinator.
- [x] DingTalk refreshes business state only after the common lifecycle result succeeds; it has no private reconnect timeout or poller.
- [x] Progress remains visible through `aegis:gateway-progress`, is terminal on failure/cancellation, and callers do not dispatch lifecycle command events.
- [x] Collaboration bootstrap and OpenClaw update retain their dedicated commands.
- [x] The AST boundary scanner rejects direct ordinary ensure, reconnect, restart, and stop calls outside controlled adapters and official Wizard handoff.
- [x] TypeScript checks, relevant tests, full test/build checks, and `git diff --check` pass.

## Unverified boundary

Automated tests do not replace Windows/macOS validation of service restart, Docker Desktop cold start, transparent-window behavior, or a real restart/reconnect loop.
