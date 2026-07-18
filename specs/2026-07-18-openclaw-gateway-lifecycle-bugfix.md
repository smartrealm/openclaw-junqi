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
