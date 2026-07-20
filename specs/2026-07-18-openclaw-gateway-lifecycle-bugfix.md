# OpenClaw Gateway Lifecycle Bugfix Spec

## BUG-GW-01

**Current:** forced storage recovery submits migration only when the legacy default exists.

**Target:** submit migration whenever storage recovery is relocating an already configured state directory.

**Acceptance:**
- A custom configured state can be moved after a filesystem compatibility failure.
- The migration request remains true even when the legacy default directory is absent.

## BUG-GW-02

**Current:** `/healthz` alone can attach JunQi to another state directory on the same port.

**Target:** selected-state readiness requires liveness plus acceptance of the token from the selected config.

**Acceptance:**
- A foreign live Gateway is not returned as JunQi's Gateway.
- A matching Gateway continues to be reused without a duplicate process.
- Storage restoration waits for the selected Gateway, not merely a listener.

## BUG-GW-03

**Current:** an official service restart is declared successful after liveness only.

**Target:** verify selected-state readiness after restart before marking the service as running.

**Acceptance:**
- A stale service that restarts with another state/config produces an explicit mismatch error.
- A matching official service remains `SystemService` after restart.

## BUG-GW-04

**Current:** after application restart, an official Gateway service that belongs to the selected state can be represented as an external endpoint. Storage migration then restores a managed child without rewriting the old service definition. The former stop path could also stop an unverified service.

**Target:** centralize service ownership and lifecycle commands behind the official `gateway status --json` document. Ownership is established only when `service.command.environment.OPENCLAW_STATE_DIR` resolves to JunQi's selected state directory.

**Acceptance:**
- A verified official service is stopped before migration and reinstalled with the destination state/config before it starts.
- A foreign or metadata-incomplete service is never stopped, uninstalled, or rebound by JunQi.
- A selected service remains a `SystemService` through migration even when JunQi was restarted before the migration.

## BUG-WIN-05

**Current:** service ownership checks only the selected state directory, and the
desktop restart path can mutate the default platform service without checking
ownership.

**Target:** all service operations accept a `GatewayServiceIdentity` containing
state directory and config path. Missing or mismatched identity is foreign.

**Acceptance:**
- A service with the same state and another config is not selected.
- Restart never mutates an absent, foreign, or unverifiable service.
- A matching service can still be restarted and authenticated.

## BUG-WIN-06

**Current:** migration restores a service only when its endpoint was reachable.

**Target:** migration records deployment kind and running state separately.
Owned service metadata is rewritten whenever state/config/runtime/npm locations
change, then started only if it was previously running.

**Acceptance:**
- A stopped Scheduled Task is rebound to the destination and remains stopped.
- A running Scheduled Task is rebound, started, and token-verified.
- Rollback restores the original service definition and running state.
- Custom Node, Git, npm prefix, npm cache, and config choices survive migration.

## BUG-WIN-07

**Current:** forced recovery remaps from the legacy default and accepts the same
incompatible state without the Node capability probe.

**Target:** configured `state_dir` is the migration source. Same-location
recovery runs the same capability probe used for a new target.

**Acceptance:**
- A custom `F:\\...` state can migrate to a compatible local directory.
- Workspace/runtime child paths are mapped relative to the configured source.
- An incompatible same-location selection is rejected before bootstrap changes.

## BUG-WIN-08

**Current:** Docker host mounts and container configuration share one workspace
path value.

**Target:** `RuntimePathMapping` exposes `host_workspace` and
`runtime_workspace`; Docker config always uses the latter and host operations
always use the former.

**Acceptance:**
- First onboarding followed by Docker restart uses the selected host workspace.
- Windows host paths are never written into Docker `openclaw.json`.
- Container paths are never passed to host filesystem APIs.
- Docker migration and rollback preserve both path domains.

## BUG-WIN-09

**Current:** dependency fallbacks can overlap after timeout and incomplete
OpenClaw packages can be promoted or reused.

**Target:** one supervised installer runner owns child termination and total
deadline accounting. One OpenClaw verifier checks package metadata, Node
contract, JavaScript entry, shim resolution, and executable version.

**Acceptance:**
- Timed-out installer/winget processes are terminated before fallback starts.
- npmjs remains a fallback when the mirror metadata is available.
- Missing `openclaw.mjs` fails before promotion and existing-install reuse.
- Node/Git/npm/OpenClaw/prefix probes have finite deadlines.

## BUG-WIN-10

**Current:** bootstrap Gateway, official Scheduled Task, and Docker transitions
can overlap; wizard sessions cannot reliably recover after reconnect.

**Target:** one runtime transition result records the target owner and verified
endpoint. Wizard completion explicitly reconciles the official service. Frontend
mode selection passes the requested mode through the call chain instead of
reading stale component state.

**Acceptance:**
- Native selection never starts Docker because of a stale closure.
- Default wizard completion leaves exactly one selected runtime owner.
- Lost wizard sessions can be resumed or cancelled without a permanent lock.
- Readiness requires the selected token, not only `/healthz`.

## BUG-WIN-11

**Current:** uninstall can leave a managed Gateway and stale PATH entry; tag
release signing is optional.

**Target:** installer hooks call an idempotent Windows cleanup helper that only
removes JunQi-owned process/launcher/PATH state. Tag releases require and verify
Authenticode for application and installers.

**Acceptance:**
- Uninstall leaves no JunQi-owned Node Gateway or launcher PATH entry.
- External OpenClaw state remains preserved and discoverable by explicit choice.
- Missing signing configuration fails a tag release.
- Windows install/uninstall strings are exercised by an installer smoke test.
