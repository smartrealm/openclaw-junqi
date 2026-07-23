# OpenClaw Gateway Service Ownership Bugfix Spec

Date: 2026-07-24

## BUG-GSO-01 - Fail-closed service discovery

**Current:** a five-second `gateway status --json --no-probe` timeout is cleaned
up and ignored before a foreground child is spawned.

**Target:** an authenticated endpoint is the fast path. If offline, the normal
bounded service inspection must return a conclusive document. Errors remain
errors and cannot authorize another owner.

**Acceptance:**

- [x] No startup-specific five-second service status timeout remains.
- [x] Existing authenticated endpoints bypass the service CLI.
- [x] Inspection errors cannot reach managed-child spawn.

## BUG-GSO-02 - Installed service remains the selected owner

**Current:** an installed stopped or stale service falls through to managed
`gateway run`.

**Target:** selected services are started, stale selected services are rebound
and started, and only confirmed absence selects the child path.

**Acceptance:**

- [x] Selected stopped service plans `StartSelected`.
- [x] Stale runtime/locale service plans `RebindStale`.
- [x] Foreign/unverifiable installed services are rejected.
- [x] Autostart enable invokes the official handoff and verifies it succeeded.

## BUG-GSO-03 - Restart never silently changes owner

**Current:** ambiguous inspection and verified-service failures invoke the
managed fallback.

**Target:** only confirmed service absence uses a managed child. Once a service
is selected, restart either restores that service or returns an error.

**Acceptance:**

- [x] Restart target selection returns an error for Foreign/Unverifiable.
- [x] Inspection error is returned directly.
- [x] Service spawn/wait/exit/readiness failures do not start a child.

## BUG-GSO-04 - One native readiness contract

**Current:** child startup permits up to 210 seconds on Windows while service
paths use 30/45 seconds.

**Target:** service handoff, restart, update restore, and storage restore all
use the platform-aware native startup maximum.

**Acceptance:**

- [x] Windows service readiness permits the same maximum as managed startup.
- [x] No native service restore path retains a 30/45-second readiness literal.
- [x] Frontend post-return connection waits remain unchanged because backend
  commands return only after authenticated readiness.

## BUG-GSO-05 - Foreign installed service blocks update

**Current:** a stopped foreign/unverifiable service is treated as no owner.

**Target:** any installed service outside selected ownership blocks update.

**Acceptance:**

- [x] Stopped Foreign is rejected.
- [x] Stopped Unverifiable is rejected.
- [x] Absent service still permits a no-running-owner update.

## BUG-GSO-06 - Owner-aware stop

**Current:** stop only terminates a child and may report stopped while a service
continues listening.

**Target:** child and selected service owners are stopped through their verified
paths. External/ambiguous endpoints are not mutated or mislabeled.

**Acceptance:**

- [x] Managed child stop behavior is preserved.
- [x] Recorded SystemService stop requires selected service identity.
- [x] External/unknown owner returns an error when the endpoint is live.
- [x] Success requires the configured port to be released.

## BUG-GSO-07 - Pending service success remains successful

**Current:** the pending-rebind success return leaves `StartFailureGuard` armed.

**Target:** every successful service return disarms the failure guard first.

**Acceptance:**

- [x] SystemService running transition precedes guard disarm and success return.
- [x] The drop guard cannot overwrite that success with Error.

## BUG-GSO-08 - Authenticated reuse preserves the real owner

**Current:** every reused endpoint is written as External.

**Target:** a live owned child remains ManagedChild, a recorded selected service
remains SystemService, and only an unowned endpoint becomes External.

**Acceptance:**

- [x] Reuse validates the owner/child invariant.
- [x] Managed reuse returns its PID and keeps ManagedChild mode.

## BUG-GSO-09 - Managed restart replaces the process

**Current:** the common start fast path returns the healthy old child.

**Target:** confirmed-absent-service restart terminates and reaps the old child
before managed-only startup. Rollback and restore operations must preserve the
previously verified managed owner instead of re-running service selection.

**Acceptance:**

- [x] Termination and port release occur before `start_managed_gateway_locked`.
- [x] Service failures never enter this branch.
- [x] Wizard rollback, update restore, and storage restore use managed-only
  startup when their captured owner was ManagedChild.

## BUG-GSO-10 - Native-to-Docker handoff is service-aware

**Current:** only `inspection.running == true` stops the Native service and
inspection errors are ignored.

**Target:** every installed selected Native service is stopped through verified
ownership; errors and foreign services block Docker startup.

**Acceptance:**

- [x] Runtime/status inspection errors are returned.
- [x] Runtime `unknown` cannot bypass selected-service stop.
- [x] Foreign installed service blocks the mode switch.
