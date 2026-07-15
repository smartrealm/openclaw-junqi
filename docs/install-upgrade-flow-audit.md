# Installation and Upgrade Flow Audit

Date: 2026-07-15

## Verified flow

The native setup order is:

`detect OpenClaw -> choose storage -> Git -> Node.js -> npm -> OpenClaw -> terminal integration -> prepare Gateway -> explicit Gateway start -> official onboarding -> ready`

Existing installations skip package installation, preserve the detected binary,
and repair Node.js against the installed package's `engines.node` contract before
Gateway startup. OpenClaw updates resolve the target package contract before
replacement. Node.js and Windows Git versions are resolved from publisher
metadata rather than hard-coded constants.

JunQi's normal desktop runtime is an owned `openclaw gateway run` child. It does
not require `openclaw gateway install`; registering an OS service would create a
second lifecycle owner and is not part of normal first-run setup.

## Critical findings

### BUG-IU-01 - Fresh storage can skip official onboarding

**Location**: `src/pages/SetupPage.tsx:693`, `src/hooks/useSetupFlow.ts:567`

**Problem**: choosing a fresh state directory reroutes the page to Gateway
startup, but the `needsOnboarding` flag still describes the old directory. A
previously configured user can therefore start a Gateway against an empty
directory and advance directly to Ready.

**Impact**:
- The new environment can enter the workspace without model/auth configuration.
- Failure appears later as a Gateway/model problem instead of an onboarding step.

**Fix proposal**: move the storage completion transition into the setup
orchestrator and force onboarding for a backend-confirmed fresh environment.

## Medium findings

### BUG-IU-02 - OpenClaw update has two Gateway lifecycle owners

**Location**: `src-tauri/src/commands/openclaw_update.rs:840`

**Problem**: JunQi stops and later restores its managed Gateway, but invokes the
official updater without `--no-restart`. The updater may independently restart
or attempt to install/use a service during the same operation.

**Impact**:
- Update success can be reported as a restart failure when no service exists.
- An existing service can race or replace JunQi's managed child ownership.

**Fix proposal**: run the updater with `--no-restart` and keep Gateway recovery
exclusively under JunQi's operation gate.

### BUG-IU-03 - Storage freshness is re-derived in the UI

**Location**: `src/components/setup/StorageSetupGate.tsx:239`, `src-tauri/src/commands/storage.rs:29`

**Problem**: the backend returns migration facts but not whether it created a
fresh environment. The UI reconstructs that fact from form state, duplicating
transaction semantics across the IPC boundary.

**Impact**: future storage modes can silently route to the wrong onboarding
branch even when the backend transaction itself is correct.

**Fix proposal**: add `createdFresh` to `StorageConfigureResult` and consume that
authoritative value.

### BUG-IU-04 - External runtime restoration registers a system service

**Location**: `src-tauri/src/commands/storage.rs:793`

**Problem**: storage migration maps both `External` and `None` runtime modes to
`gateway install --force` followed by `gateway start`. Observing an external
listener does not authorize changing it into a persistent OS service.

**Impact**: migration can add login/startup persistence and change runtime
ownership without a dedicated user choice.

**Fix proposal**: restore `External` and `None` through JunQi's managed child;
reserve service commands only for a runtime already identified as
`SystemService`.

## Low findings

### BUG-IU-05 - Overall setup progress moves backwards

**Location**: `src/hooks/useSetupFlow.ts:590`, `src/hooks/setupProgressModel.ts:20`

**Problem**: storage/mode selection reports 24-30%, then native/Docker setup
resets progress to zero and begins the install ranges at 5%.

**Impact**: the overall progress indicator visibly regresses at the point the
actual installation starts.

**Fix proposal**: keep progress monotonic across the storage-to-install boundary
and define install phase ranges after the 30% selection milestone.

## Architecture assessment

`useSetupFlow` currently owns detection, storage routing, package orchestration,
Gateway lifecycle, wizard transport, progress mapping, and recovery. Its large
positional parameter list is a readability smell, but a wholesale class rewrite
would increase risk. The targeted fix moves the misplaced storage transition
back into the orchestrator and establishes backend result objects as the source
of truth. Further extraction should follow cohesive domains (detection,
installation, onboarding), not class count.

## Validation record

Validated on macOS on 2026-07-15:

- frontend and script tests: passed;
- Rust library tests: 295 passed, 0 failed, 2 ignored;
- TypeScript, module-boundary, and production build checks: passed;
- Rust formatting and Clippy checks: passed (existing repository warnings remain);
- regression coverage: one executable contract for each BUG-IU-01 through BUG-IU-05.
