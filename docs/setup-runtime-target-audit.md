# Setup Runtime Target Audit

Date: 2026-07-15

## Critical findings

### BUG-RT-01 - Docker onboarding loses its connection target

**Location**: `src/hooks/useSetupFlow.ts`, `src-tauri/src/commands/config.rs`

The Docker launcher stores its configuration under `state/docker/openclaw.json`,
but the wizard completion path refreshed the native `state/openclaw.json` target.
The UI could therefore complete onboarding against Docker and reconnect to a
different native endpoint.

**Fix**: persist the selected runtime mode with the storage bootstrap and resolve
all user-facing Gateway configuration, storage migration, and connection state
through the active runtime target.

### BUG-RT-02 - Docker recovery falls back to native OpenClaw

**Location**: `src/hooks/useSetupFlow.ts`, `src-tauri/src/commands/ensure.rs`

The setup retry and repair actions always used the native Gateway start and
native OpenClaw repair commands. A failed Docker setup could silently activate
a separate native environment.

**Fix**: route retry, repair, boot recovery, Gateway status, and restart through
the persisted runtime target. Docker repair refreshes the image and recreates
the container; it never invokes native repair.

## Medium findings

### BUG-RT-03 - Reinstall was only a navigation label

The existing-install screen navigated to mode selection but the native setup
skipped package installation whenever it found an OpenClaw binary.

**Fix**: carry explicit reinstall intent through setup and expose a force
reinstall command that shares the normal install lock and verification path.

### BUG-RT-04 - Docker terminal integration wrote a native missing-binary launcher

Storage setup creates the requested terminal launcher before the selected
runtime is known. Docker setup never rewrote it, so the launcher continued to
report that OpenClaw was not installed.

**Fix**: make terminal integration target-aware and refresh it after Docker is
ready. The Docker launcher delegates to `docker exec` without storing tokens.

### BUG-RT-05 - Non-Windows Node update action was not executable

The settings panel exposed an update button even though the backend only
supports automatic Node updates through Windows Package Manager.

**Fix**: expose backend capability data and render a non-actionable system
maintenance state on macOS/Linux.

### BUG-RT-06 - Docker configuration and maintenance required a host CLI

**Location**: `src-tauri/src/commands/openclaw_cli.rs`,
`src-tauri/src/commands/maintenance.rs`

The configuration editor and maintenance scan invoked a host-side OpenClaw
binary even when Docker was the selected runtime. Docker-only installations
therefore could not validate a candidate configuration or run structured
maintenance checks.

**Fix**: centralize Native/Docker command selection in a shared CLI adapter.
Docker commands execute inside JunQi's owned container; candidate configuration
is streamed to an isolated temporary file that is cleaned up by the container.
