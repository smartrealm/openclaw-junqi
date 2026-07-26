# OpenClaw Gateway Service Ownership Audit

Date: 2026-07-24

Scope: native package installation, setup bootstrap, official Wizard handoff,
autostart enable/disable, normal start/restart/stop, cold recovery, storage
migration, package update handoff, application exit, and uninstall cleanup.

## Installation-flow trace

1. npm/OpenClaw package installation installs the CLI only; it does not register
   a Scheduled Task or launchd service.
2. Wizard completion may call the serialized official handoff, which verifies
   runtime, state directory, config path, service identity, port release, and
   authenticated readiness before committing SystemService ownership.
3. The Ready-screen autostart switch installs the official service. Enabling
   now completes the same rollback-aware handoff; disabling uninstalls the
   selected service before restarting a managed child.
4. On every later Native cold start, an authenticated selected endpoint is the
   fast path. When offline, installed-service inspection is authoritative:
   selected service means start/rebind it, confirmed absence means managed
   child, and inspection/ownership ambiguity means stop with an error.

## Critical findings

### BUG-GSO-01 - Startup treats an inconclusive service inspection as permission to spawn

**Locations:** `src-tauri/src/commands/gateway_service.rs`,
`src-tauri/src/commands/gateway.rs`

The foreground start path gives `openclaw gateway status --json --no-probe`
five seconds. On the reported Windows host the command takes 12.3 seconds. A
cleaned-up timeout becomes `service_inspection = None`, after which startup can
spawn a managed child. The timeout proves neither that the service is absent
nor that a registered task is safe to ignore.

**Impact:** a registered Scheduled Task and a JunQi child can become competing
lifecycle owners; every affected start also pays a useless five-second delay.

**Fix:** probe an already healthy authenticated endpoint first. If the endpoint
is offline, run the full bounded authoritative inspection. Inspection failure
is fail-closed and cannot authorize a managed child.

### BUG-GSO-02 - An installed selected service is not the normal start target

**Location:** `src-tauri/src/commands/gateway.rs`

Even when inspection succeeds, a selected service that is installed but
stopped is not started. A stale-runtime service is not rebuilt either. The code
optionally stops a running selected service and then falls through to
`gateway run`, leaving the registration in place.

**Impact:** enabling autostart does not remain the authoritative owner across
an offline/cold start. JunQi can repeatedly create an 85-second foreground cold
start while the official task remains registered.

**Fix:** installation plus verified ownership is the durable selection. Start
or rebuild that service; use a managed child only after authoritative absence.

### BUG-GSO-03 - Restart silently degrades ambiguous or failed services to a child

**Location:** `src-tauri/src/commands/gateway.rs`

`Foreign`, `Unverifiable`, inspection errors, service command failures, command
timeouts, non-zero exits, and readiness failures all reach
`start_managed_gateway_fallback`.

**Impact:** a service JunQi does not own, or a selected service whose final
state is unknown, can remain registered/running while JunQi starts a competing
child on the same port. The returned success hides the ownership failure.

**Fix:** only confirmed `Absent` selects a managed child. Ambiguous identity and
verified-service restart failures remain errors; do not switch owners silently.

### BUG-GSO-04 - Official service readiness budgets reject healthy Windows cold starts

**Locations:** `src-tauri/src/commands/gateway.rs`,
`src-tauri/src/commands/gateway_update_handoff.rs`,
`src-tauri/src/commands/storage.rs`

Managed-child startup allows 120 seconds to first output on Windows and another
90 seconds after output. Official service handoff, restart, update restore, and
storage restore wait only 30 or 45 seconds. The reported healthy cold start
needed about 85 seconds from spawn to ready.

**Impact:** the same OpenClaw process is accepted as a child but declared failed
as a Scheduled Task, causing setup failure, rollback, or an unsafe fallback.

**Fix:** expose one platform-aware maximum readiness contract and use it for
every native service start/restore path.

### BUG-GSO-05 - Update permits a stopped foreign or unverifiable installed service

**Location:** `src-tauri/src/commands/gateway_update_handoff.rs`

The update plan rejects a foreign service only when it reports `running`.
An installed but stopped `Foreign` or `Unverifiable` service becomes
`NoRunningGateway`, allowing replacement of a package tree that the service may
reference later.

**Impact:** JunQi can mutate a runtime belonging to a service whose state and
config it is explicitly forbidden to manage.

**Fix:** any installed service outside the selected ownership contract blocks
package mutation, regardless of its current runtime state.

### BUG-GSO-07 - Successful pending service recovery is overwritten as an error

**Location:** `src-tauri/src/commands/gateway.rs`

The pending service-rebind success branch returns a healthy SystemService while
`StartFailureGuard` is still armed. Its destructor immediately transitions the
lifecycle to Error.

**Impact:** a successful runtime/storage recovery is exposed as a Gateway error
and can trigger another recovery operation against the live service.

**Fix:** disarm the failure guard before every successful service return.

### BUG-GSO-08 - Healthy owned child is reclassified as External

**Location:** `src-tauri/src/commands/gateway.rs`

The authenticated endpoint fast path always records `External`, even when the
live endpoint is backed by `state.child`.

**Impact:** the in-memory owner says External while JunQi still holds a live
child handle. Later owner validation rejects restart/update as inconsistent.

**Fix:** inspect the owner/child pair and preserve ManagedChild, SystemService,
or External as appropriate; return the managed PID when present.

### BUG-GSO-09 - Managed restart reuses the old child instead of restarting it

**Location:** `src-tauri/src/commands/gateway.rs`

After confirming service absence, restart calls the common start path. Its
healthy endpoint fast path returns the existing child unchanged.

**Impact:** a user-visible restart reports success without replacing the
process or reloading configuration.

**Fix:** terminate and reap the owned child before entering common startup.
Explicit rollback/restore paths use a managed-only start policy so they cannot
immediately reselect the service they just displaced.

### BUG-GSO-10 - Native-to-Docker handoff skips an unknown service runtime

**Location:** `src-tauri/src/commands/docker.rs`

The handoff stops a selected service only when parsed status is explicitly
`running`. Windows can report `Runtime: unknown` while the service owns or is
acquiring the port. Inspection errors are also ignored.

**Impact:** Docker can start while an installed Native service remains an
unresolved competing owner.

**Fix:** fail closed on inspection/runtime errors, stop every installed selected
service regardless of localized runtime status, and reject foreign services.
The same installed-versus-running distinction is applied to update, storage,
stop, and uninstall paths so Windows `Runtime: unknown` is never treated as
proof that a registered task is inactive.

## Medium findings

### BUG-GSO-06 - stop_gateway reports success without stopping a system service

**Location:** `src-tauri/src/commands/gateway.rs`

The public stop command only takes and terminates `state.child`. With a
SystemService owner it reports that nothing is running and writes lifecycle
`Stopped`, while the authenticated endpoint remains live.

**Impact:** callers receive a false terminal state and later lifecycle actions
can make decisions from a state that contradicts the machine.

**Fix:** inspect the recorded owner. Stop a verified selected system service;
reject external/ambiguous owners; never write `Stopped` while the endpoint is
still reachable.

## Verified non-findings

- npm package installation does not install a service; this is intentional.
- Wizard completion already uses a serialized, rollback-aware official service
  handoff.
- Storage migration preserves installed and running service state separately.
- Application exit kills only the owned child and correctly leaves an official
  autostart service running.
- Uninstall removes only a service whose selected state/config identity is
  verified.
