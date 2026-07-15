# Installation and Upgrade Flow Bugfix

## BUG-IU-01 - Fresh storage onboarding

**Current**: storage routing lives in the page and does not update the
orchestrator's onboarding decision.

**Target**: the setup orchestrator owns the transition and sets onboarding to
required before a Gateway is started against fresh storage.

**Acceptance**:
- [x] fresh storage followed by Gateway start cannot advance directly to Ready;
- [x] migrated or unchanged configured storage preserves its detected onboarding state.

## BUG-IU-02 - Single Gateway owner during updates

**Current**: both the official updater and JunQi can restart Gateway.

**Target**: the updater replaces OpenClaw with `--no-restart`; JunQi alone
restores the prior managed runtime under the operation gate.

**Acceptance**:
- [x] the real update command contains `--no-restart`;
- [x] managed Gateway restoration still runs after success and failure.

## BUG-IU-03 - Authoritative storage result

**Current**: the frontend infers freshness from local form booleans.

**Target**: `configure_storage` returns `createdFresh` and the frontend forwards
that value without reconstruction.

**Acceptance**:
- [x] both backend return paths populate `created_fresh`;
- [x] `StorageSetupStep` uses the typed command result.

## BUG-IU-04 - Runtime mode preservation

**Current**: restoring `External`/`None` performs `gateway install --force`.

**Target**: only `SystemService` uses service installation; unknown/external
modes return as a JunQi-owned managed child.

**Acceptance**:
- [x] external restoration calls `start_gateway_locked`;
- [x] service installation remains available only for `SystemService`.

## BUG-IU-05 - Monotonic setup progress

**Current**: progress falls from 30% to 0-5% after mode selection.

**Target**: install phases begin after the storage/mode milestone and retries do
not move the overall indicator backwards.

**Acceptance**:
- [x] native and Docker setup do not reset progress;
- [x] phase ranges are monotonic and end at 100%.
